import { appendEvent, emptyFocus } from "./state.js";
import { clamp, deepClone, safeDate, toIso, uid } from "./utils.js";

export const FOCUS_ALARM = "studio-focus-alarm";

export function remainingSeconds(focus, now = new Date()) {
  if (["paused", "ready"].includes(focus.status)) return Math.max(0, Math.ceil(Number(focus.remainingSeconds) || 0));
  if (focus.status !== "running") return 0;
  const endsAt = safeDate(focus.endsAt);
  return endsAt ? Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / 1000)) : 0;
}

export function startFocus(state, options = {}, now = new Date()) {
  if (["running", "paused", "ready"].includes(state.focus.status)) throw new Error("Finish or end the current timer before starting another.");
  const mode = options.mode === "pomodoro" ? "pomodoro" : "single";
  if (mode === "pomodoro" && options.blockId) throw new Error("Scheduled blocks use one focus interval. Start Pomodoro from the task instead.");
  if (options.taskId && !state.tasks.some(task => task.id === options.taskId && !["done", "archived"].includes(task.status))) throw new Error("Choose an open task for this timer.");
  if (options.blockId && !state.schedule.some(block => block.id === options.blockId && block.taskId === options.taskId && ["planned", "active"].includes(block.status))) throw new Error("This block is no longer available.");
  const durationMinutes = clamp(options.durationMinutes ?? state.preferences.focusMinutes, 1, 480);
  const plannedSeconds = Math.round(durationMinutes * 60);
  const sessionId = uid("session", now.getTime());
  let next = deepClone(state);
  next.focus = {
    ...emptyFocus(),
    mode,
    pomodoroId: mode === "pomodoro" ? uid("pomodoro", now.getTime()) : null,
    status: "running",
    phase: "focus",
    taskId: options.taskId ?? null,
    blockId: options.blockId ?? null,
    startedAt: now.toISOString(),
    endsAt: new Date(now.getTime() + plannedSeconds * 1000).toISOString(),
    remainingSeconds: plannedSeconds,
    plannedSeconds,
    focusSeconds: plannedSeconds,
    breakMinutes: clamp(options.breakMinutes ?? state.preferences.breakMinutes, 1, 60),
    longBreakMinutes: clamp(options.longBreakMinutes ?? state.preferences.longBreakMinutes ?? 15, 1, 60),
    longBreakEvery: Math.round(clamp(options.longBreakEvery ?? state.preferences.longBreakEvery ?? 4, 1, 8)),
    targetCycles: mode === "pomodoro" ? Math.round(clamp(options.cycles ?? state.preferences.cycles, 1, 8)) : 1,
    activeSessionId: sessionId
  };
  next = appendEvent(next, "focus_started", { sessionId, taskId: next.focus.taskId, plannedSeconds }, now);
  return next;
}

export function pauseFocus(state, now = new Date()) {
  if (state.focus.status !== "running") return deepClone(state);
  if (remainingSeconds(state.focus, now) === 0) return reconcileFocus(state, now).state;
  const next = deepClone(state);
  next.focus.remainingSeconds = remainingSeconds(next.focus, now);
  next.focus.status = "paused";
  next.focus.pausedAt = now.toISOString();
  next.focus.endsAt = null;
  return appendEvent(next, "focus_paused", { sessionId: next.focus.activeSessionId, phase: next.focus.phase }, now);
}

export function resumeFocus(state, now = new Date()) {
  if (state.focus.status !== "paused") return deepClone(state);
  const next = deepClone(state);
  const remaining = Math.max(1, Number(next.focus.remainingSeconds) || 1);
  next.focus.status = "running";
  next.focus.pausedAt = null;
  next.focus.endsAt = new Date(now.getTime() + remaining * 1000).toISOString();
  return appendEvent(next, "focus_resumed", { sessionId: next.focus.activeSessionId, phase: next.focus.phase }, now);
}

function cycleSummary(focus, outcome, now) {
  return {
    sessionId: focus.pomodoroId || focus.activeSessionId,
    taskId: focus.taskId, blockId: focus.blockId,
    focusedSeconds: focus.totalFocusedSeconds,
    plannedSeconds: focus.focusSeconds * focus.targetCycles,
    mode: focus.mode, completedCycles: focus.completedCycles, targetCycles: focus.targetCycles,
    outcome, endedAt: now.toISOString()
  };
}

function finishCycle(state, outcome, now) {
  const next = deepClone(state);
  const summary = cycleSummary(next.focus, outcome, now);
  next.focus = { ...emptyFocus(summary), status: "complete", lastSummary: summary };
  return appendEvent(next, "timer_closed", { mode: summary.mode, focusedSeconds: summary.focusedSeconds }, now);
}

function preparePhase(focus, phase) {
  const long = phase === "break" && focus.completedCycles % focus.longBreakEvery === 0;
  const seconds = phase === "focus" ? focus.focusSeconds : (long ? focus.longBreakMinutes : focus.breakMinutes) * 60;
  return { ...focus, phase, status: "ready", breakKind: long ? "long" : "short", startedAt: null, endsAt: null, pausedAt: null, plannedSeconds: seconds, remainingSeconds: seconds, activeSessionId: null };
}

// Only a focus phase creates a history record. Each phase waits for a user gesture.
function finishPhase(state, outcome, now) {
  let next = deepClone(state);
  const focus = next.focus;
  if (!["running", "paused"].includes(focus.status)) return next;
  if (focus.phase === "break") {
    if (outcome === "stopped" || focus.completedCycles >= focus.targetCycles) return finishCycle(next, outcome === "stopped" ? "stopped" : "completed", now);
    next.focus = preparePhase(focus, "focus");
    return appendEvent(next, "break_completed", { completedCycles: focus.completedCycles }, now);
  }
  const focusedSeconds = Math.max(0, Math.min(focus.plannedSeconds, focus.plannedSeconds - remainingSeconds(focus, now)));
  const sessionId = focus.activeSessionId ?? uid("session", now.getTime());
  if (!next.sessions.some(session => session.id === sessionId)) {
    next.sessions.push({ id: sessionId, taskId: focus.taskId, blockId: focus.blockId, startedAt: focus.startedAt ?? now.toISOString(), endedAt: now.toISOString(), plannedSeconds: focus.plannedSeconds, focusedSeconds, outcome, mode: focus.mode, pomodoroId: focus.pomodoroId, cycleNumber: focus.completedCycles + 1 });
    next.sessions = next.sessions.slice(-2000);
    focus.totalFocusedSeconds += focusedSeconds;
    if (outcome === "completed") focus.completedCycles += 1;
  }
  if (outcome === "completed" && focus.blockId) {
    const block = next.schedule.find(item => item.id === focus.blockId);
    if (block) block.status = "done";
  }
  next = appendEvent(next, outcome === "completed" ? "focus_completed" : "focus_stopped", { sessionId, focusedSeconds }, now);
  if (outcome === "completed" && focus.mode === "pomodoro") {
    next.focus = preparePhase(next.focus, "break");
    return next;
  }
  return finishCycle(next, outcome, now);
}

export function stopFocus(state, now = new Date()) {
  // If an alarm arrived late, the elapsed focus interval still completed.
  const reconciled = reconcileFocus(state, now).state;
  if (reconciled.focus.status === "ready") return finishCycle(reconciled, reconciled.focus.completedCycles >= reconciled.focus.targetCycles ? "completed" : "stopped", now);
  return finishPhase(reconciled, "stopped", now);
}

export function completeFocus(state, now = new Date()) {
  const next = deepClone(state);
  if (next.focus.status === "running") next.focus.endsAt = now.toISOString();
  if (next.focus.status === "paused") next.focus.remainingSeconds = 0;
  return finishPhase(next, "completed", now);
}

export function reconcileFocus(state, now = new Date()) {
  if (state.focus.status !== "running" || remainingSeconds(state.focus, now) > 0) return { state: deepClone(state), changed: false };
  // Attribute completion to the stored boundary, not to a later browser wake-up.
  const endedAt = safeDate(state.focus.endsAt) ?? now;
  return { state: completeFocus(state, endedAt), changed: true };
}

export function startNextPhase(state, now = new Date()) {
  if (state.focus.status !== "ready") return deepClone(state);
  const next = deepClone(state);
  const focus = next.focus;
  focus.status = "running";
  focus.startedAt = now.toISOString();
  focus.endsAt = new Date(now.getTime() + focus.plannedSeconds * 1000).toISOString();
  focus.remainingSeconds = focus.plannedSeconds;
  if (focus.phase === "focus") focus.activeSessionId = uid("session", now.getTime());
  return appendEvent(next, focus.phase === "focus" ? "focus_started" : "break_started", { sessionId: focus.activeSessionId, taskId: focus.taskId, plannedSeconds: focus.plannedSeconds }, now);
}

export function skipBreak(state, now = new Date()) {
  if (state.focus.phase !== "break" || !["running", "paused", "ready"].includes(state.focus.status)) return deepClone(state);
  if (state.focus.completedCycles >= state.focus.targetCycles) return finishCycle(state, "completed", now);
  const next = deepClone(state);
  next.focus = preparePhase(next.focus, "focus");
  return appendEvent(next, "break_skipped", {}, now);
}

export function clearCompletedFocus(state, now = new Date()) {
  if (state.focus.status !== "complete") return deepClone(state);
  const next = deepClone(state);
  next.focus = emptyFocus(next.focus.lastSummary);
  return appendEvent(next, "post_session_closed", {}, now);
}

export function applyTimerAction(state, action, options = {}, now = new Date()) {
  const handlers = { start: (s, n) => startFocus(s, options, n), pause: pauseFocus, resume: resumeFocus, stop: stopFocus, next: startNextPhase, "skip-break": skipBreak, clear: clearCompletedFocus, reconcile: (s, n) => reconcileFocus(s, n).state };
  if (!handlers[action]) throw new Error("Unknown timer action.");
  return handlers[action](state, now);
}

export function timerSnapshot(focus, now = new Date()) {
  const seconds = remainingSeconds(focus, now);
  const planned = Math.max(1, Number(focus.plannedSeconds) || 1);
  return { seconds, minutesPart: Math.floor(seconds / 60), secondsPart: seconds % 60, progress: Math.min(1, Math.max(0, (planned - seconds) / planned)), endsAt: toIso(focus.endsAt, null) };
}

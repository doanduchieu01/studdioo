import { deepClone, localDateKey, safeDate, uid } from "./utils.js";
import { KANBAN_STAGES, normalizeKanban, normalizeKanbanItem } from "./kanban-state.js";

const open = task => task && !["done", "archived"].includes(task.status);
export const kanbanItem = (state, taskId) => state.kanban?.items.find(item => item.taskId === taskId) ?? normalizeKanbanItem({ taskId });
export const kanbanStage = (state, task) => task.status === "done" ? "done" : task.status === "archived" ? "archived" : kanbanItem(state, task.id).stage;
export const kanbanWip = state => state.tasks.filter(task => open(task) && kanbanStage(state, task) === "doing");

function replaceItem(state, item) {
  state.kanban.items = [...state.kanban.items.filter(entry => entry.taskId !== item.taskId), item];
}

function automaticMove(state, taskId, stage, reason, evidence, now) {
  const before = deepClone(kanbanItem(state, taskId));
  const after = { ...before, stage, readyAt: stage === "ready" ? now.toISOString() : before.readyAt, startedAt: stage === "doing" ? before.startedAt ?? now.toISOString() : before.startedAt, changedAt: now.toISOString(), revision: before.revision + 1 };
  replaceItem(state, after);
  state.kanban.changes.push({ id: uid("kanban", now.getTime()), taskId, at: now.toISOString(), reason, evidence: { date: "", blockId: "", sessionId: "", ...evidence }, before, after: deepClone(after), undoneAt: null });
  state.kanban.changes = state.kanban.changes.slice(-100);
}

export function todayKanbanBlock(state, taskId, now = new Date()) {
  const end = new Date(now); end.setHours(24, 0, 0, 0);
  return state.schedule.filter(block => block.taskId === taskId && ["planned", "active"].includes(block.status) && safeDate(block.startAt) && safeDate(block.endAt) > now && safeDate(block.startAt) < end)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))[0] ?? null;
}

// Called by the same serialized writer as task/timer saves. No polling writes,
// network calls, backfilled starts, automatic completions or schedule changes.
export function reconcileKanban(state, previous = null, now = new Date()) {
  const next = deepClone(state);
  if (!next.kanban?.enabled) return next;
  const date = localDateKey(now);
  const picked = new Set(next.dayPlans.find(plan => plan.date === date)?.taskIds ?? []);
  const focus = next.focus;
  const newFocus = previous?.kanban?.enabled && focus.status === "running" && focus.phase === "focus" && focus.activeSessionId && previous.focus.activeSessionId !== focus.activeSessionId;
  for (const task of next.tasks.filter(open)) {
    let item = kanbanItem(next, task.id);
    if (item.manualHold || item.blockedReason) continue;
    // Record an actual start even if the soft WIP limit is exceeded. Hiding it
    // would under-report started work. The UI warns, but never blocks a timer.
    if (newFocus && next.kanban.autoStart && focus.taskId === task.id && item.stage !== "doing") {
      automaticMove(next, task.id, "doing", "timer_started", { date, sessionId: focus.activeSessionId }, now);
      continue;
    }
    if (!next.kanban.autoReady || item.stage !== "backlog") continue;
    const block = todayKanbanBlock(next, task.id, now);
    if (picked.has(task.id) || block) automaticMove(next, task.id, "ready", picked.has(task.id) ? "picked_today" : "scheduled_today", { date, blockId: block?.id ?? "" }, now);
  }
  return next;
}

export function canUndoKanban(state, change) {
  if (!state.kanban?.enabled || !change || change.undoneAt || !open(state.tasks.find(task => task.id === change.taskId))) return false;
  return JSON.stringify(kanbanItem(state, change.taskId)) === JSON.stringify(change.after);
}

export function applyKanbanAction(state, action, options = {}, now = new Date()) {
  const next = deepClone(state);
  next.kanban = normalizeKanban(next.kanban, new Set(next.tasks.map(task => task.id)));
  const settings = next.kanban;
  if (action === "enable") {
    if (!settings.enabled) { settings.enabledAt ??= now.toISOString(); settings.reviewedAt = now.toISOString(); }
    settings.enabled = true; settings.offerDismissed = true;
  } else if (action === "disable") { settings.enabled = false; settings.offerDismissed = true; }
  else if (action === "dismiss") settings.offerDismissed = true;
  else if (action === "settings") {
    const patch = options.patch ?? {};
    for (const key of ["autoReady", "autoStart", "showHints"]) {
      if (Object.hasOwn(patch, key)) {
        if (typeof patch[key] !== "boolean") throw new Error("Choose on or off.");
        settings[key] = patch[key];
      }
    }
    for (const [key, max] of [["wipLimit", 10], ["ageDays", 30]]) {
      if (Object.hasOwn(patch, key)) {
        const value = Number(patch[key]);
        if (!Number.isInteger(value) || value < 1 || value > max) throw new Error("Choose a value within the shown range.");
        settings[key] = value;
      }
    }
  } else {
    if (!settings.enabled) throw new Error("Enable Kanban first.");
    if (action === "review") settings.reviewedAt = now.toISOString();
    else if (action === "undo") {
      const change = settings.changes.find(item => item.id === options.changeId);
      if (!canUndoKanban(next, change)) throw new Error("This move changed again. Review the current task.");
      replaceItem(next, { ...change.before, manualHold: true, changedAt: now.toISOString(), revision: change.after.revision + 1 });
      change.undoneAt = now.toISOString();
    } else {
      const task = next.tasks.find(task => task.id === options.taskId);
      if (!open(task)) throw new Error("Choose an open task.");
      const item = { ...kanbanItem(next, task.id) };
      if (options.expectedRevision !== undefined && options.expectedRevision !== item.revision) throw new Error("This task changed. Review it and try again.");
      if (action === "move") {
        if (!KANBAN_STAGES.includes(options.stage)) throw new Error("Choose a Kanban stage.");
        if (item.stage === options.stage) return next;
        if (item.stage === "doing") throw new Error("Started work stays in Doing until completed or archived. Mark it blocked if needed.");
        if (options.stage === "doing" && kanbanWip(next).length >= settings.wipLimit && options.confirmOverLimit !== true) throw new Error("WIP limit reached. Confirm an extra task to continue.");
        item.stage = options.stage; item.manualHold = true;
        if (item.stage === "ready") item.readyAt = now.toISOString();
        if (item.stage === "backlog") item.readyAt = null;
        if (item.stage === "doing") item.startedAt ??= now.toISOString();
      } else if (action === "block") {
        if (item.stage !== "doing") throw new Error("Only started work can be blocked.");
        if (typeof options.reason !== "string" || !options.reason.trim() || options.reason.trim().length > 300) throw new Error("Enter a short blocker, up to 300 characters.");
        item.blockedReason = options.reason.trim();
      } else if (action === "unblock") item.blockedReason = "";
      else if (action === "allow-auto") item.manualHold = false;
      else throw new Error("Unknown Kanban action.");
      item.changedAt = now.toISOString(); item.revision += 1;
      replaceItem(next, item);
    }
  }
  next.updatedAt = now.toISOString();
  return reconcileKanban(next, state, now);
}

export function kanbanSuggestion(state, now = new Date()) {
  if (!state.kanban?.enabled || !state.kanban.showHints || kanbanWip(state).length >= state.kanban.wipLimit) return null;
  const choices = state.tasks.filter(task => open(task) && kanbanStage(state, task) === "ready" && !kanbanItem(state, task.id).blockedReason).map(task => {
    const block = todayKanbanBlock(state, task.id, now);
    const due = safeDate(task.dueAt);
    const urgent = task.urgency === "urgent" || (task.urgency === "auto" && due && due.getTime() <= now.getTime() + 86400000);
    const reason = block ? "scheduled_today" : urgent ? "urgent" : task.important === true ? "important" : task.priority === "high" ? "high_priority" : "oldest_ready";
    return { task, block, reason, rank: ["scheduled_today", "urgent", "important", "high_priority", "oldest_ready"].indexOf(reason) };
  });
  choices.sort((a, b) => a.rank - b.rank || (a.rank < 4 ? (a.block?.startAt ?? a.task.dueAt ?? "9999").localeCompare(b.block?.startAt ?? b.task.dueAt ?? "9999") : 0) || (kanbanItem(state, a.task.id).readyAt ?? a.task.createdAt).localeCompare(kanbanItem(state, b.task.id).readyAt ?? b.task.createdAt) || a.task.id.localeCompare(b.task.id));
  return choices[0] ?? null;
}

export function kanbanMetrics(state, now = new Date()) {
  const wip = kanbanWip(state);
  const since = Math.max(now.getTime() - 7 * 86400000, safeDate(state.kanban?.enabledAt)?.getTime() ?? now.getTime());
  const completed = state.tasks.filter(task => task.status === "done" && safeDate(task.completedAt)?.getTime() >= since && safeDate(task.completedAt) <= now);
  const cycles = completed.map(task => { const start = safeDate(kanbanItem(state, task.id).startedAt); return start ? (new Date(task.completedAt) - start) / 60000 : null; }).filter(value => value !== null && value >= 0).sort((a, b) => a - b);
  const middle = Math.floor(cycles.length / 2);
  const lastReview = safeDate(state.kanban?.reviewedAt ?? state.kanban?.enabledAt);
  return {
    wip: wip.length, blocked: wip.filter(task => kanbanItem(state, task.id).blockedReason).length,
    completed: completed.length, cycleSamples: cycles.length,
    medianCycleMinutes: cycles.length ? cycles.length % 2 ? cycles[middle] : (cycles[middle - 1] + cycles[middle]) / 2 : null,
    oldestMinutes: Math.max(0, ...wip.map(task => { const start = safeDate(kanbanItem(state, task.id).startedAt); return start ? (now - start) / 60000 : 0; })),
    reviewDue: Boolean(state.kanban?.enabled && lastReview && now - lastReview >= 7 * 86400000)
  };
}

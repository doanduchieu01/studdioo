import { appendEvent, updateTask } from "./state.js";
import { clamp, deepClone, localDateKey, parseClock, safeDate } from "./utils.js";
import { remainingSeconds } from "./timer.js";

export const QUADRANTS = [
  { id: "do", label: "Do first", axes: "Important · Urgent", hint: "Give these your next available focus block.", important: true, urgency: "urgent" },
  { id: "schedule", label: "Schedule", axes: "Important · Not urgent", hint: "Protect time before these become urgent.", important: true, urgency: "not-urgent" },
  { id: "delegate", label: "Delegate / simplify", axes: "Not important · Urgent", hint: "Ask for help or reduce the work involved.", important: false, urgency: "urgent" },
  { id: "defer", label: "Defer / drop", axes: "Not important · Not urgent", hint: "Keep for later, or archive from Edit.", important: false, urgency: "not-urgent" }
];

export function taskUrgent(task, now = new Date()) {
  if (task.urgency === "urgent") return true;
  if (task.urgency === "not-urgent") return false;
  const due = safeDate(task.dueAt);
  return Boolean(due && due.getTime() <= now.getTime() + 24 * 60 * 60_000);
}

export function taskQuadrant(task, now = new Date()) {
  if (typeof task.important !== "boolean") return "unsorted";
  return task.important ? (taskUrgent(task, now) ? "do" : "schedule") : (taskUrgent(task, now) ? "delegate" : "defer");
}

export function moveToQuadrant(state, taskId, quadrant, now = new Date()) {
  if (quadrant === "unsorted") return updateTask(state, taskId, { important: null, urgency: "auto", sortLocked: true, sortSource: "manual", sortNote: "" }, now);
  const choice = QUADRANTS.find(item => item.id === quadrant);
  if (!choice) throw new Error("Choose a quadrant.");
  return updateTask(state, taskId, { important: choice.important, urgency: choice.urgency, sortLocked: true, sortSource: "manual", sortNote: "" }, now);
}

function estimatedBreakMinutes(focusMinutes, preferences) {
  const interval = Math.max(1, Number(preferences.focusMinutes) || 25);
  const betweenRounds = Math.max(0, Math.ceil(focusMinutes / interval) - 1);
  const every = Math.max(1, Number(preferences.longBreakEvery) || 4);
  const longBreaks = Math.floor(betweenRounds / every);
  return (betweenRounds - longBreaks) * preferences.breakMinutes + longBreaks * (preferences.longBreakMinutes ?? 15);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function estimateDailyBudget(state, now = new Date()) {
  const today = localDateKey(now);
  const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 28);
  const firstDay = localDateKey(cutoff);
  const inHistory = date => date >= firstDay && date < today;
  const recent = days => [...days.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 7).map(([, minutes]) => minutes);
  const manualDays = new Map((state.dayPlans ?? [])
    .filter(plan => plan.budgetSource === "manual" && inHistory(plan.date))
    .map(plan => [plan.date, clamp(plan.availableMinutes, 0, 1440)]));
  const focusDays = new Map();
  for (const session of state.sessions ?? []) {
    const ended = safeDate(session.endedAt);
    const minutes = clamp(session.focusedSeconds, 0, 86400) / 60;
    if (!ended || !minutes) continue;
    const date = localDateKey(ended);
    if (inHistory(date)) focusDays.set(date, (focusDays.get(date) ?? 0) + minutes);
  }
  const manual = recent(manualDays);
  // Missing days are unknown, not zero availability. Stopped sessions still
  // contain recorded focus; planned timer duration and website time do not.
  const focus = recent(focusDays).map(minutes => clamp(minutes + estimatedBreakMinutes(minutes, state.preferences), 0, 1440));
  const sources = [];
  let defaultWeight = 0;
  for (const [id, values, fullWeight] of [["manual", manual, 2], ["focus", focus, 1]]) {
    if (!values.length) continue;
    // A simple, disclosed heuristic: three recorded days give a source its full
    // weight. Until then the default fills the missing weight, not invented days.
    const reliability = Math.min(1, values.length / 3);
    sources.push({ id, minutes: median(values), samples: values.length, weight: fullWeight * reliability });
    defaultWeight += fullWeight * (1 - reliability);
  }
  if (!sources.length) defaultWeight = 1;
  if (defaultWeight > 0) sources.push({ id: "default", minutes: clamp(state.preferences.dailyBudgetMinutes ?? 120, 0, 1440), samples: 0, weight: defaultWeight });
  const weight = sources.reduce((sum, source) => sum + source.weight, 0);
  const baselineMinutes = Math.round(sources.reduce((sum, source) => sum + source.minutes * source.weight, 0) / weight);
  const start = parseClock(state.preferences.dayStart, 8, 0);
  const end = parseClock(state.preferences.dayEnd, 21, 30);
  // Whole-day clock limit, not a countdown or evidence of free calendar time.
  // Like the scheduler, equal start/end times describe a 24-hour window.
  const workdayMinutes = (end.hour * 60 + end.minute - start.hour * 60 - start.minute + 1440) % 1440 || 1440;
  return { minutes: Math.min(baselineMinutes, workdayMinutes), baselineMinutes, workdayMinutes, capped: baselineMinutes > workdayMinutes, samples: manual.length, limitedHistory: defaultWeight > 0, sources };
}

export function dayPlan(state, now = new Date()) {
  const date = localDateKey(now);
  const saved = state.dayPlans?.find(plan => plan.date === date);
  if (saved?.budgetSource === "manual") return saved;
  const automatic = state.preferences.autoDailyBudget;
  return { date, availableMinutes: automatic ? estimateDailyBudget(state, now).minutes : saved?.availableMinutes ?? state.preferences.dailyBudgetMinutes ?? 120, taskIds: saved?.taskIds ?? [], budgetSource: automatic ? "automatic" : "default" };
}

export function saveDayPlan(state, changes, now = new Date()) {
  const plan = { ...dayPlan(state, now), ...changes, date: localDateKey(now) };
  if (Object.hasOwn(changes, "availableMinutes")) plan.budgetSource = "manual";
  const minutes = Number(plan.availableMinutes);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) throw new Error("Available time must be between 0 and 1440 minutes.");
  plan.availableMinutes = Math.round(minutes);
  const ids = new Set(state.tasks.map(task => task.id));
  plan.taskIds = [...new Set((plan.taskIds ?? []).filter(id => ids.has(id)))];
  const next = deepClone(state);
  next.dayPlans = [...(next.dayPlans ?? []).filter(item => item.date !== plan.date), plan].sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
  return appendEvent(next, "day_plan_updated", { date: plan.date }, now);
}

export function toggleTodayTask(state, taskId, now = new Date()) {
  const task = state.tasks.find(task => task.id === taskId && !["done", "archived"].includes(task.status));
  if (!task) throw new Error("Choose an open task.");
  const plan = dayPlan(state, now);
  const taskIds = plan.taskIds.includes(taskId) ? plan.taskIds.filter(id => id !== taskId) : [...plan.taskIds, taskId];
  return saveDayPlan(state, { taskIds }, now);
}

export function useAutomaticDailyBudget(state, now = new Date()) {
  if (!state.preferences.autoDailyBudget) throw new Error("Enable automatic daily budget in Settings first.");
  const next = saveDayPlan(state, { budgetSource: "automatic" }, now);
  const plan = next.dayPlans.find(item => item.date === localDateKey(now));
  plan.availableMinutes = estimateDailyBudget(next, now).minutes;
  return next;
}

export function dailyBudget(state, now = new Date()) {
  const plan = dayPlan(state, now);
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const recorded = new Map();
  let todaySeconds = 0;
  for (const session of state.sessions) {
    const seconds = Math.max(0, Number(session.focusedSeconds) || 0);
    if (session.taskId) recorded.set(session.taskId, (recorded.get(session.taskId) ?? 0) + seconds);
    const ended = safeDate(session.endedAt);
    // Same completed-interval day attribution as Insights.
    if (ended && ended >= start && ended < end) todaySeconds += seconds;
  }
  const f = state.focus;
  let currentRemaining = 0;
  if (f.phase === "focus" && ["running", "paused"].includes(f.status)) {
    currentRemaining = remainingSeconds(f, now) / 60;
    const elapsed = Math.max(0, f.plannedSeconds - currentRemaining * 60);
    todaySeconds += elapsed;
    if (f.taskId) recorded.set(f.taskId, (recorded.get(f.taskId) ?? 0) + elapsed);
  }
  let timerWork = currentRemaining;
  if (f.mode === "pomodoro" && ["running", "paused", "ready"].includes(f.status)) {
    const currentRound = f.phase === "focus" && f.status !== "ready" ? 1 : 0;
    timerWork += Math.max(0, f.targetCycles - f.completedCycles - currentRound) * f.focusSeconds / 60;
  }
  const picked = new Set(plan.taskIds);
  const open = state.tasks.filter(task => !["done", "archived"].includes(task.status));
  const upcoming = new Map();
  for (const block of state.schedule) {
    if (!["planned", "active"].includes(block.status)) continue;
    const blockStart = safeDate(block.startAt), blockEnd = safeDate(block.endAt);
    if (!blockStart || !blockEnd) continue;
    const duration = Math.max(0, (Math.min(end.getTime(), blockEnd.getTime()) - Math.max(now.getTime(), start.getTime(), blockStart.getTime())) / 60_000);
    upcoming.set(block.taskId, (upcoming.get(block.taskId) ?? 0) + duration);
  }
  const tasks = open.map(task => {
    const remaining = Math.max(0, task.durationMinutes - (recorded.get(task.id) ?? 0) / 60);
    const scheduled = upcoming.get(task.id) ?? 0;
    const active = f.taskId === task.id ? timerWork : 0;
    return { task, picked: picked.has(task.id), remainingMinutes: remaining, scheduledMinutes: scheduled, plannedMinutes: Math.max(picked.has(task.id) ? remaining : 0, scheduled, active) };
  });
  const remainingWork = tasks.reduce((sum, item) => sum + item.plannedMinutes, 0) + (!open.some(task => task.id === f.taskId) ? timerWork : 0);
  const breakMinutes = estimatedBreakMinutes(remainingWork, state.preferences);
  const focusedMinutes = todaySeconds / 60;
  const totalMinutes = focusedMinutes + remainingWork + breakMinutes;
  return { ...plan, tasks, focusedMinutes, remainingWork, breakMinutes, totalMinutes, spareMinutes: plan.availableMinutes - totalMinutes, fill: plan.availableMinutes > 0 ? clamp(totalMinutes / plan.availableMinutes, 0, 1) : (totalMinutes > 0 ? 1 : 0) };
}

import { normalizeAiUsage } from "./ai-usage.js";
import { normalizeKanban } from "./kanban-state.js";
import { clamp, deepClone, isPlainObject, safeDate, toIso, uid } from "./utils.js";
import { MAX_CUSTOM_INSTRUCTIONS_LENGTH, normalizeMemory } from "./memory.js";
import { exportLearnedMemory } from "./learned-memory.js";
import { DEFAULT_MODEL } from "./models.js";

export const STATE_KEY = "studioState";
export const SCHEMA_VERSION = 12;

const TASK_STATUSES = new Set(["inbox", "planned", "done", "archived"]);
const BLOCK_STATUSES = new Set(["planned", "active", "done", "skipped"]);
const ENERGY_LEVELS = new Set(["low", "medium", "high"]);
const PRIORITIES = new Set(["low", "normal", "high"]);
const THEMES = new Set(["night", "paper"]);

export function createDefaultState(now = new Date()) {
  const createdAt = toIso(now, new Date().toISOString());
  return {
    schemaVersion: SCHEMA_VERSION,
    schedulingRevision: 0,
    createdAt,
    updatedAt: createdAt,
    profile: {
      onboardingComplete: false,
      onboardingStep: 0,
      privacyReviewVersion: 0,
      experience: null,
      aim: null,
      geminiSetup: null,
      displayName: "",
      calendarOptIn: false
    },
    preferences: {
      theme: "paper",
      language: "en",
      autoSort: false,
      autoDailyBudget: false,
      planningEnabled: false,
      focusMinutes: 25,
      breakMinutes: 5,
      cycles: 4,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      dailyBudgetMinutes: 120,
      dayStart: "08:00",
      dayEnd: "21:30",
      bufferMinutes: 10,
      allowMultipleFocusBlocks: null,
      planningAssistance: "guided",
      model: DEFAULT_MODEL
    },
    aiUsage: normalizeAiUsage(null, now),
    kanban: normalizeKanban(null),
    memory: normalizeMemory({ enabled: false }),
    tasks: [],
    dayPlans: [],
    schedule: [],
    proposals: [],
    focus: emptyFocus(),
    sessions: [],
    feedback: [],
    events: []
  };
}

export function emptyFocus(lastSummary = null) {
  return {
    status: "idle",
    phase: "focus",
    mode: "single",
    pomodoroId: null,
    focusSeconds: 1500,
    totalFocusedSeconds: 0,
    longBreakMinutes: 15,
    longBreakEvery: 4,
    breakKind: "short",
    taskId: null,
    blockId: null,
    startedAt: null,
    endsAt: null,
    pausedAt: null,
    remainingSeconds: 0,
    plannedSeconds: 0,
    breakMinutes: 5,
    targetCycles: 1,
    completedCycles: 0,
    activeSessionId: null,
    lastSummary
  };
}

function normalizeProfile(value, base) {
  const source = isPlainObject(value) ? value : {};
  return {
    onboardingComplete: Boolean(source.onboardingComplete),
    onboardingStep: clamp(source.onboardingStep ?? base.onboardingStep, 0, 3),
    privacyReviewVersion: source.privacyReviewVersion === 1 ? 1 : 0,
    experience: ["beginner", "system"].includes(source.experience) ? source.experience : null,
    aim: ["study", "deep-work", "creative", "general"].includes(source.aim) ? source.aim : null,
    geminiSetup: ["now", "later"].includes(source.geminiSetup) ? source.geminiSetup : null,
    displayName: typeof source.displayName === "string" ? source.displayName.slice(0, 60) : "",
    calendarOptIn: Boolean(source.calendarOptIn)
  };
}

function validClock(value, fallback) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? "")) ? value : fallback;
}

function normalizePreferences(value, base) {
  const source = isPlainObject(value) ? value : {};
  return {
    theme: THEMES.has(source.theme) ? source.theme : base.theme,
    language: source.language === "vi" ? "vi" : "en",
    autoSort: source.autoSort === true,
    autoDailyBudget: source.autoDailyBudget === true,
    planningEnabled: source.planningEnabled === true,
    focusMinutes: clamp(source.focusMinutes ?? base.focusMinutes, 5, 180),
    breakMinutes: clamp(source.breakMinutes ?? base.breakMinutes, 1, 60),
    cycles: Math.round(clamp(source.cycles ?? base.cycles, 1, 8)),
    longBreakMinutes: Math.round(clamp(source.longBreakMinutes ?? base.longBreakMinutes, 1, 60)),
    longBreakEvery: Math.round(clamp(source.longBreakEvery ?? base.longBreakEvery, 1, 8)),
    dailyBudgetMinutes: Math.round(clamp(source.dailyBudgetMinutes ?? base.dailyBudgetMinutes, 0, 1440)),
    dayStart: validClock(source.dayStart, base.dayStart),
    dayEnd: validClock(source.dayEnd, base.dayEnd),
    bufferMinutes: clamp(source.bufferMinutes ?? base.bufferMinutes, 0, 60),
    allowMultipleFocusBlocks: typeof source.allowMultipleFocusBlocks === "boolean" ? source.allowMultipleFocusBlocks : null,
    planningAssistance: source.planningAssistance === "suggest" ? "suggest" : "guided",
    model: typeof source.model === "string" && source.model.trim()
      ? source.model.trim().slice(0, 100)
      : base.model
  };
}

export function normalizeTask(value) {
  if (!isPlainObject(value) || typeof value.title !== "string" || !value.title.trim()) return null;
  const createdAt = toIso(value.createdAt, new Date().toISOString());
  const status = TASK_STATUSES.has(value.status) ? value.status : "inbox";
  return {
    id: typeof value.id === "string" && value.id ? value.id : uid("task"),
    title: value.title.trim().slice(0, 160),
    notes: typeof value.notes === "string" ? value.notes.trim().slice(0, 4000) : "",
    durationMinutes: clamp(value.durationMinutes ?? value.duration_minutes ?? 25, 5, 480),
    energy: ENERGY_LEVELS.has(value.energy) ? value.energy : "medium",
    priority: PRIORITIES.has(value.priority) ? value.priority : "normal",
    important: typeof value.important === "boolean" ? value.important : null,
    urgency: ["urgent", "not-urgent"].includes(value.urgency) ? value.urgency : "auto",
    dueAt: toIso(value.dueAt ?? value.due_at, null),
    sortLocked: value.sortLocked === true,
    sortSource: ["ai", "rules", "manual"].includes(value.sortSource) ? value.sortSource : null,
    sortNote: typeof value.sortNote === "string" ? value.sortNote.slice(0, 160) : "",
    sortFingerprint: typeof value.sortFingerprint === "string" ? value.sortFingerprint.slice(0, 16000) : "",
    status,
    source: value.source === "gemini" ? "gemini" : "manual",
    createdAt,
    updatedAt: toIso(value.updatedAt, createdAt),
    completedAt: status === "done" ? toIso(value.completedAt, createdAt) : null
  };
}

export function normalizeBlock(value) {
  if (!isPlainObject(value)) return null;
  const start = safeDate(value.startAt);
  const end = safeDate(value.endAt);
  if (!start || !end || end <= start || typeof value.taskId !== "string") return null;
  return {
    id: typeof value.id === "string" && value.id ? value.id : uid("block", start.getTime()),
    taskId: value.taskId,
    label: typeof value.label === "string" ? value.label.trim().slice(0, 160) : "",
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    status: BLOCK_STATUSES.has(value.status) ? value.status : "planned",
    source: ["manual", "capture"].includes(value.source) ? value.source : "proposal",
    proposalId: typeof value.proposalId === "string" ? value.proposalId : null,
    createdAt: toIso(value.createdAt, new Date().toISOString())
  };
}

function normalizeProposal(value) {
  if (!isPlainObject(value) || !Array.isArray(value.blocks)) return null;
  const blocks = value.blocks.map(normalizeBlock).filter(Boolean);
  return {
    id: typeof value.id === "string" && value.id ? value.id : uid("proposal"),
    createdAt: toIso(value.createdAt, new Date().toISOString()),
    status: ["pending", "applied", "dismissed"].includes(value.status) ? value.status : "pending",
    blocks,
    unscheduledTaskIds: Array.isArray(value.unscheduledTaskIds)
      ? value.unscheduledTaskIds.filter(id => typeof id === "string")
      : [],
    explanation: isPlainObject(value.explanation) ? value.explanation : null
  };
}

function normalizeSession(value) {
  if (!isPlainObject(value)) return null;
  const startedAt = safeDate(value.startedAt);
  const endedAt = safeDate(value.endedAt);
  if (!startedAt || !endedAt || endedAt < startedAt) return null;
  return {
    id: typeof value.id === "string" && value.id ? value.id : uid("session", startedAt.getTime()),
    taskId: typeof value.taskId === "string" ? value.taskId : null,
    blockId: typeof value.blockId === "string" ? value.blockId : null,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    plannedSeconds: clamp(value.plannedSeconds ?? 0, 0, 86_400),
    focusedSeconds: clamp(value.focusedSeconds ?? 0, 0, 86_400),
    outcome: value.outcome === "completed" ? "completed" : "stopped",
    mode: value.mode === "pomodoro" ? "pomodoro" : "single",
    pomodoroId: typeof value.pomodoroId === "string" ? value.pomodoroId : null,
    cycleNumber: Math.round(clamp(value.cycleNumber ?? 1, 1, 8))
  };
}

function normalizeFocus(value, base) {
  const source = isPlainObject(value) ? value : {};
  const status = ["idle", "running", "paused", "ready", "complete"].includes(source.status) ? source.status : "idle";
  if (status === "idle") return emptyFocus(isPlainObject(source.lastSummary) ? source.lastSummary : null);
  return {
    status,
    phase: source.phase === "break" ? "break" : "focus",
    mode: source.mode === "pomodoro" ? "pomodoro" : "single",
    pomodoroId: typeof source.pomodoroId === "string" ? source.pomodoroId : null,
    focusSeconds: clamp(source.focusSeconds ?? source.plannedSeconds ?? 1500, 60, 28800),
    totalFocusedSeconds: clamp(source.totalFocusedSeconds ?? 0, 0, 230400),
    longBreakMinutes: Math.round(clamp(source.longBreakMinutes ?? base.longBreakMinutes, 1, 60)),
    longBreakEvery: Math.round(clamp(source.longBreakEvery ?? base.longBreakEvery, 1, 8)),
    breakKind: source.breakKind === "long" ? "long" : "short",
    taskId: typeof source.taskId === "string" ? source.taskId : null,
    blockId: typeof source.blockId === "string" ? source.blockId : null,
    startedAt: toIso(source.startedAt, null),
    endsAt: toIso(source.endsAt, null),
    pausedAt: toIso(source.pausedAt, null),
    remainingSeconds: clamp(source.remainingSeconds ?? 0, 0, 86_400),
    plannedSeconds: clamp(source.plannedSeconds ?? 0, 0, 86_400),
    breakMinutes: clamp(source.breakMinutes ?? base.breakMinutes, 1, 60),
    targetCycles: Math.round(clamp(source.targetCycles ?? 1, 1, 8)),
    completedCycles: Math.round(clamp(source.completedCycles ?? 0, 0, 8)),
    activeSessionId: typeof source.activeSessionId === "string" ? source.activeSessionId : null,
    lastSummary: isPlainObject(source.lastSummary) ? source.lastSummary : null
  };
}

export function normalizeState(value, now = new Date()) {
  const base = createDefaultState(now);
  const source = isPlainObject(value) ? value : {};
  const preferences = normalizePreferences(source.preferences, base.preferences);
  const tasks = Array.isArray(source.tasks) ? source.tasks.map(normalizeTask).filter(Boolean) : [];
  const taskIds = new Set(tasks.map(task => task.id));
  const schedule = Array.isArray(source.schedule)
    ? source.schedule.map(normalizeBlock).filter(block => block && taskIds.has(block.taskId))
    : [];
  const profile = normalizeProfile(source.profile, base.profile);
  const memory = normalizeMemory(source.memory ?? (isPlainObject(value) ? undefined : base.memory));
  if (isPlainObject(value) && (Number(source.schemaVersion) || 0) < 6 && !memory.customInstructions && !memory.updatedAt) {
    // Earlier releases persisted an off value even before the user touched
    // memory. Adopt the new default only for that empty, untouched state.
    memory.enabled = true;
  }
  if ((Number(source.schemaVersion) || 0) < 3) {
    if (!profile.onboardingComplete && profile.onboardingStep <= 1) profile.experience = null;
    if (!profile.onboardingComplete && profile.onboardingStep <= 2) profile.aim = null;
    if (profile.onboardingComplete) profile.geminiSetup = "later";
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    schedulingRevision: Math.max(0, Number(source.schedulingRevision) || 0),
    createdAt: toIso(source.createdAt, base.createdAt),
    updatedAt: toIso(source.updatedAt, base.updatedAt),
    profile,
    preferences,
    memory,
    aiUsage: normalizeAiUsage(source.aiUsage, now),
    kanban: normalizeKanban(source.kanban, taskIds),
    tasks,
    dayPlans: Array.isArray(source.dayPlans) ? [...new Map(source.dayPlans.filter(item => isPlainObject(item) && /^\d{4}-\d{2}-\d{2}$/.test(item.date)).map(item => [item.date, {
      date: item.date,
      budgetSource: ["manual", "automatic"].includes(item.budgetSource) ? item.budgetSource : "default",
      availableMinutes: Math.round(clamp(item.availableMinutes ?? preferences.dailyBudgetMinutes, 0, 1440)),
      taskIds: [...new Set((Array.isArray(item.taskIds) ? item.taskIds : []).filter(id => taskIds.has(id)))]
    }])).values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-90) : [],
    schedule,
    proposals: Array.isArray(source.proposals) ? source.proposals.map(normalizeProposal).filter(Boolean).slice(-50) : [],
    focus: normalizeFocus(source.focus, preferences),
    sessions: Array.isArray(source.sessions) ? source.sessions.map(normalizeSession).filter(Boolean).slice(-2000) : [],
    feedback: Array.isArray(source.feedback)
      ? source.feedback.filter(isPlainObject).map(item => ({
          id: typeof item.id === "string" ? item.id : uid("feedback"),
          text: typeof item.text === "string" ? item.text.slice(0, 2000) : "",
          createdAt: toIso(item.createdAt, base.createdAt)
        })).filter(item => item.text)
      : [],
    events: Array.isArray(source.events)
      ? source.events.filter(isPlainObject).map(item => ({
          id: typeof item.id === "string" ? item.id : uid("event"),
          type: typeof item.type === "string" ? item.type.slice(0, 80) : "unknown",
          at: toIso(item.at, base.createdAt),
          data: isPlainObject(item.data) ? item.data : {}
        })).slice(-5000)
      : []
  };
}

export function touch(state, now = new Date()) {
  const next = deepClone(state);
  next.updatedAt = toIso(now, new Date().toISOString());
  return next;
}

export function updateMemory(state, draft, now = new Date()) {
  if (typeof draft?.customInstructions !== "string") throw new Error("Enter custom instructions as text.");
  if (draft.customInstructions.length > MAX_CUSTOM_INSTRUCTIONS_LENGTH) {
    throw new Error(`Keep custom instructions within ${MAX_CUSTOM_INSTRUCTIONS_LENGTH} characters.`);
  }
  const previous = normalizeMemory(state.memory);
  const memory = normalizeMemory({ ...draft, enabled: draft.enabled === undefined ? previous.enabled : draft.enabled });
  if (memory.enabled === previous.enabled && memory.customInstructions === previous.customInstructions) return deepClone(state);
  const next = touch(state, now);
  next.memory = { ...memory, updatedAt: next.updatedAt };
  // Do not duplicate personal text into event history or model-generated output.
  return next;
}

export function appendEvent(state, type, data = {}, now = new Date()) {
  const next = touch(state, now);
  next.events.push({ id: uid("event", safeDate(now)?.getTime()), type, at: toIso(now), data: isPlainObject(data) ? data : {} });
  next.events = next.events.slice(-5000);
  return next;
}

export function addTask(state, draft, now = new Date()) {
  const task = normalizeTask({
    ...draft,
    id: draft?.id ?? uid("task", safeDate(now)?.getTime()),
    createdAt: toIso(now),
    updatedAt: toIso(now),
    status: "inbox"
  });
  if (!task) throw new Error("A task title is required.");
  let next = deepClone(state);
  next.tasks.push(task);
  next = appendEvent(next, "task_created", { taskId: task.id, source: task.source }, now);
  return { state: next, task };
}

export function updateTask(state, taskId, changes, now = new Date()) {
  const next = deepClone(state);
  const index = next.tasks.findIndex(task => task.id === taskId);
  if (index < 0) throw new Error("Task not found.");
  const candidate = normalizeTask({ ...next.tasks[index], ...changes, id: taskId, updatedAt: toIso(now) });
  if (!candidate) throw new Error("A task title is required.");
  next.tasks[index] = candidate;
  return appendEvent(next, "task_updated", { taskId }, now);
}

export function completeTask(state, taskId, now = new Date()) {
  let next = deepClone(state);
  const task = next.tasks.find(item => item.id === taskId);
  if (!task) throw new Error("Task not found.");
  task.status = "done";
  task.completedAt = toIso(now);
  task.updatedAt = toIso(now);
  for (const block of next.schedule) {
    if (block.taskId === taskId && block.status === "planned") block.status = "skipped";
  }
  return appendEvent(next, "task_completed", { taskId }, now);
}

export function archiveTask(state, taskId, now = new Date()) {
  let next = deepClone(state);
  const task = next.tasks.find(item => item.id === taskId);
  if (!task) throw new Error("Task not found.");
  task.status = "archived";
  task.completedAt = null;
  task.updatedAt = toIso(now);
  for (const block of next.schedule) {
    if (block.taskId === taskId && block.status === "planned") block.status = "skipped";
  }
  return appendEvent(next, "task_archived", { taskId }, now);
}

export function pendingProposal(state) {
  return [...state.proposals].reverse().find(proposal => proposal.status === "pending") ?? null;
}

export function saveProposal(state, proposal, now = new Date()) {
  let next = deepClone(state);
  next.proposals = next.proposals.map(item => item.status === "pending" ? { ...item, status: "dismissed" } : item);
  next.proposals.push(proposal);
  next.proposals = next.proposals.slice(-50);
  return appendEvent(next, "schedule_proposed", { proposalId: proposal.id, blockCount: proposal.blocks.length }, now);
}

export function applyProposal(state, proposalId, now = new Date()) {
  const next = deepClone(state);
  const proposal = next.proposals.find(item => item.id === proposalId);
  if (!proposal || proposal.status !== "pending") throw new Error("Pending proposal not found.");
  const activeBlocks = next.schedule.filter(block => !["done", "skipped"].includes(block.status));
  for (const block of proposal.blocks) {
    if (!next.tasks.some(task => task.id === block.taskId)) throw new Error("The proposal references a missing task.");
    const start = safeDate(block.startAt);
    const end = safeDate(block.endAt);
    const conflict = activeBlocks.some(existing => {
      const existingStart = safeDate(existing.startAt);
      const existingEnd = safeDate(existing.endAt);
      return start && end && existingStart && existingEnd && start < existingEnd && existingStart < end;
    });
    if (conflict) throw new Error("The schedule changed after this proposal was created. Create a fresh proposal.");
    activeBlocks.push(block);
  }
  const existingIds = new Set(next.schedule.map(block => block.id));
  for (const block of proposal.blocks) {
    if (!existingIds.has(block.id)) next.schedule.push({ ...block, proposalId, status: "planned" });
    const task = next.tasks.find(item => item.id === block.taskId);
    if (task && task.status === "inbox") task.status = "planned";
  }
  proposal.status = "applied";
  next.schedule.sort((a, b) => a.startAt.localeCompare(b.startAt));
  return appendEvent(next, "schedule_applied", { proposalId, blockCount: proposal.blocks.length }, now);
}

export function dismissProposal(state, proposalId, now = new Date()) {
  const next = deepClone(state);
  const proposal = next.proposals.find(item => item.id === proposalId);
  if (!proposal) return next;
  proposal.status = "dismissed";
  return appendEvent(next, "schedule_dismissed", { proposalId }, now);
}

export function createBackup(state, now = new Date(), learnedMemory = null) {
  const normalized = normalizeState(state, now);
  delete normalized.gemini;
  return {
    format: "studio-backup",
    version: SCHEMA_VERSION,
    exportedAt: toIso(now),
    state: normalized,
    ...(learnedMemory ? { learnedMemory: exportLearnedMemory(learnedMemory) } : {})
  };
}

export function restoreBackup(value, now = new Date()) {
  if (!isPlainObject(value) || value.format !== "studio-backup" || !isPlainObject(value.state)) {
    throw new Error("This is not a Stuđiô backup file.");
  }
  let next = normalizeState(value.state, now);
  next = appendEvent(next, "backup_imported", { sourceVersion: Number(value.version) || 1 }, now);
  return next;
}

export function createDemoState(now = new Date()) {
  let state = createDefaultState(now);
  state.profile = { ...state.profile, onboardingComplete: true, onboardingStep: 3, experience: "beginner", aim: "study", geminiSetup: "later", displayName: "" };
  const later = new Date(now.getTime() + 3_600_000);
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const first = addTask(state, { title: "Review attention paper", durationMinutes: 45, energy: "high", priority: "high", dueAt: tomorrow.toISOString(), notes: "" }, now);
  state = first.state;
  const second = addTask(state, { title: "Outline experiment notes", durationMinutes: 30, energy: "medium", priority: "normal", dueAt: tomorrow.toISOString(), notes: "" }, now);
  state = second.state;
  state.schedule.push({
    id: uid("block", later.getTime()),
    taskId: first.task.id,
    startAt: later.toISOString(),
    endAt: new Date(later.getTime() + 45 * 60_000).toISOString(),
    status: "planned",
    source: "manual",
    proposalId: null,
    createdAt: now.toISOString()
  });
  return state;
}

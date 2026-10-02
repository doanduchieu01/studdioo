import { clamp, isPlainObject, toIso } from "./utils.js";

export const KANBAN_STAGES = ["backlog", "ready", "doing"];
export const KANBAN_REASONS = ["picked_today", "scheduled_today", "timer_started"];

export function normalizeKanbanItem(value = {}) {
  return {
    taskId: typeof value.taskId === "string" ? value.taskId : "",
    stage: KANBAN_STAGES.includes(value.stage) ? value.stage : "backlog",
    readyAt: toIso(value.readyAt, value.stage === "ready" ? toIso(value.changedAt) : null),
    startedAt: toIso(value.startedAt),
    changedAt: toIso(value.changedAt),
    blockedReason: typeof value.blockedReason === "string" ? value.blockedReason.trim().slice(0, 300) : "",
    manualHold: value.manualHold === true,
    revision: Math.round(clamp(value.revision ?? 0, 0, Number.MAX_SAFE_INTEGER))
  };
}

export function normalizeKanban(value, taskIds = new Set()) {
  const source = isPlainObject(value) ? value : {};
  const items = Array.isArray(source.items) ? source.items.filter(isPlainObject).map(normalizeKanbanItem).filter(item => taskIds.has(item.taskId)) : [];
  const changes = Array.isArray(source.changes) ? source.changes.filter(isPlainObject).filter(change => typeof change.id === "string" && taskIds.has(change.taskId) && KANBAN_REASONS.includes(change.reason) && toIso(change.at) && isPlainObject(change.before) && isPlainObject(change.after)).map(change => ({
    id: change.id.slice(0, 180), taskId: change.taskId, at: toIso(change.at), reason: change.reason,
    before: normalizeKanbanItem({ ...change.before, taskId: change.taskId }),
    after: normalizeKanbanItem({ ...change.after, taskId: change.taskId }),
    evidence: {
      date: /^\d{4}-\d{2}-\d{2}$/.test(change.evidence?.date) ? change.evidence.date : "",
      blockId: typeof change.evidence?.blockId === "string" ? change.evidence.blockId.slice(0, 180) : "",
      sessionId: typeof change.evidence?.sessionId === "string" ? change.evidence.sessionId.slice(0, 180) : ""
    }, undoneAt: toIso(change.undoneAt)
  })).slice(-100) : [];
  return {
    enabled: source.enabled === true,
    offerDismissed: source.offerDismissed === true,
    enabledAt: toIso(source.enabledAt),
    reviewedAt: toIso(source.reviewedAt),
    wipLimit: Math.round(clamp(source.wipLimit ?? 2, 1, 10)),
    ageDays: Math.round(clamp(source.ageDays ?? 3, 1, 30)),
    autoReady: source.autoReady !== false,
    autoStart: source.autoStart !== false,
    showHints: source.showHints !== false,
    items: [...new Map(items.map(item => [item.taskId, item])).values()],
    changes
  };
}

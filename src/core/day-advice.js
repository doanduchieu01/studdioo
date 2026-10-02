import { buildCaptureContext } from "./capture.js";
import { computeAnalytics } from "./analytics.js";
import { isPlainObject } from "./utils.js";

export const ADVICE_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    overview: { type: "string" },
    suggestions: { type: "array", items: {
      type: "object", additionalProperties: false,
      properties: { task_id: { type: "string" }, title: { type: "string" }, reason: { type: "string" }, duration_minutes: { type: "integer", minimum: 5, maximum: 180 } },
      required: ["task_id", "title", "reason", "duration_minutes"]
    } }
  }, required: ["overview", "suggestions"]
};

export function buildDayAdviceRequest(state, now = new Date(), timezone) {
  const context = buildCaptureContext(state, now, timezone);
  const tasks = state.tasks.filter(task => !["done", "archived"].includes(task.status))
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") || (a.priority === "high" ? -1 : 0) - (b.priority === "high" ? -1 : 0)).slice(0, 20)
    .map(task => ({ id: task.id, title: task.title, notes: task.notes.slice(0, 500), duration_minutes: task.durationMinutes, due_at: task.dueAt, priority: task.priority, status: task.status }));
  const taskIds = new Set(tasks.map(task => task.id));
  const scheduled = state.schedule.filter(block => taskIds.has(block.taskId) && !["done", "skipped"].includes(block.status) && block.endAt >= context.now && block.startAt <= context.latest_end).slice(0, 30)
    .map(block => ({ task_id: block.taskId, label: block.label, start_at: block.startAt, end_at: block.endAt }));
  const analytics = computeAnalytics(state, now);
  return {
    input: [
      "Help the user choose a manageable next step today. This is read-only advice; nothing is scheduled, created, changed, or started.",
      "Use the current task and schedule snapshot as facts. Return at most three suggestions. If there are active tasks, select only from their exact ids and preserve their titles. Do not duplicate existing tasks or invent deadlines.",
      "If no active task exists, you may suggest a small new step grounded in saved project context, with task_id empty. If there is no relevant context, return no suggestions and ask for one current goal in overview.",
      "Use preferences and supported observations as guidance, state uncertainty, and respect current constraints. Suggested minutes are a starting interval, not a claim that the entire task will be finished.",
      "Recorded timer minutes do not measure digital-device usage or prove attention, learning, or productivity. Device usage has not been measured in this build.",
      JSON.stringify({ planning_context: context, active_tasks: tasks, scheduled_blocks: scheduled, recorded_timer_minutes_7d: analytics.totalFocusedMinutes, device_usage_available: false })
    ].join("\n"), schema: ADVICE_SCHEMA, schemaVariant: "day-advice-v1", taskIds: [...taskIds]
  };
}

export function validateDayAdvice(value, state, taskIds) {
  if (!isPlainObject(value) || typeof value.overview !== "string" || !value.overview.trim() || value.overview.length > 1200 || !Array.isArray(value.suggestions) || value.suggestions.length > 3) throw new Error("Gemini returned invalid next-step advice.");
  const seen = new Set();
  return {
    overview: value.overview.trim(),
    suggestions: value.suggestions.map(item => {
      if (!isPlainObject(item) || typeof item.task_id !== "string" || typeof item.title !== "string" || !item.title.trim() || item.title.length > 160 || typeof item.reason !== "string" || !item.reason.trim() || item.reason.length > 800 || !Number.isInteger(item.duration_minutes) || item.duration_minutes < 5 || item.duration_minutes > 180) throw new Error("Gemini returned an invalid next-step suggestion.");
      if ((taskIds.length && !taskIds.includes(item.task_id)) || (!taskIds.length && item.task_id)) throw new Error("Gemini referred to a task outside the current snapshot.");
      if (item.task_id && seen.has(item.task_id)) throw new Error("Gemini repeated a task recommendation.");
      if (item.task_id) seen.add(item.task_id);
      const task = item.task_id ? state.tasks.find(task => task.id === item.task_id) : null;
      return { taskId: task?.id ?? null, title: task?.title ?? item.title.trim(), reason: item.reason.trim(), durationMinutes: item.duration_minutes };
    })
  };
}

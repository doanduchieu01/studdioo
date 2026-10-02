import { dayPlan } from "./time-management.js";
import { nextBlock } from "./scheduler.js";
import { localDateKey } from "./utils.js";

export function nextFocus(state, now = new Date()) {
  const active = state.tasks.filter(task => !["done", "archived"].includes(task.status));
  const next = nextBlock(state, now);
  const block = next && localDateKey(next.startAt) === localDateKey(now) && active.some(t => t.id === next.taskId) ? next : null;
  const chosen = dayPlan(state, now).taskIds.map(id => active.find(task => task.id === id)).find(Boolean);
  const task = block ? active.find(t => t.id === block.taskId) : chosen ?? active[0] ?? null;
  return { task, block, minutes: block ? Math.round((new Date(block.endAt) - new Date(block.startAt)) / 60000) : state.preferences.focusMinutes };
}

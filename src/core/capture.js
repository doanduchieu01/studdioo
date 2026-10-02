import { addTask, appendEvent } from "./state.js";
import { atLocalClock, deepClone, isPlainObject, roundUpTime, safeDate } from "./utils.js";

export const MAX_CAPTURE_TASKS = 6;
export const MAX_CAPTURE_BLOCKS = 12;

export function multipleFocusBlocksEnabled(state) {
  const choice = state.preferences?.allowMultipleFocusBlocks;
  return typeof choice === "boolean" ? choice : state.profile?.experience === "beginner";
}

function windowEnd(now) {
  const end = new Date(now);
  end.setDate(end.getDate() + 7);
  return end;
}

function busyIntervals(state, now) {
  const intervals = state.schedule
    .filter(block => !["done", "skipped"].includes(block.status))
    .map(block => ({ start: safeDate(block.startAt), end: safeDate(block.endAt) }))
    .filter(item => item.start && item.end && item.end > item.start);
  const focusEnd = safeDate(state.focus?.endsAt);
  if (state.focus?.status === "running" && focusEnd > now) intervals.push({ start: new Date(now), end: focusEnd });
  return intervals;
}

export function buildCaptureContext(state, now = new Date(), timezone = "local time") {
  const end = windowEnd(now);
  const buffer = state.preferences.bufferMinutes * 60_000;
  const intervals = busyIntervals(state, now)
    .filter(item => item.end.getTime() + buffer > now.getTime() && item.start.getTime() - buffer < end.getTime())
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const item of intervals) {
    const previous = merged.at(-1);
    if (previous && item.start <= previous.end) previous.end = new Date(Math.max(previous.end, item.end));
    else merged.push({ ...item });
  }
  if (merged.length > 200) throw new Error("There are too many busy periods for one capture. Turn multiple focus blocks off to capture a task only.");
  return {
    now: now.toISOString(),
    earliest_start: roundUpTime(new Date(now.getTime() + 5 * 60_000), 5).toISOString(),
    latest_end: end.toISOString(),
    timezone: String(timezone).slice(0, 100),
    workday_start: state.preferences.dayStart,
    workday_end: state.preferences.dayEnd,
    preferred_focus_minutes: state.preferences.focusMinutes,
    buffer_minutes: state.preferences.bufferMinutes,
    busy_periods: merged.map(item => ({ start_at: item.start.toISOString(), end_at: item.end.toISOString() }))
  };
}

function requiredText(value, label, maximum, allowEmpty = false) {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && !value.trim())) {
    throw new Error(`${label} must be ${allowEmpty ? "" : "non-empty "}text within ${maximum} characters.`);
  }
  return value.trim();
}

export function captureSelection(draft) {
  if (!isPlainObject(draft) || !Array.isArray(draft.tasks) || draft.tasks.length < 1 || draft.tasks.length > MAX_CAPTURE_TASKS) {
    throw new Error(`Review between 1 and ${MAX_CAPTURE_TASKS} tasks.`);
  }
  let blockCount = 0;
  const tasks = draft.tasks.flatMap((task, taskIndex) => {
    if (!isPlainObject(task) || !Array.isArray(task.focusBlocks) || !task.focusBlocks.length) throw new Error("Each task needs focus blocks to review.");
    blockCount += task.focusBlocks.length;
    if (blockCount > MAX_CAPTURE_BLOCKS) throw new Error(`A capture can contain at most ${MAX_CAPTURE_BLOCKS} focus blocks.`);
    const blocks = task.focusBlocks.flatMap((block, blockIndex) => {
      if (!isPlainObject(block)) throw new Error("Invalid focus block.");
      if (block.selected === false) return [];
      if (!Number.isInteger(block.durationMinutes) || block.durationMinutes < 5 || block.durationMinutes > 180) throw new Error("Each focus block must last 5–180 whole minutes.");
      const start = safeDate(block.startAt);
      if (block.startAt && !start) throw new Error("A focus block has an invalid start time.");
      return [{
        blockIndex,
        label: requiredText(block.label, "Block name", 160),
        durationMinutes: block.durationMinutes,
        startAt: start?.toISOString() ?? null
      }];
    });
    if (!blocks.length) return [];
    const durationMinutes = blocks.reduce((sum, block) => sum + block.durationMinutes, 0);
    if (durationMinutes > 480) throw new Error("Selected blocks for one task cannot exceed 480 minutes.");
    const due = safeDate(task.dueAt);
    if (task.dueAt && !due) throw new Error("A task has an invalid deadline.");
    if (!["low", "medium", "high"].includes(task.energy) || !["low", "normal", "high"].includes(task.priority)) throw new Error("Choose a valid energy level and priority.");
    return [{
      taskIndex,
      title: requiredText(task.title, "Task title", 160),
      notes: requiredText(task.notes ?? "", "Task notes", 1000, true),
      energy: task.energy,
      priority: task.priority,
      dueAt: due?.toISOString() ?? null,
      durationMinutes,
      blocks
    }];
  });
  if (!tasks.length) throw new Error("Select at least one focus block to add.");
  return tasks;
}

function fitsWorkday(start, end, preferences) {
  // A post-midnight block may belong to the previous overnight workday.
  return [-1, 0].some(offset => {
    const day = new Date(start);
    day.setDate(day.getDate() + offset);
    const from = atLocalClock(day, preferences.dayStart);
    const to = atLocalClock(day, preferences.dayEnd);
    if (to <= from) to.setDate(to.getDate() + 1);
    return start >= from && end <= to;
  });
}

export function captureIssues(state, draft, now = new Date()) {
  let tasks;
  try { tasks = captureSelection(draft); } catch (error) { return [error.message]; }
  const issues = [];
  const occupied = busyIntervals(state, now);
  const buffer = state.preferences.bufferMinutes * 60_000;
  const latestEnd = windowEnd(now);
  for (const task of tasks) {
    for (const block of task.blocks) {
      const label = `Task ${task.taskIndex + 1}, block ${block.blockIndex + 1}`;
      const start = safeDate(block.startAt);
      if (!start) { issues.push(`${label}: choose a start time.`); continue; }
      const end = new Date(start.getTime() + block.durationMinutes * 60_000);
      if (start < now) issues.push(`${label}: the start time has passed. Choose a future time.`);
      if (end > latestEnd) issues.push(`${label}: choose a time within the next seven days.`);
      if (task.dueAt && end > new Date(task.dueAt)) issues.push(`${label}: the block ends after its task deadline.`);
      if (!fitsWorkday(start, end, state.preferences)) issues.push(`${label}: choose a time within your workday hours.`);
      if (occupied.some(item => start.getTime() < item.end.getTime() + buffer && item.start.getTime() < end.getTime() + buffer)) {
        issues.push(`${label}: overlaps another block or leaves less than ${state.preferences.bufferMinutes} minutes of buffer.`);
      }
      occupied.push({ start, end });
    }
  }
  return issues;
}

export function applyCaptureDraft(state, draft, now = new Date()) {
  if (typeof draft?.id !== "string" || !/^capture-[a-zA-Z0-9-]{8,100}$/.test(draft.id)) throw new Error("This capture needs to be generated again.");
  if (state.tasks.some(task => task.id.startsWith(`task-${draft.id}-`))) throw new Error("These focus blocks have already been added.");
  const issues = captureIssues(state, draft, now);
  if (issues.length) throw new Error(issues[0]);
  const selection = captureSelection(draft);
  let next = deepClone(state);
  let blockCount = 0;
  for (const task of selection) {
    const taskId = `task-${draft.id}-${task.taskIndex}`;
    const added = addTask(next, { ...task, id: taskId, source: "gemini" }, now);
    next = added.state;
    next.tasks.find(item => item.id === taskId).status = "planned";
    for (const block of task.blocks) {
      next.schedule.push({
        id: `block-${draft.id}-${task.taskIndex}-${block.blockIndex}`,
        taskId,
        label: block.label,
        startAt: block.startAt,
        endAt: new Date(new Date(block.startAt).getTime() + block.durationMinutes * 60_000).toISOString(),
        status: "planned",
        source: "capture",
        proposalId: null,
        createdAt: now.toISOString()
      });
      blockCount += 1;
    }
  }
  next.schedule.sort((a, b) => a.startAt.localeCompare(b.startAt));
  const reviewEdits = selection.flatMap(task => task.blocks.flatMap(block => {
    const original = draft.originalTasks?.[task.taskIndex]?.focusBlocks?.[block.blockIndex];
    return original && original.durationMinutes !== block.durationMinutes
      ? [{ title: task.title, beforeMinutes: original.durationMinutes, afterMinutes: block.durationMinutes }] : [];
  }));
  next = appendEvent(next, "capture_blocks_added", { captureId: draft.id, taskCount: selection.length, blockCount, ...(reviewEdits.length ? { reviewEdits } : {}) }, now);
  return { state: next, taskCount: selection.length, blockCount };
}

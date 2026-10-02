import { atLocalClock, localDateKey, roundUpTime, safeDate, uid } from "./utils.js";

const PRIORITY_SCORE = { high: 0, normal: 1, low: 2 };

function taskOrder(a, b) {
  const dueA = safeDate(a.dueAt)?.getTime() ?? Number.POSITIVE_INFINITY;
  const dueB = safeDate(b.dueAt)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (dueA !== dueB) return dueA - dueB;
  const priority = (PRIORITY_SCORE[a.priority] ?? 1) - (PRIORITY_SCORE[b.priority] ?? 1);
  if (priority) return priority;
  return String(a.createdAt).localeCompare(String(b.createdAt));
}

export function intervalsOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

export function detectConflicts(blocks) {
  const sorted = blocks
    .map(block => ({ block, start: safeDate(block.startAt), end: safeDate(block.endAt) }))
    .filter(item => item.start && item.end)
    .sort((a, b) => a.start - b.start);
  const conflicts = [];
  for (let index = 0; index < sorted.length; index += 1) {
    for (let other = index + 1; other < sorted.length; other += 1) {
      if (sorted[other].start >= sorted[index].end) break;
      if (intervalsOverlap(sorted[index].start, sorted[index].end, sorted[other].start, sorted[other].end)) {
        conflicts.push([sorted[index].block.id, sorted[other].block.id]);
      }
    }
  }
  return conflicts;
}

function occupiedIntervals(state, proposedBlocks) {
  return [...state.schedule, ...proposedBlocks]
    .filter(block => !["done", "skipped"].includes(block.status))
    .map(block => ({ start: safeDate(block.startAt), end: safeDate(block.endAt) }))
    .filter(item => item.start && item.end)
    .sort((a, b) => a.start - b.start);
}

function findSlot({ state, proposedBlocks, durationMinutes, dueAt, now, horizonDays }) {
  const durationMs = durationMinutes * 60_000;
  const bufferMs = state.preferences.bufferMinutes * 60_000;
  const deadline = safeDate(dueAt);
  for (let offset = 0; offset < horizonDays; offset += 1) {
    const day = new Date(now);
    day.setDate(day.getDate() + offset);
    const dayStart = atLocalClock(day, state.preferences.dayStart);
    const dayEnd = atLocalClock(day, state.preferences.dayEnd);
    if (dayEnd <= dayStart) dayEnd.setDate(dayEnd.getDate() + 1);
    let cursor = offset === 0 ? roundUpTime(new Date(Math.max(now.getTime(), dayStart.getTime())), 5) : dayStart;
    const occupied = occupiedIntervals(state, proposedBlocks)
      .filter(item => intervalsOverlap(dayStart, dayEnd, item.start, item.end));
    for (const interval of occupied) {
      const candidateEnd = new Date(cursor.getTime() + durationMs);
      if (candidateEnd.getTime() + bufferMs <= interval.start.getTime() && candidateEnd <= dayEnd && (!deadline || candidateEnd <= deadline)) {
        return { start: cursor, end: candidateEnd };
      }
      if (interval.end > cursor) cursor = roundUpTime(new Date(interval.end.getTime() + bufferMs), 5);
    }
    const candidateEnd = new Date(cursor.getTime() + durationMs);
    if (candidateEnd <= dayEnd && (!deadline || candidateEnd <= deadline)) return { start: cursor, end: candidateEnd };
  }
  return null;
}

export function schedulableTasks(state) {
  const assigned = new Set(
    state.schedule
      .filter(block => !["done", "skipped"].includes(block.status))
      .map(block => block.taskId)
  );
  return state.tasks
    .filter(task => ["inbox", "planned"].includes(task.status) && !assigned.has(task.id))
    .sort(taskOrder);
}

export function proposeSchedule(state, now = new Date(), options = {}) {
  const horizonDays = Math.max(1, Math.min(14, Number(options.horizonDays) || 7));
  const proposalId = options.id ?? uid("proposal", now.getTime());
  const blocks = [];
  const unscheduledTaskIds = [];
  const chunkSize = Math.max(15, Math.min(90, Number(state.preferences.focusMinutes) || 25));

  for (const task of schedulableTasks(state)) {
    const beforeTask = blocks.length;
    let remaining = Math.max(5, Number(task.durationMinutes) || chunkSize);
    let part = 1;
    while (remaining > 0) {
      const durationMinutes = Math.min(chunkSize, remaining);
      const slot = findSlot({ state, proposedBlocks: blocks, durationMinutes, dueAt: task.dueAt, now, horizonDays });
      if (!slot) {
        blocks.splice(beforeTask);
        unscheduledTaskIds.push(task.id);
        break;
      }
      blocks.push({
        id: `block-${task.id}-${slot.start.getTime()}-${part}`,
        taskId: task.id,
        startAt: slot.start.toISOString(),
        endAt: slot.end.toISOString(),
        status: "planned",
        source: "proposal",
        proposalId,
        createdAt: now.toISOString()
      });
      remaining -= durationMinutes;
      part += 1;
    }
  }

  return {
    id: proposalId,
    createdAt: now.toISOString(),
    status: "pending",
    blocks: blocks.sort((a, b) => a.startAt.localeCompare(b.startAt)),
    unscheduledTaskIds,
    explanation: null
  };
}

export function blocksForDay(state, day = new Date()) {
  const key = localDateKey(day);
  return state.schedule
    .filter(block => localDateKey(block.startAt) === key && block.status !== "skipped")
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

export function nextBlock(state, now = new Date()) {
  const currentMs = now.getTime();
  return state.schedule
    .filter(block => !["done", "skipped"].includes(block.status) && safeDate(block.endAt)?.getTime() > currentMs)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))[0] ?? null;
}

export function deriveTodayRoute(state, now = new Date()) {
  if (["running", "paused", "ready"].includes(state.focus.status)) return "focus";
  if (state.focus.status === "complete" && state.focus.lastSummary) return "post-session";
  if ([...state.proposals].reverse().some(proposal => proposal.status === "pending")) return "proposal";
  if (nextBlock(state, now) && localDateKey(nextBlock(state, now).startAt) === localDateKey(now)) return "next-block";
  const recentSessions = state.sessions.filter(session => {
    const ended = safeDate(session.endedAt);
    return ended && ended >= new Date(now.getTime() - 7 * 86_400_000);
  });
  if (recentSessions.length >= 3) return "review";
  return "capture";
}

export function attachExplanation(state, proposalId, explanation) {
  const next = structuredClone(state);
  const proposal = next.proposals.find(item => item.id === proposalId);
  if (!proposal) throw new Error("Proposal not found.");
  proposal.explanation = explanation;
  return next;
}

import test from "node:test";
import assert from "node:assert/strict";
import { addTask, createDefaultState, saveProposal } from "../src/core/state.js";
import { deriveTodayRoute, detectConflicts, intervalsOverlap, proposeSchedule, schedulableTasks } from "../src/core/scheduler.js";

const now = new Date("2026-09-03T08:00:00.000Z");

function withTask(state, draft) {
  return addTask(state, draft, now).state;
}

test("touching intervals do not overlap", () => {
  assert.equal(intervalsOverlap(new Date(0), new Date(10), new Date(10), new Date(20)), false);
  assert.equal(intervalsOverlap(new Date(0), new Date(11), new Date(10), new Date(20)), true);
});

test("conflict detection returns overlapping block ids", () => {
  const conflicts = detectConflicts([
    { id: "a", startAt: "2026-09-03T09:00:00Z", endAt: "2026-09-03T10:00:00Z" },
    { id: "b", startAt: "2026-09-03T09:30:00Z", endAt: "2026-09-03T10:30:00Z" }
  ]);
  assert.deepEqual(conflicts, [["a", "b"]]);
});

test("schedulable tasks favor the earliest deadline", () => {
  let state = createDefaultState(now);
  state = withTask(state, { title: "Later", dueAt: "2026-09-05T12:00:00Z", priority: "high" });
  state = withTask(state, { title: "Sooner", dueAt: "2026-09-04T12:00:00Z", priority: "normal" });
  assert.equal(schedulableTasks(state)[0].title, "Sooner");
});

test("proposal splits a long task into focus-sized blocks", () => {
  let state = createDefaultState(now);
  state.preferences.focusMinutes = 25;
  state = withTask(state, { title: "Long task", durationMinutes: 60 });
  const proposal = proposeSchedule(state, now, { id: "proposal-test" });
  assert.equal(proposal.blocks.length, 3);
  const minutes = proposal.blocks.map(block => (new Date(block.endAt) - new Date(block.startAt)) / 60_000);
  assert.deepEqual(minutes, [25, 25, 10]);
});

test("proposal avoids committed schedule blocks", () => {
  let state = createDefaultState(now);
  state.preferences.dayStart = "08:00";
  state.preferences.dayEnd = "12:00";
  state.preferences.bufferMinutes = 10;
  state = withTask(state, { title: "New task", durationMinutes: 25 });
  state.schedule.push({ id: "existing", taskId: state.tasks[0].id, startAt: "2026-09-03T08:00:00Z", endAt: "2026-09-03T09:00:00Z", status: "planned", source: "manual", proposalId: null, createdAt: now.toISOString() });
  state.tasks[0].status = "inbox";
  const other = addTask(state, { title: "Actually schedule me", durationMinutes: 25 }, now);
  state = other.state;
  const proposal = proposeSchedule(state, now, { id: "proposal-test" });
  assert.equal(detectConflicts([...state.schedule, ...proposal.blocks]).length, 0);
  assert.ok(new Date(proposal.blocks[0].startAt) >= new Date("2026-09-03T09:10:00Z"));
});

test("a task that cannot fully fit is rolled back", () => {
  let state = createDefaultState(now);
  state.preferences.dayStart = "08:00";
  state.preferences.dayEnd = "08:30";
  state.preferences.focusMinutes = 25;
  state = withTask(state, { title: "Too long", durationMinutes: 60, dueAt: "2026-09-03T08:30:00Z" });
  const proposal = proposeSchedule(state, now, { id: "proposal-test", horizonDays: 1 });
  assert.equal(proposal.blocks.length, 0);
  assert.deepEqual(proposal.unscheduledTaskIds, [state.tasks[0].id]);
});

test("today routing defaults to calm capture", () => {
  assert.equal(deriveTodayRoute(createDefaultState(now), now), "capture");
});

test("today routing prioritizes a running focus session", () => {
  const state = createDefaultState(now);
  state.focus.status = "running";
  state.focus.endsAt = new Date(now.getTime() + 60_000).toISOString();
  assert.equal(deriveTodayRoute(state, now), "focus");
});

test("today routing surfaces a pending proposal before blocks", () => {
  const proposal = { id: "p", createdAt: now.toISOString(), status: "pending", blocks: [], unscheduledTaskIds: [], explanation: null };
  const state = saveProposal(createDefaultState(now), proposal, now);
  assert.equal(deriveTodayRoute(state, now), "proposal");
});

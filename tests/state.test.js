import test from "node:test";
import assert from "node:assert/strict";
import {
  addTask,
  applyProposal,
  completeTask,
  createBackup,
  createDefaultState,
  normalizeState,
  restoreBackup,
  saveProposal,
  SCHEMA_VERSION
} from "../src/core/state.js";

const now = new Date("2026-09-03T08:00:00.000Z");

test("default state uses the current schema and starts locally empty", () => {
  const state = createDefaultState(now);
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(state.tasks, []);
  assert.equal(state.focus.status, "idle");
  assert.equal(state.profile.experience, null);
  assert.equal(state.profile.aim, null);
  assert.equal(state.profile.geminiSetup, null);
  assert.equal(state.preferences.model, "gemini-3.1-flash-lite");
});

test("old fake onboarding defaults migrate back to unselected choices", () => {
  const state = normalizeState({
    schemaVersion: 2,
    profile: { onboardingComplete: false, onboardingStep: 1, experience: "beginner", aim: "general" }
  }, now);
  assert.equal(state.profile.experience, null);
  assert.equal(state.profile.aim, null);
  assert.equal(state.profile.geminiSetup, null);
});

test("explicit onboarding choices survive normalization", () => {
  const state = normalizeState({
    schemaVersion: SCHEMA_VERSION,
    profile: { onboardingComplete: false, onboardingStep: 3, experience: "system", aim: "deep-work", geminiSetup: "now" }
  }, now);
  assert.equal(state.profile.experience, "system");
  assert.equal(state.profile.aim, "deep-work");
  assert.equal(state.profile.geminiSetup, "now");
});

test("normalization rejects malformed tasks and unknown fields", () => {
  const state = normalizeState({ tasks: [{ title: "" }, { title: "Valid", secret: "drop-me" }], secret: "drop-me" }, now);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].title, "Valid");
  assert.equal("secret" in state, false);
  assert.equal("secret" in state.tasks[0], false);
});

test("adding a task appends a history event", () => {
  const result = addTask(createDefaultState(now), { title: "Read one paper", durationMinutes: 35 }, now);
  assert.equal(result.state.tasks.length, 1);
  assert.equal(result.state.events.at(-1).type, "task_created");
  assert.equal(result.state.events.at(-1).data.taskId, result.task.id);
});

test("completing a task records status and completion time", () => {
  const added = addTask(createDefaultState(now), { title: "Finish outline" }, now);
  const later = new Date(now.getTime() + 10_000);
  const state = completeTask(added.state, added.task.id, later);
  assert.equal(state.tasks[0].status, "done");
  assert.equal(state.tasks[0].completedAt, later.toISOString());
});

test("a saved proposal does not mutate the committed schedule", () => {
  const state = createDefaultState(now);
  const proposal = { id: "proposal-1", createdAt: now.toISOString(), status: "pending", blocks: [], unscheduledTaskIds: [], explanation: null };
  const next = saveProposal(state, proposal, now);
  assert.equal(next.proposals.length, 1);
  assert.equal(next.schedule.length, 0);
});

test("applying a proposal commits blocks and marks its task planned", () => {
  const added = addTask(createDefaultState(now), { title: "Experiment", durationMinutes: 25 }, now);
  const block = { id: "block-1", taskId: added.task.id, startAt: "2026-09-03T09:00:00.000Z", endAt: "2026-09-03T09:25:00.000Z", status: "planned", source: "proposal", proposalId: "proposal-1", createdAt: now.toISOString() };
  const proposed = saveProposal(added.state, { id: "proposal-1", createdAt: now.toISOString(), status: "pending", blocks: [block], unscheduledTaskIds: [], explanation: null }, now);
  const applied = applyProposal(proposed, "proposal-1", now);
  assert.equal(applied.schedule.length, 1);
  assert.equal(applied.tasks[0].status, "planned");
  assert.equal(applied.proposals[0].status, "applied");
});

test("applying a stale proposal refuses a newly introduced conflict", () => {
  let first = addTask(createDefaultState(now), { title: "Existing block" }, now);
  let second = addTask(first.state, { title: "Proposed block" }, now);
  const state = second.state;
  state.schedule.push({ id: "existing", taskId: first.task.id, startAt: "2026-09-03T09:00:00.000Z", endAt: "2026-09-03T10:00:00.000Z", status: "planned", source: "manual", proposalId: null, createdAt: now.toISOString() });
  const block = { id: "new", taskId: second.task.id, startAt: "2026-09-03T09:30:00.000Z", endAt: "2026-09-03T10:30:00.000Z", status: "planned", source: "proposal", proposalId: "proposal-2", createdAt: now.toISOString() };
  const proposed = saveProposal(state, { id: "proposal-2", createdAt: now.toISOString(), status: "pending", blocks: [block], unscheduledTaskIds: [], explanation: null }, now);
  assert.throws(() => applyProposal(proposed, "proposal-2", now), /schedule changed/i);
});

test("backup export strips any credential-like top-level property", () => {
  const state = createDefaultState(now);
  state.gemini = { apiKey: "must-not-export" };
  const backup = createBackup(state, now);
  assert.equal("gemini" in backup.state, false);
  assert.equal(JSON.stringify(backup).includes("must-not-export"), false);
});

test("backup round-trip preserves tasks", () => {
  const added = addTask(createDefaultState(now), { title: "Round trip", notes: "local" }, now);
  const restored = restoreBackup(createBackup(added.state, now), now);
  assert.equal(restored.tasks[0].title, "Round trip");
  assert.equal(restored.events.at(-1).type, "backup_imported");
});

test("restore rejects unrelated JSON", () => {
  assert.throws(() => restoreBackup({ hello: "world" }, now), /not a Stuđiô backup/i);
});

import test from "node:test";
import assert from "node:assert/strict";
import { applyCaptureDraft, buildCaptureContext, captureIssues, MAX_CAPTURE_BLOCKS, multipleFocusBlocksEnabled } from "../src/core/capture.js";
import { buildMultiCaptureRequest, MULTI_CAPTURE_SCHEMA, validateMultiCaptureDraft } from "../src/core/ai-contracts.js";
import { createBackup, createDefaultState, normalizeState, restoreBackup, updateMemory } from "../src/core/state.js";

process.env.TZ = "UTC";
const now = new Date("2026-09-09T08:00:00Z");
function rawDraft() {
  return {
    rationale: "Use different lengths for reading and practice.",
    tasks: [{
      title: "Study", notes: "One hour total", duration_minutes: 60, due_at: "", energy: "high", priority: "normal", confidence: 0.8, assumptions: ["Morning is assumed available."],
      focus_blocks: [
        { label: "Read the chapter", duration_minutes: 20, start_at: "2026-09-09T09:00:00Z" },
        { label: "Practice", duration_minutes: 40, start_at: "2026-09-09T09:30:00Z" }
      ]
    }, {
      title: "Write", notes: "Outline only", duration_minutes: 30, due_at: "2026-09-09T18:00:00Z", energy: "medium", priority: "high", confidence: 0.8, assumptions: [],
      focus_blocks: [{ label: "Draft an outline", duration_minutes: 30, start_at: "2026-09-09T10:20:00Z" }]
    }]
  };
}
function draft() { return { ...validateMultiCaptureDraft(rawDraft()), id: "capture-test-12345678" }; }
function flatDraft() {
  const raw = rawDraft();
  return {
    rationale: raw.rationale,
    tasks: raw.tasks.map(({ focus_blocks, ...task }) => task),
    // Interleaved blocks exercise task_index grouping independently of order.
    focus_blocks: [
      { ...raw.tasks[0].focus_blocks[0], task_index: 0 },
      { ...raw.tasks[1].focus_blocks[0], task_index: 1 },
      { ...raw.tasks[0].focus_blocks[1], task_index: 0 }
    ]
  };
}

test("beginner defaults to multiple blocks; system and unknown modes default off", () => {
  for (const [experience, expected] of [["beginner", true], ["system", false], [null, false]]) {
    const state = createDefaultState(now);
    state.profile.experience = experience;
    assert.equal(multipleFocusBlocksEnabled(normalizeState(state, now)), expected);
  }
});

test("explicit toggle choices survive mode changes, normalization, and backup restore", () => {
  for (const choice of [true, false]) {
    const state = createDefaultState(now);
    state.preferences.allowMultipleFocusBlocks = choice;
    for (const experience of ["beginner", "system", null]) {
      state.profile.experience = experience;
      assert.equal(multipleFocusBlocksEnabled(restoreBackup(createBackup(state, now), now)), choice);
    }
  }
});

test("schema-4 upgrades use the existing onboarding choice without changing tasks or memory", () => {
  const state = updateMemory(createDefaultState(now), { customInstructions: "Keep it brief.", enabled: true }, now);
  state.schemaVersion = 4;
  state.profile = { ...state.profile, onboardingComplete: true, experience: "beginner" };
  delete state.preferences.allowMultipleFocusBlocks;
  const next = normalizeState(state, now);
  assert.equal(multipleFocusBlocksEnabled(next), true);
  assert.deepEqual(next.memory, state.memory);
  assert.deepEqual(next.tasks, state.tasks);
  assert.equal(next.profile.onboardingComplete, true);
  assert.equal(next.preferences.allowMultipleFocusBlocks, null);
});

test("capture context sends only nearby busy times and relevant settings", () => {
  const state = createDefaultState(now);
  state.tasks = [{ id: "private-task", title: "PRIVATE-TITLE", notes: "PRIVATE-NOTES" }];
  state.feedback = [{ text: "PRIVATE-FEEDBACK" }];
  state.memory = { enabled: true, customInstructions: "MEMORY-SEPARATE" };
  state.schedule = [
    { startAt: "2026-09-09T09:00:00Z", endAt: "2026-09-09T09:30:00Z", status: "planned", taskId: "private-task" },
    { startAt: "2026-09-09T09:20:00Z", endAt: "2026-09-09T10:00:00Z", status: "planned" },
    { startAt: "2026-10-09T09:00:00Z", endAt: "2026-10-09T10:00:00Z", status: "planned" },
    { startAt: "2026-09-09T11:00:00Z", endAt: "2026-09-09T12:00:00Z", status: "done" }
  ];
  state.focus = { status: "running", endsAt: "2026-09-09T08:25:00Z" };
  const context = buildCaptureContext(state, now, "UTC");
  assert.equal(context.busy_periods.length, 2);
  assert.deepEqual(context.busy_periods[1], { start_at: "2026-09-09T09:00:00.000Z", end_at: "2026-09-09T10:00:00.000Z" });
  assert.equal(context.earliest_start, "2026-09-09T08:05:00.000Z");
  for (const text of ["PRIVATE", "private-task", "MEMORY-SEPARATE", "2026-10-09", "2026-09-09T11"]) assert.equal(JSON.stringify(context).includes(text), false);
});

test("multi capture asks Gemini to choose grouping and durations while preserving review", () => {
  const request = buildMultiCaptureRequest("Study for one hour and outline a report", buildCaptureContext(createDefaultState(now), now, "UTC"));
  assert.equal(request.schema, MULTI_CAPTURE_SCHEMA);
  assert.match(request.input, /Do not mechanically split/);
  assert.match(request.input, /later confirmation can save/);
  assert.match(request.input, /do not modify|or modify existing tasks/i);
  assert.match(request.input, /not required/);
  assert.doesNotMatch(JSON.stringify(MULTI_CAPTURE_SCHEMA), /maxLength|minLength|maxItems/);
});

test("flat API blocks regroup into the same editable tasks without altering the response", () => {
  const raw = flatDraft();
  const before = structuredClone(raw);
  assert.deepEqual(validateMultiCaptureDraft(raw), validateMultiCaptureDraft(rawDraft()));
  assert.deepEqual(raw, before);
  const result = applyCaptureDraft(createDefaultState(now), { ...validateMultiCaptureDraft(raw), id: "capture-flat-12345678" }, now);
  assert.deepEqual(result.state.schedule.map(block => [result.state.tasks.find(task => task.id === block.taskId).title, block.label]), [
    ["Study", "Read the chapter"], ["Study", "Practice"], ["Write", "Draft an outline"]
  ]);
});

test("flat batches reject invalid task references, mixed formats, missing blocks, and bad totals", () => {
  const cases = [
    raw => { delete raw.focus_blocks[0].task_index; },
    ...[-1, 2, 0.5, "0", null].map(index => raw => { raw.focus_blocks[0].task_index = index; }),
    raw => { raw.tasks[0].focus_blocks = []; },
    raw => { raw.focus_blocks = []; },
    raw => { raw.focus_blocks = null; },
    raw => { raw.focus_blocks = Array(13).fill(raw.focus_blocks[0]); },
    raw => { raw.tasks = Array(7).fill(raw.tasks[0]); },
    raw => { raw.tasks[0] = null; },
    raw => { raw.focus_blocks[0] = null; },
    raw => { raw.focus_blocks[1].task_index = 0; },
    raw => { raw.tasks[0].duration_minutes = 61; },
    raw => { raw.focus_blocks[0].duration_minutes = -5; },
    raw => { raw.focus_blocks[0].start_at = "2026-02-30T09:00:00Z"; }
  ];
  for (const change of cases) {
    const raw = flatDraft(); change(raw);
    assert.throws(() => validateMultiCaptureDraft(raw));
  }
});

test("Gemini can return multiple distinct tasks with uneven blocks", () => {
  const parsed = validateMultiCaptureDraft(rawDraft());
  assert.equal(parsed.kind, "capture-blocks");
  assert.equal(parsed.tasks.length, 2);
  assert.deepEqual(parsed.tasks[0].focusBlocks.map(block => block.durationMinutes), [20, 40]);
  assert.equal(parsed.tasks[1].dueAt, "2026-09-09T18:00:00.000Z");
  assert.ok(parsed.tasks.flatMap(task => task.focusBlocks).every(block => block.selected));
});

test("missing times remain reviewable but cannot be added until resolved or deselected", () => {
  const raw = rawDraft();
  raw.tasks[0].focus_blocks[0].start_at = "";
  const candidate = { ...validateMultiCaptureDraft(raw), id: "capture-test-12345678" };
  assert.match(captureIssues(createDefaultState(now), candidate, now)[0], /choose a start time/);
  assert.throws(() => applyCaptureDraft(createDefaultState(now), candidate, now), /choose a start time/);
  candidate.tasks[0].focusBlocks[0].selected = false;
  assert.equal(applyCaptureDraft(createDefaultState(now), candidate, now).blockCount, 2);
});

test("malformed, oversized, inconsistent, or empty model batches are rejected as a whole", () => {
  const cases = [
    raw => { raw.tasks = []; },
    raw => { raw.tasks = Array(7).fill(raw.tasks[0]); },
    raw => { raw.tasks[0].focus_blocks = []; },
    raw => { raw.tasks[0].duration_minutes = 61; },
    raw => { raw.tasks[0].focus_blocks[0].duration_minutes = -5; },
    raw => { raw.tasks[0].focus_blocks[0].label = ""; },
    raw => { raw.tasks[0].focus_blocks[0].start_at = "2026-09-09T09:00"; },
    raw => { raw.tasks[0].focus_blocks[0].start_at = "2026-02-30T09:00:00Z"; },
    raw => { raw.tasks[0].due_at = "not a date"; }
  ];
  for (const change of cases) { const raw = rawDraft(); change(raw); assert.throws(() => validateMultiCaptureDraft(raw)); }
  const tooMany = rawDraft();
  tooMany.tasks = Array(6).fill({ ...tooMany.tasks[0], duration_minutes: 60, focus_blocks: Array(3).fill({ label: "Read", duration_minutes: 20, start_at: "2026-09-09T09:00:00Z" }) });
  assert.throws(() => validateMultiCaptureDraft(tooMany), /at most 12/);
});

test("one confirmation atomically adds all task/block pairs without Plan or a timer", () => {
  const state = updateMemory(createDefaultState(now), { customInstructions: "Keep this preference.", enabled: true }, now);
  const before = structuredClone(state);
  const result = applyCaptureDraft(state, draft(), now);
  assert.deepEqual(state, before);
  assert.equal(result.taskCount, 2);
  assert.equal(result.blockCount, 3);
  assert.deepEqual(result.state.schedule.map(block => (new Date(block.endAt) - new Date(block.startAt)) / 60_000), [20, 40, 30]);
  assert.deepEqual(result.state.tasks.map(task => task.durationMinutes), [60, 30]);
  assert.ok(result.state.tasks.every(task => task.status === "planned" && task.source === "gemini"));
  assert.ok(result.state.schedule.every(block => result.state.tasks.some(task => task.id === block.taskId) && block.source === "capture" && block.proposalId === null));
  assert.deepEqual(result.state.proposals, []);
  assert.deepEqual(result.state.focus, state.focus);
  assert.deepEqual(result.state.memory, state.memory);
  assert.equal(result.state.events.at(-1).type, "capture_blocks_added");
  assert.equal(JSON.stringify(result.state.events).includes("One hour total"), false);
});

test("deselection and edited lengths explicitly determine the saved task total", () => {
  const candidate = draft();
  candidate.tasks[0].focusBlocks[0].selected = false;
  candidate.tasks[0].focusBlocks[1].durationMinutes = 35;
  const result = applyCaptureDraft(createDefaultState(now), candidate, now);
  assert.equal(result.blockCount, 2);
  assert.equal(result.state.tasks[0].durationMinutes, 35);
  assert.equal(result.state.schedule[0].label, "Practice");
  for (const task of candidate.tasks) for (const block of task.focusBlocks) block.selected = false;
  assert.throws(() => applyCaptureDraft(createDefaultState(now), candidate, now), /at least one/);
});

test("a new conflict before saving rejects the whole batch without partial tasks", () => {
  const state = createDefaultState(now);
  state.schedule.push({ startAt: "2026-09-09T10:30:00Z", endAt: "2026-09-09T11:00:00Z", status: "planned" });
  const before = structuredClone(state);
  assert.throws(() => applyCaptureDraft(state, draft(), now), /overlaps/);
  assert.deepEqual(state, before);
});

test("save validates past starts, planning horizon, deadlines, workday hours, and buffers", () => {
  const cases = [
    [candidate => { candidate.tasks[0].focusBlocks[0].startAt = "2026-09-09T07:00:00Z"; }, /has passed/],
    [candidate => { candidate.tasks[0].focusBlocks[0].startAt = "2026-09-18T09:00:00Z"; }, /seven days/],
    [candidate => { candidate.tasks[1].dueAt = "2026-09-09T10:30:00Z"; }, /deadline/],
    [candidate => { candidate.tasks[1].focusBlocks[0].startAt = "2026-09-09T23:00:00Z"; }, /workday/],
    [candidate => { candidate.tasks[0].focusBlocks[1].startAt = "2026-09-09T09:25:00Z"; }, /buffer/]
  ];
  for (const [change, expected] of cases) {
    const candidate = draft(); change(candidate);
    assert.ok(captureIssues(createDefaultState(now), candidate, now).some(issue => expected.test(issue)));
    assert.throws(() => applyCaptureDraft(createDefaultState(now), candidate, now));
  }
});

test("a running unscheduled focus timer blocks overlapping capture times", () => {
  const state = createDefaultState(now);
  state.focus.status = "running";
  state.focus.endsAt = "2026-09-09T09:30:00Z";
  assert.throws(() => applyCaptureDraft(state, draft(), now), /overlaps/);
});

test("saved labels and provenance survive backup restore and duplicate submission is refused", () => {
  const saved = applyCaptureDraft(createDefaultState(now), draft(), now).state;
  const restored = restoreBackup(createBackup(saved, now), now);
  assert.equal(restored.schedule[0].label, "Read the chapter");
  assert.equal(restored.schedule[0].source, "capture");
  assert.deepEqual(restored.tasks, saved.tasks);
  assert.throws(() => applyCaptureDraft(restored, draft(), now), /already been added/);
});

test("local timezone and overnight workday validation handle a block after midnight", () => {
  const original = process.env.TZ;
  process.env.TZ = "Asia/Ho_Chi_Minh";
  try {
    const localNow = new Date("2026-09-09T22:00:00+07:00");
    const state = createDefaultState(localNow);
    state.preferences.dayStart = "22:00";
    state.preferences.dayEnd = "06:00";
    const candidate = draft();
    candidate.tasks = [candidate.tasks[0]];
    candidate.tasks[0].focusBlocks[0].startAt = "2026-09-10T00:30:00+07:00";
    candidate.tasks[0].focusBlocks[1].startAt = "2026-09-10T01:00:00+07:00";
    assert.deepEqual(captureIssues(state, candidate, localNow), []);
    const saved = applyCaptureDraft(state, candidate, localNow).state;
    assert.equal(saved.schedule[0].startAt, "2026-09-09T17:30:00.000Z");
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test("the maximum twelve-block batch can be validated and saved", () => {
  const raw = rawDraft();
  raw.tasks = [raw.tasks[0]];
  raw.tasks[0].duration_minutes = 120;
  raw.tasks[0].focus_blocks = Array.from({ length: MAX_CAPTURE_BLOCKS }, (_, index) => ({ label: `Part ${index + 1}`, duration_minutes: 10, start_at: new Date(now.getTime() + (60 + index * 20) * 60_000).toISOString() }));
  const candidate = { ...validateMultiCaptureDraft(raw), id: "capture-maximum-12345" };
  assert.equal(applyCaptureDraft(createDefaultState(now), candidate, now).blockCount, 12);
});

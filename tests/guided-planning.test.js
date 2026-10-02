import test from "node:test";
import assert from "node:assert/strict";
import { applyGuidedPlan, buildGuidanceRequest, validateGuidance } from "../src/core/guided-planning.js";
import { buildDayAdviceRequest, validateDayAdvice } from "../src/core/day-advice.js";
import { addTask, createBackup, createDefaultState, normalizeState, restoreBackup } from "../src/core/state.js";
import { renderPlanningAssistant } from "../src/planning-view.js";

const now = new Date("2026-09-10T08:00:00Z");
const manual = { output: "block", title: "Write my introduction", durationMinutes: 30, startAt: "2026-09-11T09:00:00Z" };

test("guided mode is the default and explicit mode choices survive backups", () => {
  assert.equal(createDefaultState().preferences.planningAssistance, "guided");
  const state = createDefaultState(); state.preferences.planningAssistance = "suggest";
  assert.equal(restoreBackup(createBackup(state)).preferences.planningAssistance, "suggest");
  assert.equal(normalizeState({ preferences: { planningAssistance: "invalid" } }).preferences.planningAssistance, "guided");
});

test("guided planning saves only user form input and never starts focus", () => {
  const state = createDefaultState(now), before = structuredClone(state);
  const result = applyGuidedPlan(state, { ...manual, generatedTask: { title: "AI task", durationMinutes: 99 } }, now);
  assert.equal(result.state.tasks.length, 1); assert.equal(result.state.schedule.length, 1);
  assert.equal(result.state.tasks[0].title, manual.title);
  assert.equal(result.state.tasks[0].source, "manual");
  assert.equal(result.state.schedule[0].source, "manual");
  assert.equal(result.state.focus.status, "idle"); assert.deepEqual(state, before);
  assert.doesNotMatch(JSON.stringify(result.state), /AI task/);
});

test("manual task-only creation does not schedule, and a block can use an existing task", () => {
  const taskOnly = applyGuidedPlan(createDefaultState(now), { ...manual, output: "task" }, now);
  assert.equal(taskOnly.state.schedule.length, 0); assert.equal(taskOnly.blockId, null);
  const result = applyGuidedPlan(taskOnly.state, { ...manual, taskId: taskOnly.taskId, title: "Must not rename" }, now);
  assert.equal(result.state.tasks.length, 1);
  assert.equal(result.state.tasks[0].title, manual.title);
  assert.equal(result.state.schedule[0].taskId, taskOnly.taskId);
});

test("guided save rejects missing choices, past times, and stale/conflicting targets atomically", () => {
  const state = applyGuidedPlan(createDefaultState(now), manual, now).state;
  const before = structuredClone(state);
  for (const invalid of [{ durationMinutes: 0 }, { title: "" }, { startAt: "2026-09-09T09:00:00Z" }, { taskId: "gone" }, {}]) {
    assert.throws(() => applyGuidedPlan(state, { ...manual, ...invalid }, now));
    assert.deepEqual(state, before);
  }
});

test("guided block checks a running timer and an existing task deadline", () => {
  let state = addTask(createDefaultState(now), { title: "Read", dueAt: "2026-09-11T09:10:00Z" }, now).state;
  assert.throws(() => applyGuidedPlan(state, { ...manual, taskId: state.tasks[0].id }, now), /deadline/);
  state.focus = { ...state.focus, status: "running", endsAt: "2026-09-10T09:00:00Z" };
  assert.throws(() => applyGuidedPlan(state, { ...manual, startAt: "2026-09-10T08:10:00Z" }, now), /running timer/);
});

test("guidance requests keep coaching distinct from automatic decisions and use current context", () => {
  const state = addTask(createDefaultState(now), { title: "Read a paper", notes: "My note" }, now).state;
  state.feedback = [{ text: "private old feedback" }];
  const snapshot = buildDayAdviceRequest(state, now, "UTC");
  const request = buildGuidanceRequest(snapshot, "How should I estimate time?");
  assert.match(request.input, /Do not choose a task/);
  assert.match(request.input, /create, prefill, or start/);
  assert.match(request.input, /How should I estimate time/);
  assert.match(request.input, /Read a paper/);
  assert.doesNotMatch(request.input, /private old feedback/);
  assert.equal(JSON.parse(request.input.split("\n").at(-1)).current_context.device_usage_available, false);
  assert.throws(() => buildGuidanceRequest(snapshot, ""), /Write/);
});

test("guidance validator bounds output and drops any generated task/write fields", () => {
  const valid = { overview: "Decide what matters.", questions: ["What outcome?"], steps: ["Estimate the effort."], ideas: ["You could start with an outline."] };
  const result = validateGuidance({ ...valid, tasks: [manual], action: "save" });
  assert.equal(result.tasks, undefined); assert.equal(result.action, undefined);
  for (const bad of [{ overview: "" }, { questions: ["one", "two", "three", "four"] }, { ideas: [null] }, { steps: ["x".repeat(501)] }]) assert.throws(() => validateGuidance({ ...valid, ...bad }));
});

test("guidance text is escaped and cannot prefill the user's blank form", () => {
  const html = renderPlanningAssistant({ guidance: { overview: "<script>wrong</script>", questions: [], steps: [], ideas: ["AI-generated title"] } });
  assert.match(html, /&lt;script&gt;wrong/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /id="guide-title"[^>]*value=""/);
  assert.match(html, /id="guide-duration"[^>]*value=""/);
  assert.match(html, /AI-generated title/);
});

test("next-step suggestions can only reference exact active snapshot ids", () => {
  const state = addTask(createDefaultState(now), { title: "My actual task" }, now).state;
  const request = buildDayAdviceRequest(state, now, "UTC");
  const suggestion = { task_id: state.tasks[0].id, title: "Model renamed task", reason: "A small next step.", duration_minutes: 15 };
  const advice = validateDayAdvice({ overview: "An option", suggestions: [suggestion] }, state, request.taskIds);
  assert.equal(advice.suggestions[0].title, "My actual task");
  assert.throws(() => validateDayAdvice({ overview: "An option", suggestions: [{ ...suggestion, task_id: "invented" }] }, state, request.taskIds), /outside/);
  assert.throws(() => validateDayAdvice({ overview: "An option", suggestions: [suggestion, suggestion] }, state, request.taskIds), /repeated/);
});

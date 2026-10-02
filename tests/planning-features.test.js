import test from "node:test";
import assert from "node:assert/strict";
import { addTask, createDefaultState, normalizeState, updateTask } from "../src/core/state.js";
import { moveToQuadrant, taskQuadrant, dayPlan, saveDayPlan, toggleTodayTask, estimateDailyBudget } from "../src/core/time-management.js";
import { recordAiUsage, planningPromptEligible } from "../src/core/ai-usage.js";
import { ruleClassification, sortingCandidates, sortingFingerprint, applySortResults, validateSorting } from "../src/core/task-sorting.js";
import { html, msg, setLanguage, t } from "../src/i18n.js";
import { renderEisenhower } from "../src/time-management-view.js";
import { escapeHtml } from "../src/core/utils.js";
process.env.TZ = "UTC";
const start = new Date("2026-09-01T09:00:00Z");
const later = new Date("2026-09-08T09:00:00Z");
function sample() {
  const state = addTask(createDefaultState(start), { title: "Prepare exam", notes: "Pass final exam", dueAt: "2026-09-09T09:00:00Z" }, start).state;
  state.preferences.autoSort = true;
  return state;
}
const choice = task => ({ id: task.id, importance: "important", urgency: "urgent", confidence: "high", reason: "Required for stated exam goal." });

test("prompt requires seven elapsed days and 21 requests across seven full days, including inactive days", () => {
  const state = createDefaultState(start);
  for (let n = 0; n < 20; n++) state.aiUsage = recordAiUsage(state.aiUsage, "capture", start);
  assert.equal(planningPromptEligible(state, later), false);
  state.aiUsage = recordAiUsage(state.aiUsage, "explain", start);
  assert.equal(planningPromptEligible(state, later), true);
  assert.equal(planningPromptEligible(state, new Date(later - 1)), false);
  assert.equal(planningPromptEligible(state, new Date("2026-09-09T09:00:00Z")), false);
});
test("today, connection tests and automatic work cannot inflate the prompt threshold; prompt is once only", () => {
  const state = createDefaultState(start);
  for (let n = 0; n < 30; n++) for (const action of ["test", "sort", "memory-update"]) state.aiUsage = recordAiUsage(state.aiUsage, action, start);
  for (let n = 0; n < 30; n++) state.aiUsage = recordAiUsage(state.aiUsage, "capture", later);
  assert.equal(planningPromptEligible(state, later), false);
  for (let n = 0; n < 21; n++) state.aiUsage = recordAiUsage(state.aiUsage, "reflect", start);
  state.preferences.planningEnabled = true;
  assert.equal(planningPromptEligible(state, later), false);
  state.preferences.planningEnabled = false; state.aiUsage.promptSeenAt = later.toISOString();
  assert.equal(planningPromptEligible(state, later), false);
});
test("migration starts usage observation now, without inventing historical use", () => {
  const old = { ...createDefaultState(start), schemaVersion: 8 }; delete old.aiUsage;
  const next = normalizeState(old, later);
  assert.equal(next.aiUsage.startedAt, later.toISOString());
  assert.equal(next.preferences.autoSort, false);
  assert.equal(next.preferences.planningEnabled, false);
});
test("rules only accept explicit importance labels and reject conflicting labels or keyword guesses", () => {
  assert.equal(ruleClassification({ title: "An important book is not my goal", notes: "" }), null);
  assert.equal(ruleClassification({ title: "Read", notes: "Importance: important\nImportance: low" }), null);
  assert.equal(ruleClassification({ title: "Đọc", notes: "Quan trọng: không", urgency: "auto" }).important, false);
  assert.equal(ruleClassification({ title: "Read", notes: "Importance: important", urgency: "auto" }).important, true);
});
test("classification validation rejects invented IDs, duplicates, malformed decisions and uncertainty", () => {
  const state = sample(), task = state.tasks[0];
  assert.throws(() => validateSorting({ decisions: [{ ...choice(task), id: "invented" }] }, [task]));
  assert.throws(() => validateSorting({ decisions: [choice(task), choice(task)] }, [task]));
  assert.throws(() => validateSorting({ decisions: [{ ...choice(task), confidence: 1 }] }, [task]));
  assert.equal(validateSorting({ decisions: [{ ...choice(task), confidence: "low" }] }, [task])[0].important, null);
  const undated = { ...task, dueAt: null };
  assert.equal(validateSorting({ decisions: [{ ...choice(task), urgency: "unknown" }] }, [undated])[0].important, null);
});
test("AI sorting preserves deadlines and durations and leaves scheduled time alone", () => {
  const state = sample(), task = state.tasks[0];
  const next = applySortResults(state, [task], validateSorting({ decisions: [choice(task)] }, [task]), start);
  assert.equal(next.tasks[0].important, true);
  assert.equal(next.tasks[0].urgency, "auto");
  assert.equal(next.tasks[0].dueAt, task.dueAt);
  assert.equal(next.tasks[0].durationMinutes, task.durationMinutes);
  assert.deepEqual(next.schedule, state.schedule);
  assert.equal(taskQuadrant(next.tasks[0], start), "schedule");
  assert.equal(taskQuadrant(next.tasks[0], later), "do");
});
test("late AI responses cannot overwrite edits, manual choices, deletion or a disabled toggle", () => {
  const state = sample(), task = state.tasks[0];
  const results = validateSorting({ decisions: [choice(task)] }, [task]);
  const edited = updateTask(state, task.id, { title: "Changed goal" }, later);
  assert.equal(applySortResults(edited, [task], results).tasks[0].important, null);
  for (const quadrant of ["defer", "unsorted"]) {
    const manual = moveToQuadrant(state, task.id, quadrant, later);
    assert.equal(sortingCandidates(manual).length, 0);
    assert.deepEqual(applySortResults(manual, [task], results).tasks, manual.tasks);
  }
  const disabled = { ...state, preferences: { ...state.preferences, autoSort: false } };
  assert.deepEqual(applySortResults(disabled, [task], results), disabled);
  assert.equal(applySortResults({ ...state, tasks: [] }, [task], results).tasks.length, 0);
});
test("attempted revisions are not repeatedly sent; an edit makes them eligible again", () => {
  const state = sample(), task = state.tasks[0]; task.sortFingerprint = sortingFingerprint(task);
  assert.equal(sortingCandidates(normalizeState(state)).length, 0);
  assert.equal(sortingCandidates(updateTask(state, task.id, { notes: "New outcome" }, later)).length, 1);
});
test("automatic budget uses explicit availability history, handles zero, and respects today's override", () => {
  let state = sample(); state.preferences.autoDailyBudget = true;
  assert.equal(dayPlan(state, later).availableMinutes, 120);
  for (const [day, minutes] of [[1, 0], [2, 60], [3, 90], [4, 120]]) state = saveDayPlan(state, { availableMinutes: minutes }, new Date(`2026-09-0${day}T09:00:00Z`));
  assert.equal(estimateDailyBudget(state, later).minutes, 75);
  assert.equal(estimateDailyBudget(state, later).samples, 4);
  state = toggleTodayTask(state, state.tasks[0].id, later);
  assert.equal(dayPlan(state, later).availableMinutes, 75);
  assert.equal(dayPlan(state, later).budgetSource, "automatic");
  state = saveDayPlan(state, { availableMinutes: 0 }, later);
  assert.equal(dayPlan(normalizeState(state), later).availableMinutes, 0);
  assert.equal(dayPlan(state, later).budgetSource, "manual");
  assert.equal(estimateDailyBudget(state, new Date("2026-11-01T09:00:00Z")).samples, 0);
});
test("Vietnamese translates interface text and accessibility labels but never task text, attributes or escaped markup", () => {
  setLanguage("vi");
  try {
    const userText = 'Today <script>bad</script>\u00010\u0002';
    const rendered = html`<button data-action="Today" aria-label="Open settings">Today</button><p>${escapeHtml(userText)}</p>`;
    assert.match(rendered, />Hôm nay<\/button>/);
    assert.match(rendered, /aria-label="Mở Cài đặt"/);
    assert.match(rendered, /data-action="Today"/);
    assert.ok(rendered.includes(escapeHtml(userText)));
    assert.equal(msg`Add ${"Today"} selected blocks`, "Thêm Today phiên đã chọn");
    assert.equal(t("Settings"), "Cài đặt");
    const state = sample(); state.tasks[0].title = "Today";
    const matrix = renderEisenhower(state);
    assert.match(matrix, /Chưa phân loại/);
    assert.match(matrix, /AI tự phân loại/);
    assert.match(matrix, /<h4>Today<\/h4>/);
  } finally { setLanguage("en"); }
});

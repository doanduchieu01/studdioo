import test from "node:test";
import assert from "node:assert/strict";
import { addTask, createBackup, createDefaultState, normalizeState, restoreBackup } from "../src/core/state.js";
import { dailyBudget, dayPlan, estimateDailyBudget, saveDayPlan, toggleTodayTask, useAutomaticDailyBudget } from "../src/core/time-management.js";
import { pauseFocus, startFocus } from "../src/core/timer.js";
import { localDateKey } from "../src/core/utils.js";
import { renderBudget } from "../src/time-management-view.js";
import { setLanguage } from "../src/i18n.js";

const now = new Date(2026, 8, 19, 12);
const ago = days => { const date = new Date(now); date.setDate(date.getDate() - days); return date; };
const sample = () => { const state = createDefaultState(now); state.preferences.autoDailyBudget = true; return state; };
function manual(state, days, minutes, budgetSource = "manual") {
  state.dayPlans.push({ date: localDateKey(ago(days)), availableMinutes: minutes, taskIds: [], budgetSource });
}
function focus(state, days, minutes, extra = {}) {
  state.sessions.push({ id: `s-${state.sessions.length}`, taskId: null, startedAt: new Date(ago(days).getTime() - minutes * 60_000).toISOString(), endedAt: ago(days).toISOString(), plannedSeconds: minutes * 60, focusedSeconds: minutes * 60, outcome: "completed", ...extra });
}
function history(state, { budget = null, focused = null, days = 3 } = {}) {
  for (let day = 1; day <= days; day++) {
    if (budget !== null) manual(state, day, budget);
    if (focused !== null) focus(state, day, focused);
  }
  return state;
}

test("no history uses the default and reports it as the only baseline source", () => {
  const state = sample();
  const estimate = estimateDailyBudget(state, now);
  assert.equal(estimate.minutes, 120);
  assert.equal(estimate.workdayMinutes, 810);
  assert.equal(estimate.limitedHistory, true);
  assert.equal(estimate.samples, 0);
  assert.deepEqual(estimate.sources, [{ id: "default", minutes: 120, samples: 0, weight: 1 }]);
});

test("recorded focus alone supplies a budget, including estimated breaks", () => {
  const state = history(sample(), { focused: 60 });
  const estimate = estimateDailyBudget(state, now);
  assert.equal(estimate.minutes, 70);
  assert.equal(estimate.limitedHistory, false);
  assert.deepEqual(estimate.sources, [{ id: "focus", minutes: 70, samples: 3, weight: 1 }]);
});

test("manual budgets and focus history both affect the estimate with a disclosed 2:1 weight", () => {
  const state = history(sample(), { budget: 180, focused: 60 });
  const estimate = estimateDailyBudget(state, now);
  assert.equal(estimate.minutes, 143);
  assert.equal(estimate.baselineMinutes, 143);
  assert.deepEqual(estimate.sources, [
    { id: "manual", minutes: 180, samples: 3, weight: 2 },
    { id: "focus", minutes: 70, samples: 3, weight: 1 }
  ]);
});

test("one or two recorded days blend with the default instead of dominating", () => {
  const state = sample();
  manual(state, 1, 30);
  assert.equal(estimateDailyBudget(state, now).minutes, 90);
  manual(state, 2, 30);
  assert.equal(estimateDailyBudget(state, now).minutes, 60);
  manual(state, 3, 30);
  assert.equal(estimateDailyBudget(state, now).minutes, 30);
  assert.equal(estimateDailyBudget(state, now).limitedHistory, false);
  const focusOnly = sample(); focus(focusOnly, 1, 30);
  assert.equal(estimateDailyBudget(focusOnly, now).minutes, 92);
});

test("a sparse source retains its own default weight even beside a mature source", () => {
  const state = history(sample(), { budget: 180 });
  focus(state, 1, 30);
  const estimate = estimateDailyBudget(state, now);
  assert.equal(estimate.minutes, 151);
  assert.equal(estimate.limitedHistory, true);
  assert.deepEqual(estimate.sources.map(source => source.id), ["manual", "focus", "default"]);
});

test("zero manual history and a zero default are valid signals", () => {
  const state = history(sample(), { budget: 0 });
  assert.equal(estimateDailyBudget(state, now).minutes, 0);
  const empty = sample(); empty.preferences.dailyBudgetMinutes = 0;
  assert.equal(estimateDailyBudget(empty, now).minutes, 0);
});

test("focus sessions are summed by local day, including stopped sessions, not planned duration", () => {
  const state = sample();
  for (let day = 1; day <= 3; day++) {
    focus(state, day, 25);
    focus(state, day, 25, { outcome: "stopped", plannedSeconds: 180 * 60 });
    focus(state, day, 0, { plannedSeconds: 180 * 60 });
  }
  const estimate = estimateDailyBudget(state, now);
  assert.equal(estimate.minutes, 55);
  assert.equal(estimate.sources[0].samples, 3);
});

test("today, future, invalid, zero-focus and older-than-28-day sessions do not become history", () => {
  const state = history(sample(), { focused: 25 });
  for (const day of [0, -1, 29]) focus(state, day, 600);
  focus(state, 4, 600, { endedAt: "not-a-date" });
  focus(state, 5, 0);
  manual(state, 0, 900); manual(state, -1, 900); manual(state, 29, 900);
  const estimate = estimateDailyBudget(state, now);
  assert.equal(estimate.minutes, 25);
  assert.equal(estimate.samples, 0);
  assert.equal(estimate.sources[0].samples, 3);
});

test("the 28-day cutoff is inclusive; unrecorded days are not fabricated as zero", () => {
  const state = sample();
  for (const day of [1, 20, 28]) focus(state, day, 100);
  const estimate = estimateDailyBudget(state, now);
  assert.equal(estimate.minutes, 115);
  assert.equal(estimate.sources[0].samples, 3);
});

test("each source uses the latest seven distinct recorded days and resists isolated outliers", () => {
  const state = history(sample(), { budget: 90, focused: 25, days: 7 });
  for (const day of [8, 9, 10, 11, 12, 13, 14]) { manual(state, day, 900); focus(state, day, 900); }
  manual(state, 1, 600); // Same day replaces its value, not another sample.
  focus(state, 1, 500); // Same day accumulates focus, not another sample.
  state.sessions.reverse(); state.dayPlans.reverse();
  const estimate = estimateDailyBudget(state, now);
  assert.equal(estimate.sources[0].samples, 7);
  assert.equal(estimate.sources[1].samples, 7);
  assert.equal(estimate.sources[0].minutes, 90);
  assert.equal(estimate.sources[1].minutes, 25);
  assert.equal(estimate.minutes, 68);
});

test("automatic and legacy default budgets do not feed back into manual history", () => {
  const state = history(sample(), { focused: 25 });
  for (let day = 1; day <= 7; day++) manual(state, day, 900, day % 2 ? "automatic" : "default");
  const estimate = estimateDailyBudget(normalizeState(state, now), now);
  assert.equal(estimate.minutes, 25);
  assert.equal(estimate.samples, 0);
});

test("configured workday caps the estimate, including overnight and 24-hour windows", () => {
  const state = history(sample(), { budget: 600 });
  state.preferences.dayStart = "09:00"; state.preferences.dayEnd = "10:00";
  assert.equal(estimateDailyBudget(state, now).minutes, 60);
  assert.equal(estimateDailyBudget(state, now).baselineMinutes, 600);
  assert.equal(estimateDailyBudget(state, now).capped, true);
  state.preferences.dayStart = "22:00"; state.preferences.dayEnd = "02:00";
  assert.equal(estimateDailyBudget(state, now).minutes, 240);
  state.preferences.dayEnd = "22:00";
  assert.equal(estimateDailyBudget(state, now).workdayMinutes, 1440);
  assert.equal(estimateDailyBudget(state, now).minutes, 600);
});

test("workday limit is a whole-day cap and does not move when the panel opens later", () => {
  const state = history(sample(), { budget: 300, focused: 100 });
  for (const hour of [0, 8, 12, 23]) {
    const time = new Date(now); time.setHours(hour);
    assert.equal(estimateDailyBudget(state, time).minutes, 238);
  }
});

test("today's workload never raises capacity to hide overload", () => {
  let { state, task } = addTask(history(sample(), { focused: 60 }), { title: "Large task", durationMinutes: 180 }, now);
  const baseline = estimateDailyBudget(state, now).minutes;
  state = toggleTodayTask(state, task.id, now);
  state.schedule.push({ id: "reserved", taskId: task.id, startAt: now.toISOString(), endAt: new Date(now.getTime() + 60 * 60_000).toISOString(), status: "planned" });
  const budget = dailyBudget(state, now);
  assert.equal(budget.availableMinutes, baseline);
  assert.equal(budget.remainingWork, 180);
  assert.ok(budget.spareMinutes < 0);
  assert.equal(dayPlan(state, now).budgetSource, "automatic");
});

test("automatic plan-fit check deduplicates picked tasks, blocks and live timer time", () => {
  let { state, task } = addTask(history(sample(), { focused: 60 }), { title: "One task", durationMinutes: 60 }, now);
  state = toggleTodayTask(state, task.id, now);
  state.schedule.push({ id: "reserved", taskId: task.id, startAt: now.toISOString(), endAt: new Date(now.getTime() + 40 * 60_000).toISOString(), status: "planned" });
  state = startFocus(state, { mode: "single", taskId: task.id, durationMinutes: 60 }, now);
  const afterTen = new Date(now.getTime() + 10 * 60_000);
  state = pauseFocus(state, afterTen);
  const budget = dailyBudget(state, afterTen);
  assert.equal(budget.availableMinutes, 70);
  assert.equal(budget.focusedMinutes, 10);
  assert.equal(budget.remainingWork, 50);
  assert.equal(budget.totalMinutes, 65);
});

test("today's manual value, including zero or more than the cap, wins across normalization", () => {
  let state = history(sample(), { budget: 180, focused: 60 });
  state.preferences.dayEnd = "09:00";
  for (const minutes of [0, 500]) {
    state = saveDayPlan(state, { availableMinutes: minutes }, now);
    const next = normalizeState(state, now);
    assert.equal(dayPlan(next, now).availableMinutes, minutes);
    assert.equal(dayPlan(next, now).budgetSource, "manual");
  }
});

test("Use estimate clears only today's override, retaining selections and other history", () => {
  let { state, task } = addTask(history(sample(), { budget: 180, focused: 60 }), { title: "Keep me" }, now);
  state = toggleTodayTask(state, task.id, now);
  state = saveDayPlan(state, { availableMinutes: 0 }, now);
  const before = structuredClone(state);
  const next = useAutomaticDailyBudget(state, now);
  const plan = dayPlan(next, now);
  assert.equal(plan.availableMinutes, 143);
  assert.equal(plan.budgetSource, "automatic");
  assert.deepEqual(plan.taskIds, [task.id]);
  assert.equal(next.dayPlans.find(item => item.date === localDateKey(now)).availableMinutes, 143);
  assert.deepEqual(next.dayPlans.filter(item => item.date !== localDateKey(now)), before.dayPlans.filter(item => item.date !== localDateKey(now)));
  assert.deepEqual(state, before);
  const restored = restoreBackup(createBackup(next, now), now);
  assert.equal(dayPlan(restored, now).availableMinutes, 143);
  assert.deepEqual(restored.tasks, next.tasks);
});

test("disabled automatic budgets retain previous behavior and reject the reset action", () => {
  const state = history(sample(), { focused: 25 }); state.preferences.autoDailyBudget = false;
  assert.equal(dayPlan(state, now).availableMinutes, 120);
  assert.throws(() => useAutomaticDailyBudget(state, now), /Enable automatic/);
  assert.doesNotMatch(renderBudget(state, { now }), /Budget sources|use-automatic-budget/);
});

test("estimation is pure and automatic persisted values are recalculated, not treated as training data", () => {
  const state = history(sample(), { focused: 60 });
  manual(state, 0, 999, "automatic");
  const before = structuredClone(state);
  assert.equal(dayPlan(state, now).availableMinutes, 70);
  estimateDailyBudget(state, now);
  assert.deepEqual(state, before);
});

test("history boundaries use local dates in Vietnamese time, not UTC dates", () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = "Asia/Ho_Chi_Minh";
  try {
    const time = new Date("2026-09-19T00:30:00+07:00");
    const state = sample();
    state.sessions = [
      { endedAt: "2026-09-18T23:50:00+07:00", focusedSeconds: 25 * 60 },
      { endedAt: "2026-09-19T00:10:00+07:00", focusedSeconds: 300 * 60 }
    ];
    const source = estimateDailyBudget(state, time).sources.find(item => item.id === "focus");
    assert.equal(source.samples, 1);
    assert.equal(source.minutes, 25);
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test("source disclosure and manual reset render in English and Vietnamese without translating task text", () => {
  let { state, task } = addTask(history(sample(), { budget: 180, focused: 60 }), { title: "Recent budgets <example>" }, now);
  state = toggleTodayTask(state, task.id, now);
  setLanguage("en");
  const english = renderBudget(state, { now });
  assert.match(english, /<details class="mini-disclosure"><summary>How this estimate works/);
  assert.match(english, /Recent budgets · 3 days/);
  assert.match(english, /Focus history \+ breaks · 3 days/);
  assert.match(english, /Today's workload/);
  assert.doesNotMatch(english, /data-action="use-automatic-budget"/);
  state = saveDayPlan(state, { availableMinutes: 0 }, now);
  setLanguage("vi");
  try {
    const vietnamese = renderBudget(state, { now });
    assert.match(vietnamese, /Cơ sở ước tính/);
    assert.match(vietnamese, /Quỹ thời gian gần đây · 3 ngày/);
    assert.match(vietnamese, /Lịch sử tập trung \+ nghỉ · 3 ngày/);
    assert.match(vietnamese, /data-action="use-automatic-budget">Dùng ước tính/);
    assert.match(vietnamese, /value="0"/);
    assert.match(vietnamese, /Recent budgets &lt;example&gt;/);
    assert.doesNotMatch(vietnamese, /Blended baseline|Workday cap|Today's workload/);
  } finally { setLanguage("en"); }
});

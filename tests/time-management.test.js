import test from "node:test";
import assert from "node:assert/strict";
import { addTask, createBackup, createDefaultState, normalizeState, restoreBackup, updateTask } from "../src/core/state.js";
import { startFocus, startNextPhase, reconcileFocus, pauseFocus, resumeFocus, stopFocus, skipBreak, remainingSeconds } from "../src/core/timer.js";
import { dailyBudget, dayPlan, moveToQuadrant, saveDayPlan, taskQuadrant, toggleTodayTask } from "../src/core/time-management.js";

const now = new Date(2026, 8, 17, 8, 0, 0);
const at = minutes => new Date(now.getTime() + minutes * 60_000);
const pomodoro = (options = {}) => startFocus(createDefaultState(now), { mode: "pomodoro", durationMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, cycles: 4, ...options }, now);
const expire = state => reconcileFocus(state, new Date(state.focus.endsAt)).state;

test("Pomodoro completes four focus rounds with short/long breaks and excludes rest from history", () => {
  let state = pomodoro();
  for (let round = 1; round <= 4; round++) {
    const focusEnd = new Date(state.focus.endsAt);
    state = expire(state);
    assert.equal(state.focus.status, "ready");
    assert.equal(state.focus.phase, "break");
    assert.equal(state.focus.completedCycles, round);
    assert.equal(state.focus.plannedSeconds, round === 4 ? 900 : 300);
    state = startNextPhase(state, focusEnd);
    const breakEnd = new Date(state.focus.endsAt);
    state = expire(state);
    assert.equal(state.sessions.length, round);
    if (round < 4) {
      assert.equal(state.focus.status, "ready");
      assert.equal(state.focus.phase, "focus");
      state = startNextPhase(state, breakEnd);
    }
  }
  assert.equal(state.focus.status, "complete");
  assert.equal(state.focus.lastSummary.focusedSeconds, 100 * 60);
  assert.equal(state.focus.lastSummary.completedCycles, 4);
  assert.deepEqual(state.sessions.map(s => s.cycleNumber), [1, 2, 3, 4]);
  assert.equal(new Set(state.sessions.map(s => s.id)).size, 4);
});

test("sleep or delayed alarm completes only the elapsed phase and keeps its actual end date", () => {
  const state = reconcileFocus(pomodoro(), at(24 * 60)).state;
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].endedAt, at(25).toISOString());
  assert.equal(state.focus.status, "ready");
  assert.equal(state.focus.endsAt, null);
  const again = reconcileFocus(normalizeState(state), at(48 * 60));
  assert.equal(again.changed, false);
  assert.equal(again.state.sessions.length, 1);
  assert.equal(remainingSeconds(state.focus, at(50 * 60)), 300);
});

test("pause/resume across reload excludes paused time from a partial focus round", () => {
  let state = pauseFocus(pomodoro(), at(10));
  state = normalizeState(state);
  state = resumeFocus(state, at(60));
  state = stopFocus(state, at(65));
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].focusedSeconds, 15 * 60);
  assert.equal(state.focus.lastSummary.focusedSeconds, 15 * 60);
  assert.equal(state.focus.lastSummary.completedCycles, 0);
});

test("pause/resume during a break and ending it never records a focus session", () => {
  let state = startNextPhase(expire(pomodoro()), at(25));
  state = pauseFocus(state, at(27));
  assert.equal(state.focus.remainingSeconds, 180);
  state = resumeFocus(normalizeState(state), at(80));
  state = stopFocus(state, at(81));
  assert.equal(state.sessions.length, 1);
  assert.equal(state.focus.lastSummary.focusedSeconds, 1500);
});

test("skip break waits for explicit next focus; finishing final break closes the cycle", () => {
  let state = skipBreak(expire(pomodoro({ cycles: 2 })), at(26));
  assert.equal(state.focus.phase, "focus");
  assert.equal(state.focus.status, "ready");
  assert.equal(state.sessions.length, 1);
  state = expire(startNextPhase(state, at(30)));
  state = skipBreak(state, at(56));
  assert.equal(state.focus.status, "complete");
  assert.equal(state.focus.lastSummary.completedCycles, 2);
  assert.equal(state.focus.lastSummary.focusedSeconds, 3000);
});

test("a ready, paused, or running timer cannot be overwritten by a new one", () => {
  for (const state of [pomodoro(), pauseFocus(pomodoro(), at(1)), expire(pomodoro())]) {
    assert.throws(() => startFocus(state, {}, at(30)), /current timer/);
  }
});

test("pausing at the deadline completes once; clicking Next twice cannot restart the phase", () => {
  let state = pauseFocus(pomodoro(), at(25));
  assert.equal(state.focus.status, "ready");
  state = startNextPhase(state, at(30));
  assert.deepEqual(startNextPhase(state, at(31)), state);
  assert.equal(state.sessions.length, 1);
});

test("v0.7 active timers migrate as single intervals while preserving task/memory/settings", () => {
  const old = createDefaultState(now);
  old.schemaVersion = 7;
  old.preferences.cycles = 2;
  old.memory.customInstructions = "Keep my settings";
  old.focus = { status: "running", phase: "focus", taskId: null, blockId: null, startedAt: now.toISOString(), endsAt: at(25).toISOString(), plannedSeconds: 1500, remainingSeconds: 1500, breakMinutes: 5, targetCycles: 2, completedCycles: 0, activeSessionId: "old-session" };
  const migrated = normalizeState(old, now);
  assert.equal(migrated.memory.customInstructions, "Keep my settings");
  assert.equal(migrated.preferences.cycles, 2);
  const finished = reconcileFocus(migrated, at(30)).state;
  assert.equal(finished.focus.status, "complete");
  assert.equal(finished.sessions[0].focusedSeconds, 1500);
});

test("Eisenhower automatic urgency respects the exact 24-hour boundary and manual overrides", () => {
  const task = { important: true, urgency: "auto", dueAt: at(24 * 60).toISOString() };
  assert.equal(taskQuadrant(task, now), "do");
  assert.equal(taskQuadrant({ ...task, dueAt: at(24 * 60 + 1).toISOString() }, now), "schedule");
  assert.equal(taskQuadrant({ ...task, dueAt: at(-60).toISOString() }, now), "do");
  assert.equal(taskQuadrant({ ...task, urgency: "not-urgent" }, now), "schedule");
  assert.equal(taskQuadrant({ ...task, important: false }, now), "delegate");
  assert.equal(taskQuadrant({ ...task, important: false, dueAt: null }, now), "defer");
  assert.equal(taskQuadrant({ ...task, important: null, priority: "high" }, now), "unsorted");
});

test("moving quadrants preserves task identity/priority/schedule; sorting back restores automatic urgency", () => {
  const { state, task } = addTask(createDefaultState(now), { title: "Important paper", priority: "low", notes: "Preserve", durationMinutes: 60 }, now);
  const moved = moveToQuadrant(state, task.id, "do", now);
  assert.equal(moved.tasks[0].id, task.id);
  assert.equal(moved.tasks[0].priority, "low");
  assert.equal(moved.tasks[0].notes, "Preserve");
  assert.equal(moved.tasks[0].important, true);
  assert.equal(moved.tasks[0].urgency, "urgent");
  assert.deepEqual(moved.schedule, state.schedule);
  assert.equal(moveToQuadrant(moved, task.id, "unsorted", now).tasks[0].important, null);
});

test("time budget avoids counting a task estimate and its schedule twice and subtracts recorded work", () => {
  let { state, task } = addTask(createDefaultState(now), { title: "Paper", durationMinutes: 60 }, now);
  state = toggleTodayTask(state, task.id, now);
  state.schedule.push({ id: "b", taskId: task.id, startAt: at(10).toISOString(), endAt: at(35).toISOString(), status: "planned" });
  state.sessions.push({ id: "s", taskId: task.id, startedAt: at(-25).toISOString(), endedAt: now.toISOString(), focusedSeconds: 1500, plannedSeconds: 1500, outcome: "completed" });
  const b = dailyBudget(state, now);
  assert.equal(b.remainingWork, 35);
  assert.equal(b.focusedMinutes, 25);
  assert.equal(b.breakMinutes, 5);
  assert.equal(b.totalMinutes, 65);
  assert.equal(b.spareMinutes, 55);
});

test("budget clips overnight blocks to today and excludes skipped/done blocks and closed tasks", () => {
  let { state, task } = addTask(createDefaultState(now), { title: "Block", durationMinutes: 25 }, now);
  state.schedule.push({ id: "overnight", taskId: task.id, startAt: at(-600).toISOString(), endAt: at(30).toISOString(), status: "planned" });
  state.schedule.push({ id: "skip", taskId: task.id, startAt: at(60).toISOString(), endAt: at(90).toISOString(), status: "skipped" });
  assert.equal(dailyBudget(state, now).remainingWork, 30);
  state = updateTask(state, task.id, { status: "done" }, now);
  assert.equal(dailyBudget(state, now).remainingWork, 0);
});

test("a new local day has a fresh selection; zero budget reports overload without invalid ratios", () => {
  let { state, task } = addTask(createDefaultState(now), { title: "Paper", durationMinutes: 25 }, now);
  state = toggleTodayTask(state, task.id, now);
  state = saveDayPlan(state, { availableMinutes: 0 }, now);
  assert.equal(dailyBudget(state, now).spareMinutes, -25);
  assert.equal(dailyBudget(state, now).fill, 1);
  assert.deepEqual(dayPlan(state, at(24 * 60)).taskIds, []);
  assert.equal(dayPlan(state, at(24 * 60)).availableMinutes, 120);
  assert.throws(() => saveDayPlan(state, { availableMinutes: -1 }, now), /between/);
});

test("backup round-trip retains quadrants, daily choices, and a ready Pomodoro without duplicate history", () => {
  let { state, task } = addTask(createDefaultState(now), { title: "Reading", important: true, urgency: "not-urgent" }, now);
  state = toggleTodayTask(state, task.id, now);
  state = expire(startFocus(state, { mode: "pomodoro", taskId: task.id, durationMinutes: 25 }, now));
  const restored = restoreBackup(createBackup(state, at(25)), at(30));
  assert.equal(restored.tasks[0].important, true);
  assert.equal(restored.tasks[0].urgency, "not-urgent");
  assert.deepEqual(restored.dayPlans[0].taskIds, [task.id]);
  assert.equal(restored.focus.status, "ready");
  assert.equal(reconcileFocus(restored, at(100)).state.sessions.length, 1);
});

test("budget includes remaining Pomodoro rounds, even without a picked task, and avoids double-counting live focus", () => {
  const state = pomodoro();
  const b = dailyBudget(state, at(10));
  assert.equal(b.focusedMinutes, 10);
  assert.equal(b.remainingWork, 90);
  const waiting = expire(state);
  assert.equal(dailyBudget(waiting, at(25)).remainingWork, 75);
  assert.equal(dailyBudget(waiting, at(25)).focusedMinutes, 25);
});

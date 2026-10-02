import test from "node:test";
import assert from "node:assert/strict";
import { addTask, archiveTask, completeTask, createBackup, createDefaultState, normalizeState, restoreBackup } from "../src/core/state.js";
import { startFocus, pauseFocus, resumeFocus, reconcileFocus, startNextPhase, skipBreak } from "../src/core/timer.js";
import { toggleTodayTask } from "../src/core/time-management.js";
import { applyKanbanAction as act, reconcileKanban, kanbanItem, kanbanStage, kanbanWip, canUndoKanban, kanbanSuggestion, kanbanMetrics } from "../src/core/kanban.js";
import { normalizeKanban } from "../src/core/kanban-state.js";
import { localDateKey } from "../src/core/utils.js";
import { renderKanban, renderKanbanModal, renderKanbanOffer } from "../src/kanban-view.js";
import { buildDayAdviceRequest } from "../src/core/day-advice.js";

const now = new Date(2026, 8, 20, 9);
const at = minutes => new Date(now.getTime() + minutes * 60000);
function sample(count = 3) {
  let state = createDefaultState(now);
  for (let index = 0; index < count; index++) state = addTask(state, { id: `t${index}`, title: `Task ${index}`, durationMinutes: 25 }, now).state;
  return state;
}
const enabled = (count = 3) => act(sample(count), "enable", {}, now);
const move = (state, id, stage = "doing", time = now) => act(state, "move", { taskId: id, stage }, time);
const start = (state, id = "t0", time = now) => reconcileKanban(startFocus(state, { taskId: id, durationMinutes: 25 }, time), state, time);
const picked = (state, id = "t0", time = now) => reconcileKanban(toggleTodayTask(state, id, time), state, time);
const block = (taskId, startMinute = 30, endMinute = 55, status = "planned") => ({ id: `b-${taskId}-${startMinute}`, taskId, startAt: at(startMinute).toISOString(), endAt: at(endMinute).toISOString(), status });

test("Kanban migrates off and leaves task classifications, budget, focus and history unchanged", () => {
  const old = sample(); old.schemaVersion = 9; delete old.kanban;
  old.preferences.autoDailyBudget = true; old.tasks[0].important = true;
  const next = normalizeState(old, now);
  assert.equal(next.schemaVersion, 12);
  assert.equal(next.kanban.enabled, false);
  assert.equal(next.kanban.wipLimit, 2);
  assert.deepEqual(next.kanban.items, []);
  assert.deepEqual(next.tasks, old.tasks);
  assert.deepEqual(next.focus, old.focus);
  assert.equal(next.preferences.autoDailyBudget, true);
});

test("off means no automatic movement, even with picked tasks, blocks or a timer", () => {
  let state = sample(); state = toggleTodayTask(state, "t0", now); state.schedule.push(block("t1"));
  const next = start(state, "t2");
  assert.deepEqual(next.kanban.items, []);
  assert.deepEqual(next.kanban.changes, []);
  assert.equal(kanbanSuggestion(next, now), null);
  assert.throws(() => move(next, "t0"), /Enable Kanban/);
});

test("enabling offers Ready for explicit picks and blocks, without changing tasks or importing old timer starts", () => {
  let state = toggleTodayTask(sample(), "t0", now);
  state.schedule.push(block("t1")); state = startFocus(state, { taskId: "t2" }, now);
  const before = structuredClone(state);
  const next = act(state, "enable", {}, now);
  assert.equal(kanbanStage(next, next.tasks[0]), "ready");
  assert.equal(kanbanStage(next, next.tasks[1]), "ready");
  assert.equal(kanbanStage(next, next.tasks[2]), "backlog");
  assert.deepEqual(next.tasks, state.tasks);
  assert.deepEqual(next.schedule, state.schedule);
  assert.deepEqual(next.focus, state.focus);
  assert.deepEqual(state, before);
  assert.deepEqual(next.kanban.changes.map(change => change.reason), ["picked_today", "scheduled_today"]);
  assert.equal(next.kanban.changes[0].evidence.date, localDateKey(now));
});

test("Ready synchronization is idempotent and ignores proposals, past, tomorrow, done and skipped blocks", () => {
  let state = enabled(6);
  state.schedule.push(block("t0"), block("t1", -60, -30), block("t2", 1440, 1465), block("t3", 30, 55, "done"), block("t4", 30, 55, "skipped"));
  state.proposals.push({ blocks: [block("t5")] });
  state = reconcileKanban(state, state, now);
  assert.deepEqual(state.kanban.items.map(item => item.taskId), ["t0"]);
  assert.deepEqual(reconcileKanban(state, state, now), state);
  assert.equal(state.kanban.changes[0].evidence.blockId, state.schedule[0].id);
});

test("midnight and removing a pick or schedule never move unfinished work backwards", () => {
  let state = picked(enabled());
  state = picked(state);
  state.schedule = [];
  const next = reconcileKanban(state, state, at(1440));
  assert.equal(kanbanItem(next, "t0").stage, "ready");
  assert.equal(next.kanban.changes.length, 1);
});

test("a new task timer enters Doing once, and pause/resume and completion do not complete the task", () => {
  let state = start(picked(enabled()));
  assert.equal(kanbanItem(state, "t0").stage, "doing");
  assert.equal(kanbanItem(state, "t0").startedAt, now.toISOString());
  assert.equal(state.kanban.changes.at(-1).reason, "timer_started");
  assert.equal(state.kanban.changes.at(-1).evidence.sessionId, state.focus.activeSessionId);
  const count = state.kanban.changes.length;
  let next = reconcileKanban(pauseFocus(state, at(5)), state, at(5));
  next = reconcileKanban(resumeFocus(next, at(10)), next, at(10));
  next = reconcileKanban(reconcileFocus(next, at(50)).state, next, at(50));
  assert.equal(next.tasks[0].status, "inbox");
  assert.equal(kanbanWip(next).length, 1);
  assert.equal(next.kanban.changes.length, count);
});

test("Pomodoro break and subsequent rounds retain one task start without duplicate moves", () => {
  let state = enabled();
  state = reconcileKanban(startFocus(state, { taskId: "t0", mode: "pomodoro", cycles: 2 }, now), state, now);
  state = reconcileKanban(reconcileFocus(state, at(25)).state, state, at(25));
  state = reconcileKanban(startNextPhase(state, at(26)), state, at(26));
  state = reconcileKanban(skipBreak(state, at(27)), state, at(27));
  state = reconcileKanban(startNextPhase(state, at(28)), state, at(28));
  assert.equal(state.kanban.changes.length, 1);
  assert.equal(kanbanItem(state, "t0").startedAt, now.toISOString());
});

test("open-focus timers do not invent a task or a Kanban move", () => {
  const state = enabled();
  const next = reconcileKanban(startFocus(state, {}, now), state, now);
  assert.equal(next.kanban.changes.length, 0);
  assert.deepEqual(next.tasks, state.tasks);
});

test("manual starts require confirmation beyond WIP, whereas a real timer start remains visible", () => {
  let state = move(move(enabled(), "t0"), "t1");
  assert.throws(() => move(state, "t2"), /WIP limit reached/);
  const override = act(state, "move", { taskId: "t2", stage: "doing", confirmOverLimit: true }, now);
  assert.equal(kanbanWip(override).length, 3);
  const timed = start(state, "t2");
  assert.equal(kanbanWip(timed).length, 3);
  assert.match(renderKanban(timed, { now }), /WIP limit reached/);
  assert.equal(timed.focus.status, "running");
});

test("blocked work remains WIP and no rule clears its blocker", () => {
  let state = move(enabled(), "t0");
  state = act(state, "block", { taskId: "t0", reason: "Waiting for dataset" }, now);
  assert.equal(kanbanWip(state).length, 1);
  const next = start(state);
  assert.equal(kanbanItem(next, "t0").blockedReason, "Waiting for dataset");
  assert.equal(kanbanMetrics(next, now).blocked, 1);
  assert.throws(() => move(next, "t0", "ready"), /Started work stays/);
  assert.throws(() => act(next, "block", { taskId: "t1", reason: "Not started" }, now), /Only started/);
  const unblocked = act(next, "unblock", { taskId: "t0" }, now);
  assert.equal(kanbanItem(unblocked, "t0").blockedReason, "");
  assert.equal(kanbanWip(unblocked).length, 1);
});

test("manual choices pause all task automation until explicitly allowed", () => {
  let state = picked(enabled());
  state = move(state, "t0", "backlog");
  state = start(state);
  assert.equal(kanbanItem(state, "t0").stage, "backlog");
  assert.equal(kanbanItem(state, "t0").manualHold, true);
  state = act(state, "allow-auto", { taskId: "t0" }, now);
  assert.equal(kanbanItem(state, "t0").stage, "ready");
  // Allowing automation does not backfill the timer already running.
  assert.equal(state.kanban.changes.at(-1).reason, "picked_today");
});

test("each automation can be switched off independently", () => {
  let state = act(enabled(), "settings", { patch: { autoReady: false, autoStart: false, showHints: false } }, now);
  state = picked(state); state = start(state);
  assert.equal(state.kanban.changes.length, 0);
  assert.equal(kanbanSuggestion(state, now), null);
  state = act(state, "settings", { patch: { autoReady: true } }, now);
  assert.equal(kanbanItem(state, "t0").stage, "ready");
  assert.equal(state.kanban.autoStart, false);
});

test("Undo reverses only the latest unchanged board move and prevents immediate reapplication", () => {
  let state = picked(enabled());
  const change = state.kanban.changes[0];
  const tasks = structuredClone(state.tasks), schedule = structuredClone(state.schedule), focus = structuredClone(state.focus);
  assert.equal(canUndoKanban(state, change), true);
  state = act(state, "undo", { changeId: change.id }, at(1));
  assert.equal(kanbanItem(state, "t0").stage, "backlog");
  assert.equal(kanbanItem(state, "t0").manualHold, true);
  assert.equal(state.kanban.changes[0].undoneAt, at(1).toISOString());
  assert.deepEqual(reconcileKanban(state, state, at(2)), state);
  assert.deepEqual(state.tasks, tasks); assert.deepEqual(state.schedule, schedule); assert.deepEqual(state.focus, focus);
  assert.throws(() => act(state, "undo", { changeId: change.id }, at(2)), /changed again/);
});

test("newer moves, blockers, completion and archive guard against stale Undo", () => {
  const base = picked(enabled()); const change = base.kanban.changes[0];
  for (const state of [start(base), move(base, "t0"), completeTask(base, "t0", now), archiveTask(base, "t0", now)]) assert.equal(canUndoKanban(state, change), false);
  const timed = start(base); const latest = timed.kanban.changes.at(-1);
  const blocked = act(timed, "block", { taskId: "t0", reason: "Wait" }, now);
  assert.equal(canUndoKanban(blocked, latest), false);
});

test("undoing an automatic start leaves the live timer unchanged and does not infer completion", () => {
  let state = start(picked(enabled()));
  const focus = structuredClone(state.focus), change = state.kanban.changes.at(-1);
  state = act(state, "undo", { changeId: change.id }, at(1));
  assert.equal(kanbanItem(state, "t0").stage, "ready");
  assert.equal(kanbanItem(state, "t0").startedAt, null);
  assert.deepEqual(state.focus, focus);
  assert.equal(state.tasks[0].status, "inbox");
});

test("revisions reject stale edits and bad settings without partial mutation", () => {
  const state = picked(enabled()), before = structuredClone(state);
  assert.throws(() => act(state, "move", { taskId: "t0", stage: "doing", expectedRevision: 0 }, now), /task changed/);
  assert.throws(() => act(state, "settings", { patch: { wipLimit: 0, autoStart: false } }, now), /range/);
  assert.throws(() => act(state, "settings", { patch: { ageDays: 1.5 } }, now), /range/);
  assert.throws(() => act(state, "settings", { patch: { autoReady: "yes" } }, now), /on or off/);
  assert.throws(() => act(state, "move", { taskId: "t0", stage: "done" }, now), /stage/);
  assert.deepEqual(state, before);
});

test("disable retains board history; re-enable does not reconstruct timer starts while off", () => {
  let state = picked(enabled()); const changes = structuredClone(state.kanban.changes);
  state = act(state, "disable", {}, now);
  state = start(state, "t1");
  assert.equal(kanbanItem(state, "t1").stage, "backlog");
  state = act(state, "enable", {}, at(1));
  assert.deepEqual(state.kanban.changes, changes);
  assert.equal(kanbanItem(state, "t1").startedAt, null);
});

test("Done follows explicit completion in any view and archive never masquerades as completion", () => {
  let state = move(enabled(), "t0");
  state = completeTask(state, "t0", at(10));
  state = archiveTask(state, "t1", at(15));
  assert.equal(kanbanStage(state, state.tasks[0]), "done");
  assert.equal(kanbanStage(state, state.tasks[1]), "archived");
  assert.equal(kanbanWip(state).length, 0);
  assert.equal(kanbanMetrics(state, at(20)).completed, 1);
});

test("next-task suggestions are deterministic, explainable and never start or change work", () => {
  let state = enabled(5);
  for (const task of state.tasks) state = move(state, task.id, "ready");
  state.tasks[1].priority = "high"; state.tasks[2].important = true; state.tasks[3].urgency = "urgent";
  state.schedule.push(block("t4"));
  const before = structuredClone(state);
  assert.equal(kanbanSuggestion(state, now).task.id, "t4");
  assert.equal(kanbanSuggestion(state, now).reason, "scheduled_today");
  assert.deepEqual(state, before);
  state.schedule = [];
  assert.equal(kanbanSuggestion(state, now).task.id, "t3");
  state.tasks[3].urgency = "not-urgent";
  assert.equal(kanbanSuggestion(state, now).task.id, "t2");
  state.tasks[2].important = false;
  assert.equal(kanbanSuggestion(state, now).task.id, "t1");
  state.tasks[1].priority = "normal";
  assert.equal(kanbanSuggestion(state, now).task.id, "t0");
});

test("oldest-ready fallback uses waiting time rather than an unrelated future deadline", () => {
  let state = move(enabled(), "t0", "ready", at(1));
  state = move(state, "t1", "ready", at(2));
  state.tasks[1].dueAt = at(14400).toISOString();
  assert.equal(kanbanSuggestion(state, at(3)).task.id, "t0");
  state = move(move(state, "t0"), "t1");
  assert.equal(kanbanSuggestion(state, at(3)), null);
});

test("metrics use elapsed time, only observed starts, and exclude future and pre-enable completions", () => {
  let state = enabled(5);
  state = move(state, "t0", "doing", at(10));
  state = move(state, "t1", "doing", at(20));
  state = completeTask(state, "t0", at(70));
  state = completeTask(state, "t2", at(80)); // Explicit completion without observed start.
  state = completeTask(state, "t3", at(-10));
  state = completeTask(state, "t4", at(1000));
  const metrics = kanbanMetrics(state, at(100));
  assert.equal(metrics.wip, 1); assert.equal(metrics.completed, 2);
  assert.equal(metrics.medianCycleMinutes, 60); assert.equal(metrics.cycleSamples, 1);
  assert.equal(metrics.oldestMinutes, 80);
});

test("weekly review waits seven days, acknowledges once per interval and remains an in-app hint", () => {
  let state = enabled();
  assert.equal(kanbanMetrics(state, at(7 * 1440 - 1)).reviewDue, false);
  assert.equal(kanbanMetrics(state, at(7 * 1440)).reviewDue, true);
  state = act(state, "review", {}, at(7 * 1440));
  assert.equal(kanbanMetrics(state, at(7 * 1440)).reviewDue, false);
  assert.equal(kanbanMetrics(state, at(14 * 1440)).reviewDue, true);
  const off = act(state, "disable", {}, at(14 * 1440));
  assert.equal(kanbanMetrics(off, at(15 * 1440)).reviewDue, false);
});

test("normalization bounds metadata, drops orphan entries and unknown fields, and keeps Undo valid", () => {
  const state = picked(enabled());
  const normalized = normalizeState(state, now);
  assert.equal(canUndoKanban(normalized, normalized.kanban.changes[0]), true);
  const k = normalizeKanban({ ...state.kanban, wipLimit: 999, ageDays: -1, injected: true, items: [...state.kanban.items, { taskId: "missing" }] }, new Set(["t0"]));
  assert.equal(k.wipLimit, 10); assert.equal(k.ageDays, 1); assert.equal(k.injected, undefined);
  assert.equal(k.items.length, 1);
});

test("backup keeps opt-in, blockers, controls and audit trail without changing task identity", () => {
  let state = start(picked(enabled()));
  state = act(state, "block", { taskId: "t0", reason: "Dataset approval" }, now);
  const restored = restoreBackup(createBackup(state, now), now);
  assert.deepEqual(restored.kanban, normalizeState(state, now).kanban);
  assert.deepEqual(restored.tasks, state.tasks);
});

test("explanations and blocker text are escaped; preview contains no task mutation controls", () => {
  let state = start(picked(enabled()));
  state.tasks[0].title = '<img src=x onerror="bad()">';
  state = act(state, "block", { taskId: "t0", reason: "<script>private blocker</script>" }, now);
  const view = renderKanban(state, { now });
  assert.match(view, /&lt;img/); assert.match(view, /&lt;script&gt;/);
  assert.doesNotMatch(view, /<script>|<img src=x/);
  const before = structuredClone(state), preview = renderKanban(state, { preview: true, now });
  assert.doesNotMatch(preview, /data-action="(?:complete-task|kanban-move|kanban-undo|open-focus)"/);
  assert.deepEqual(state, before);
  const advice = JSON.stringify(buildDayAdviceRequest(state, now));
  assert.doesNotMatch(advice, /private blocker|kanban|Dataset approval/);
});

test("dismissed opt-in stays hidden on Plan but remains accessible from Settings", () => {
  let state = sample();
  assert.match(renderKanbanOffer(state), /Try Kanban/);
  state = act(state, "dismiss", {}, now);
  assert.equal(renderKanbanOffer(state), "");
  assert.match(renderKanbanOffer(state, { always: true }), /Try Kanban/);
  assert.match(renderKanbanModal(state, { type: "kanban-preview" }), /Enable Kanban/);
  assert.equal(state.kanban.enabled, false);
});

test("changing task automation does not reset how long a Ready task has waited", () => {
  let state = move(enabled(), "t0", "ready", at(1));
  state = move(state, "t1", "ready", at(2));
  state = act(state, "allow-auto", { taskId: "t0" }, at(3));
  state = normalizeState(state, at(4));
  assert.equal(kanbanItem(state, "t0").readyAt, at(1).toISOString());
  assert.equal(kanbanSuggestion(state, at(4)).task.id, "t0");
  state = move(state, "t0", "backlog", at(5));
  state = move(state, "t0", "ready", at(6));
  assert.equal(kanbanSuggestion(state, at(7)).task.id, "t1");
});

test("the automatic move history is capped at 100 and the newest Undo remains valid", () => {
  let state = picked(enabled(1));
  const events = structuredClone(state.events);
  for (let index = 1; index <= 105; index++) {
    state = act(state, "undo", { changeId: state.kanban.changes.at(-1).id }, at(index));
    state = act(state, "allow-auto", { taskId: "t0" }, at(index));
  }
  assert.equal(state.kanban.changes.length, 100);
  assert.equal(new Set(state.kanban.changes.map(change => change.id)).size, 100);
  assert.equal(canUndoKanban(state, state.kanban.changes.at(-1)), true);
  assert.equal(state.tasks.length, 1);
  assert.deepEqual(state.events, events); // Kanban metadata is not AI learning evidence.
});

test("local-day boundary includes an overlapping block but excludes ended and tomorrow-only blocks", () => {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const stamp = minutes => new Date(midnight.getTime() + minutes * 60000).toISOString();
  const state = enabled();
  state.schedule = [
    { id: "overlap", taskId: "t0", startAt: stamp(-15), endAt: stamp(15), status: "planned" },
    { id: "ended", taskId: "t1", startAt: stamp(-30), endAt: stamp(0), status: "planned" },
    { id: "tomorrow", taskId: "t2", startAt: stamp(1440), endAt: stamp(1470), status: "planned" }
  ];
  const next = reconcileKanban(state, state, midnight);
  assert.deepEqual(next.kanban.items.map(item => item.taskId), ["t0"]);
  assert.equal(next.kanban.changes[0].evidence.date, localDateKey(midnight));
});

test("aging and weekly hints are derived at the boundary, can be hidden, and never mutate work", () => {
  let state = move(enabled(), "t0", "doing", now);
  const before = structuredClone(state);
  assert.doesNotMatch(renderKanban(state, { now: at(3 * 1440 - 1) }), /Past your aging threshold/);
  assert.match(renderKanban(state, { now: at(3 * 1440) }), /Past your aging threshold/);
  assert.match(renderKanban(state, { now: at(7 * 1440) }), /<h3>Weekly Kanban review/);
  assert.deepEqual(state, before);
  state = act(state, "settings", { patch: { showHints: false } }, now);
  assert.doesNotMatch(renderKanban(state, { now: at(7 * 1440) }), /Past your aging threshold|<h3>Weekly Kanban review|Suggested next/);
  assert.equal(kanbanItem(state, "t0").stage, "doing");
});

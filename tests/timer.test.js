import test from "node:test";
import assert from "node:assert/strict";
import { addTask, createDefaultState } from "../src/core/state.js";
import { clearCompletedFocus, completeFocus, pauseFocus, reconcileFocus, remainingSeconds, resumeFocus, startFocus, stopFocus } from "../src/core/timer.js";

const now = new Date("2026-09-03T08:00:00.000Z");

test("starting focus creates a recoverable absolute end time", () => {
  const state = startFocus(createDefaultState(now), { durationMinutes: 25 }, now);
  assert.equal(state.focus.status, "running");
  assert.equal(state.focus.endsAt, "2026-09-03T08:25:00.000Z");
  assert.equal(state.events.at(-1).type, "focus_started");
});

test("remaining time derives from the absolute end time", () => {
  const state = startFocus(createDefaultState(now), { durationMinutes: 25 }, now);
  assert.equal(remainingSeconds(state.focus, new Date(now.getTime() + 60_000)), 24 * 60);
});

test("pause freezes remaining time and clears the end time", () => {
  const state = startFocus(createDefaultState(now), { durationMinutes: 25 }, now);
  const paused = pauseFocus(state, new Date(now.getTime() + 5 * 60_000));
  assert.equal(paused.focus.status, "paused");
  assert.equal(paused.focus.remainingSeconds, 20 * 60);
  assert.equal(paused.focus.endsAt, null);
});

test("resume rebuilds an absolute end time", () => {
  const started = startFocus(createDefaultState(now), { durationMinutes: 25 }, now);
  const paused = pauseFocus(started, new Date(now.getTime() + 5 * 60_000));
  const resumedAt = new Date(now.getTime() + 10 * 60_000);
  const resumed = resumeFocus(paused, resumedAt);
  assert.equal(resumed.focus.status, "running");
  assert.equal(resumed.focus.endsAt, new Date(resumedAt.getTime() + 20 * 60_000).toISOString());
});

test("stopping keeps elapsed focus in append-only sessions", () => {
  const started = startFocus(createDefaultState(now), { durationMinutes: 25 }, now);
  const stopped = stopFocus(started, new Date(now.getTime() + 6 * 60_000));
  assert.equal(stopped.focus.status, "complete");
  assert.equal(stopped.sessions.length, 1);
  assert.equal(stopped.sessions[0].focusedSeconds, 6 * 60);
  assert.equal(stopped.sessions[0].outcome, "stopped");
});

test("reconcile leaves an unexpired timer alone", () => {
  const started = startFocus(createDefaultState(now), { durationMinutes: 25 }, now);
  const result = reconcileFocus(started, new Date(now.getTime() + 60_000));
  assert.equal(result.changed, false);
  assert.equal(result.state.sessions.length, 0);
});

test("reconcile completes an expired timer exactly once", () => {
  const started = startFocus(createDefaultState(now), { durationMinutes: 1 }, now);
  const first = reconcileFocus(started, new Date(now.getTime() + 61_000));
  const second = reconcileFocus(first.state, new Date(now.getTime() + 62_000));
  assert.equal(first.changed, true);
  assert.equal(first.state.sessions.length, 1);
  assert.equal(second.changed, false);
  assert.equal(second.state.sessions.length, 1);
});

test("completing a scheduled focus block marks only that block done", () => {
  let state = createDefaultState(now);
  const added = addTask(state, { title: "Block task" }, now);
  state = added.state;
  state.schedule.push({ id: "block", taskId: added.task.id, startAt: now.toISOString(), endAt: new Date(now.getTime() + 60_000).toISOString(), status: "planned", source: "manual", proposalId: null, createdAt: now.toISOString() });
  state = startFocus(state, { durationMinutes: 1, taskId: added.task.id, blockId: "block" }, now);
  const finished = completeFocus(state, new Date(now.getTime() + 60_000));
  assert.equal(finished.schedule[0].status, "done");
  assert.equal(finished.tasks[0].status, "inbox");
});

test("closing the post-session view returns focus to idle", () => {
  const started = startFocus(createDefaultState(now), { durationMinutes: 1 }, now);
  const finished = completeFocus(started, new Date(now.getTime() + 60_000));
  const cleared = clearCompletedFocus(finished, new Date(now.getTime() + 61_000));
  assert.equal(cleared.focus.status, "idle");
  assert.ok(cleared.focus.lastSummary);
});

import test from "node:test";
import assert from "node:assert/strict";
import { computeAnalytics, privacyReducedReflectionPayload } from "../src/core/analytics.js";
import { createDefaultState } from "../src/core/state.js";

const now = new Date("2026-09-03T12:00:00.000Z");

function session(id, daysAgo, minutes, outcome = "completed") {
  const ended = new Date(now.getTime() - daysAgo * 86_400_000);
  return { id, taskId: "private-task", blockId: null, startedAt: new Date(ended.getTime() - minutes * 60_000).toISOString(), endedAt: ended.toISOString(), plannedSeconds: minutes * 60, focusedSeconds: minutes * 60, outcome };
}

test("analytics totals only the seven-day window", () => {
  const state = createDefaultState(now);
  state.sessions = [session("one", 0, 25), session("two", 3, 40), session("old", 9, 90)];
  const analytics = computeAnalytics(state, now);
  assert.equal(analytics.totalFocusedMinutes, 65);
  assert.equal(analytics.days.length, 7);
});

test("analytics calculates session completion rate", () => {
  const state = createDefaultState(now);
  state.sessions = [session("one", 0, 25), session("two", 1, 10, "stopped")];
  const analytics = computeAnalytics(state, now);
  assert.equal(analytics.completedSessions, 1);
  assert.equal(analytics.stoppedSessions, 1);
  assert.equal(analytics.sessionCompletionRate, 0.5);
});

test("reflection payload contains aggregates but no task identifiers", () => {
  const state = createDefaultState(now);
  state.tasks = [{ id: "private-task", title: "Secret dissertation topic", notes: "private note", status: "inbox" }];
  state.sessions = [session("one", 0, 25)];
  const payload = privacyReducedReflectionPayload(computeAnalytics(state, now));
  const json = JSON.stringify(payload);
  assert.equal(json.includes("Secret dissertation topic"), false);
  assert.equal(json.includes("private note"), false);
  assert.equal(json.includes("private-task"), false);
  assert.equal(payload.total_focus_minutes, 25);
});

test("an empty history produces neutral zero metrics", () => {
  const analytics = computeAnalytics(createDefaultState(now), now);
  assert.equal(analytics.totalFocusedMinutes, 0);
  assert.equal(analytics.sessionCompletionRate, 0);
  assert.equal(analytics.peakHour, null);
});

test("peak-hour inference excludes sessions older than the seven-day window", () => {
  const state = createDefaultState(now);
  const old = session("old", 10, 180);
  old.startedAt = "2026-08-20T01:00:00Z";
  state.sessions = [session("current", 0, 20), old];
  assert.equal(computeAnalytics(state, now).peakHour, new Date(state.sessions[0].endedAt).getHours());
});

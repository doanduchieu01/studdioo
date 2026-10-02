import test from "node:test";
import assert from "node:assert/strict";
import { activityEvidence, addEvidence, applyMemoryChanges, buildMemoryUpdateRequest, confirmMemory, exportLearnedMemory, forgetMemory, normalizeLearnedMemory, pendingEvidence, restoreLearnedMemory, saveExplicitMemory, selectMemories, undoMemoryChange } from "../src/core/learned-memory.js";
import { addTask, createDefaultState, updateTask } from "../src/core/state.js";
import { startFocus, stopFocus } from "../src/core/timer.js";

const now = new Date("2026-09-10T12:00:00Z");
function ready() {
  return normalizeLearnedMemory({ settings: { learningEnabled: true }, enabledAt: "2026-09-08T00:00:00Z" });
}
function evidence(count = 3) {
  return Array.from({ length: count }, (_, index) => ({ id: "event-" + index, at: index % 2 ? "2026-09-09T10:00:00Z" : "2026-09-10T10:00:00Z", day: index % 2 ? "2026-09-09" : "2026-09-10", type: "timer_recorded", origin: "studio-timer", title: "Read a paper", scope: "reading", recordedSeconds: 1200 }));
}
const proposal = (batch, overrides = {}) => ({ operation: "create", target_id: "", text: "Recorded reading timers commonly lasted twenty minutes.", scope: "reading", kind: "observation", evidence_ids: batch.map(item => item.id), expires_at: "", ...overrides });
function learned(overrides = {}, count = 3) {
  const store = addEvidence(ready(), evidence(count));
  return applyMemoryChanges(store, { changes: [proposal(store.evidence, overrides)] }, store.evidence, now);
}

test("learning and sharing default off and no historical evidence enters while off", () => {
  const store = normalizeLearnedMemory();
  assert.deepEqual(store.settings, { learningEnabled: false, useWithGemini: false });
  assert.deepEqual(addEvidence(store, evidence()).evidence, []);
  const late = ready(); late.enabledAt = now.toISOString();
  assert.deepEqual(addEvidence(late, evidence()).evidence, []);
});

test("explicit memory is immediately usable, bounded, deduplicated, and safe to correct", () => {
  let store = saveExplicitMemory(null, { text: "Use shorter reading sessions.", scope: "reading", kind: "preference" }, now);
  assert.deepEqual(selectMemories(store, "capture", "Read chapter 2", now), []);
  store.settings.useWithGemini = true;
  const first = store.memories[0];
  assert.equal(selectMemories(store, "capture", "Read chapter 2", now).length, 1);
  assert.equal(selectMemories(store, "capture", "Fix software bug", now).length, 0);
  assert.throws(() => saveExplicitMemory(store, { text: first.text, scope: "reading" }, now), /already saved/);
  store = saveExplicitMemory(store, { ...first, expectedRevision: first.revision, text: "Use flexible reading sessions." }, now);
  assert.throws(() => saveExplicitMemory(store, { ...first, expectedRevision: first.revision }, now), /changed while/);
  store = undoMemoryChange(store, store.history.at(-1).id, now);
  assert.equal(store.memories[0].text, first.text);
  assert.throws(() => saveExplicitMemory(store, { text: "x".repeat(601), scope: "general" }, now), /600/);
});

test("three events on two days support an observation, but not a preference inference", () => {
  assert.equal(learned().memories[0].status, "observation");
  assert.equal(learned({}, 2).memories[0].status, "tentative");
  const preference = learned({ kind: "preference", text: "Prefers twenty minute reading sessions." });
  assert.equal(preference.memories[0].status, "tentative");
  assert.deepEqual(selectMemories(preference, "advice", "Read", now), []);
  const confirmed = confirmMemory(preference, preference.memories[0].id, now);
  assert.equal(selectMemories(confirmed, "advice", "Read", now).length, 1);
});

test("same-day and duplicate evidence cannot satisfy the observation threshold", () => {
  const events = evidence().map(item => ({ ...item, day: "2026-09-10", at: "2026-09-10T10:00:00Z" }));
  let store = addEvidence(ready(), [...events, ...events]);
  assert.equal(store.evidence.length, 3);
  store = applyMemoryChanges(store, { changes: [proposal(store.evidence)] }, store.evidence, now);
  assert.equal(store.memories[0].status, "tentative");
});

test("invalid citations or any invalid change reject the whole response without mutation", () => {
  const store = addEvidence(ready(), evidence()), before = structuredClone(store);
  for (const bad of [{ evidence_ids: ["imaginary"] }, { target_id: "imaginary", operation: "revise" }, { expires_at: "2027-01-01T00:00:00Z" }, { text: "" }]) {
    assert.throws(() => applyMemoryChanges(store, { changes: [proposal(store.evidence), proposal(store.evidence, bad)] }, store.evidence, now));
    assert.deepEqual(store, before);
  }
});

test("model revisions cannot overwrite explicit or confirmed guidance", () => {
  let store = saveExplicitMemory(addEvidence(ready(), evidence()), { text: "I choose my reading times.", scope: "reading" }, now);
  const original = structuredClone(store.memories[0]);
  store = applyMemoryChanges(store, { changes: [proposal(store.evidence, { operation: "revise", target_id: original.id })] }, store.evidence, now);
  assert.deepEqual(store.memories.find(item => item.id === original.id), original);
  assert.equal(store.memories.find(item => item.id !== original.id).status, "conflict");
  assert.equal(selectMemories(store, "advice", "reading", now).length, 1);
});

test("reinforcement cannot reclassify a preference as an observation", () => {
  const store = learned({ kind: "preference" });
  assert.throws(() => applyMemoryChanges(store, { changes: [proposal(store.evidence, { operation: "reinforce", target_id: store.memories[0].id })] }, store.evidence, now), /cannot rewrite/);
});

test("forget removes old text and source evidence even after explicit corrections", () => {
  let store = learned();
  const original = store.memories[0], batch = structuredClone(store.evidence);
  store = saveExplicitMemory(store, { ...original, text: "I want to decide reading time myself." }, now);
  store = forgetMemory(store, original.id, now);
  assert.equal(store.memories.length, 0); assert.equal(store.evidence.length, 0); assert.equal(store.history.length, 0);
  assert.doesNotMatch(JSON.stringify(store), /Recorded reading|decide reading/);
  assert.throws(() => applyMemoryChanges(store, { changes: [proposal(batch)] }, batch, now), /excluded evidence/);
  assert.equal(addEvidence(store, batch).evidence.length, 0);
});

test("expired entries, disabled use, and tentative entries are excluded from context", () => {
  const store = learned();
  assert.equal(selectMemories(store, "capture", "reading", new Date("2026-12-31T00:00:00Z")).length, 0);
  store.settings.useWithGemini = false;
  assert.deepEqual(selectMemories(store, "capture", "reading", now), []);
  assert.deepEqual(selectMemories(learned(), "reflect", "reading", now), []);
});

test("context is bounded and carries source status and revision", () => {
  let store = ready();
  for (let index = 0; index < 12; index++) store = saveExplicitMemory(store, { text: index + " " + "x".repeat(590), scope: "general" }, now);
  const selected = selectMemories(store, "advice", "", now);
  assert.ok(selected.length <= 8);
  assert.ok(selected.reduce((sum, item) => sum + item.text.length, 0) <= 4000);
  assert.ok(selected.every(item => item.status === "explicit" && item.revision > 0));
});

test("memory export excludes jobs/history/traces and restore pauses learning without resetting budget", () => {
  const store = learned(); store.usage = { day: "2026-09-10", calls: 2, automaticDay: "2026-09-10" };
  store.job = { id: "inflight" }; store.lastContext = { action: "advice" };
  const exported = exportLearnedMemory(store);
  assert.equal(exported.job, undefined); assert.equal(exported.history, undefined); assert.equal(exported.lastContext, undefined);
  const restored = restoreLearnedMemory({ ...exported, job: { id: "forged" }, history: store.history }, store, now);
  assert.equal(restored.settings.learningEnabled, false);
  assert.equal(restored.job, null); assert.deepEqual(restored.history, []);
  assert.equal(restored.usage.calls, 2); assert.deepEqual(pendingEvidence(restored), []);
});

test("task edits and recorded timers have distinct provenance; old feedback is not learning evidence", () => {
  let state = createDefaultState(now);
  state.feedback.push({ id: "secret", text: "old private feedback" });
  const added = addTask(state, { title: "Read", source: "gemini", durationMinutes: 25 }, now);
  assert.equal(activityEvidence(state, added.state)[0].origin, "gemini-reviewed");
  const edited = updateTask(added.state, added.task.id, { durationMinutes: 20 }, now);
  assert.equal(activityEvidence(added.state, edited)[0].beforeMinutes, 25);
  const started = startFocus(edited, { taskId: added.task.id, durationMinutes: 20 }, now);
  const stopped = stopFocus(started, new Date(now.getTime() + 60000));
  const timer = activityEvidence(started, stopped)[0];
  assert.equal(timer.origin, "studio-timer"); assert.equal(timer.recordedSeconds, 60);
  assert.match(timer.detail, /not attention.*digital-device usage/);
  assert.deepEqual(activityEvidence(state, state), []);
  const store = addEvidence(ready(), [timer]);
  const request = buildMemoryUpdateRequest(store, store.evidence, "Keep it concise.");
  assert.doesNotMatch(request.input, /old private feedback/);
  assert.match(request.input, /Keep it concise/);
});

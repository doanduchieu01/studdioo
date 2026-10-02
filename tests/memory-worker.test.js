import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryWorker } from "../src/memory-worker.js";
import { LEARNED_MEMORY_KEY, MEMORY_ALARM, normalizeLearnedMemory, pendingEvidence, selectMemories } from "../src/core/learned-memory.js";
import { addTask, createDefaultState, STATE_KEY } from "../src/core/state.js";

process.env.TZ = "UTC";

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function harness() {
  let date = new Date("2026-09-10T10:00:00Z"), key = "fake-worker-credential", failing = false, active = false, response = { changes: [] };
  const values = new Map([[STATE_KEY, createDefaultState(date)]]), alarm = new Map(), calls = [], writes = [];
  const storage = {
    async get(name) { return { [name]: structuredClone(values.get(name)) }; },
    async set(update) { if (failing) throw new Error("Storage unavailable"); writes.push(structuredClone(update)); for (const [name, value] of Object.entries(update)) values.set(name, structuredClone(value)); }
  };
  const make = () => createMemoryWorker({
    storage,
    alarms: { async create(name, value) { alarm.set(name, value); }, async clear(name) { alarm.delete(name); } },
    readState: async () => structuredClone(values.get(STATE_KEY)),
    readCredential: async () => ({ apiKey: key }),
    interactiveBusy: () => active, now: () => new Date(date),
    requestUpdate: async (request, validate) => { calls.push(request); return validate(await (typeof response === "function" ? response(request) : response)); }
  });
  return { make, values, alarm, calls, writes, setDate(value) { date = new Date(value); }, key(value) { key = value; }, failStorage(value) { failing = value; }, busy(value) { active = value; }, respond(value) { response = value; } };
}
const changeFrom = request => {
  const entries = JSON.parse(request.input.split("\n").at(-1)).evidence;
  return { changes: [{ operation: "create", target_id: "", text: "May prefer flexible reading sessions.", kind: "preference", scope: "reading", evidence_ids: [entries[0].id], expires_at: "" }] };
};
async function enable(h, worker) { await worker.settings({ learningEnabled: true }); await worker.note("Short reading sessions felt manageable.", "reading"); }

test("learning opt-in queues new notes but does not make an immediate API call", async () => {
  const h = harness(), worker = h.make();
  await worker.initialize(); assert.equal(h.alarm.size, 0);
  await assert.rejects(worker.note("Private note", "general"), /Turn on/);
  await enable(h, worker);
  assert.equal(h.calls.length, 0); assert.equal(pendingEvidence(await worker.get()).length, 1);
  assert.ok(h.alarm.has(MEMORY_ALARM));
  await worker.settings({ learningEnabled: false });
  assert.equal(pendingEvidence(await worker.get()).length, 0); assert.equal(h.alarm.size, 0);
});

test("an automatic update waits for workday end and pauses during interactive work or a timer", async () => {
  const h = harness(), worker = h.make(); await enable(h, worker);
  await worker.update(false); assert.equal(h.calls.length, 0);
  h.setDate("2026-09-10T22:00:00Z"); h.busy(true);
  await worker.update(false); assert.equal(h.calls.length, 0);
  h.busy(false); h.values.get(STATE_KEY).focus.status = "running";
  await worker.update(false); assert.equal(h.calls.length, 0);
  h.values.get(STATE_KEY).focus.status = "idle";
  await worker.update(false); assert.equal(h.calls.length, 1);
  await worker.note("New evidence later.", "general"); await worker.update(false);
  assert.equal(h.calls.length, 1);
});

test("manual refresh reserves budget durably, updates memory, and leaves app state untouched", async () => {
  const h = harness(), worker = h.make(); await enable(h, worker);
  const original = structuredClone(h.values.get(STATE_KEY));
  h.respond(request => {
    assert.equal(h.values.get(LEARNED_MEMORY_KEY).usage.calls, 1);
    assert.ok(h.values.get(LEARNED_MEMORY_KEY).job);
    return changeFrom(request);
  });
  const result = await worker.update(true);
  assert.equal(result.outcome, "updated"); assert.equal(result.store.memories[0].status, "tentative");
  assert.equal(pendingEvidence(result.store).length, 0); assert.equal(result.store.job, null);
  assert.deepEqual(h.values.get(STATE_KEY), original);
  await worker.update(true); assert.equal(h.calls.length, 1);
});

test("manual refreshes and failed attempts share a three-request daily cap", async () => {
  const h = harness(), worker = h.make(); await enable(h, worker);
  for (let index = 0; index < 3; index++) {
    if (index) await worker.note("Another observation " + index, "general");
    await worker.update(true);
  }
  await worker.note("Over budget.", "general"); await worker.update(true);
  assert.equal(h.calls.length, 3); assert.equal((await worker.get()).status, "budget");
  h.setDate("2026-09-11T22:00:00Z"); await worker.update(false);
  assert.equal(h.calls.length, 4);
});

test("failure retains evidence, redacts secrets, backs off, and survives reload", async () => {
  const h = harness(); let worker = h.make(); await enable(h, worker);
  h.respond(() => { throw new Error("Cannot use fake-worker-credential"); });
  assert.equal((await worker.update(true)).outcome, "failed");
  let store = await worker.get();
  assert.equal(store.usage.calls, 1); assert.equal(pendingEvidence(store).length, 1);
  assert.doesNotMatch(store.lastError, /fake-worker-credential/);
  worker = h.make(); await worker.initialize(); await worker.update(true);
  assert.equal(h.calls.length, 1);
  h.setDate("2026-09-10T10:16:00Z"); h.respond({ changes: [] });
  await worker.update(true); assert.equal(h.calls.length, 2);
});

test("storage failure before reservation prevents a network call and later recovery succeeds", async () => {
  const h = harness(), worker = h.make(); await enable(h, worker);
  h.failStorage(true); await assert.rejects(worker.update(true), /Storage unavailable/);
  assert.equal(h.calls.length, 0);
  h.failStorage(false); await worker.update(true);
  assert.equal(h.calls.length, 1);
});

test("missing credentials and empty queues make no API calls", async () => {
  const h = harness(), worker = h.make();
  await worker.settings({ learningEnabled: true }); await worker.update(true); assert.equal(h.calls.length, 0);
  await worker.note("New evidence.", "general"); h.key("");
  await worker.update(true); assert.equal(h.calls.length, 0);
  assert.match((await worker.get()).lastError, /Connect Gemini/);
});

test("concurrent refreshes coalesce, while new evidence stays queued after the batch", async () => {
  const h = harness(), worker = h.make(); await enable(h, worker);
  const gate = deferred(), entered = deferred();
  h.respond(async request => { entered.resolve(); await gate.promise; return changeFrom(request); });
  const first = worker.update(true); await entered.promise;
  assert.equal((await worker.update(true)).outcome, "running");
  await worker.note("Arrived during the request.", "general");
  gate.resolve(); await first;
  assert.equal(h.calls.length, 1); assert.equal(pendingEvidence(await worker.get()).length, 1);
});

test("editing, pausing, clearing, or restoring during a request discards its stale result", async () => {
  for (const mutation of ["edit", "pause", "clear", "restore"]) {
    const h = harness(), worker = h.make(); await enable(h, worker);
    const gate = deferred(), entered = deferred();
    h.respond(async request => { entered.resolve(); await gate.promise; return changeFrom(request); });
    const running = worker.update(true); await entered.promise;
    if (mutation === "edit") await worker.save({ text: "User correction wins.", scope: "general" });
    if (mutation === "pause") await worker.settings({ learningEnabled: false });
    if (mutation === "clear") await worker.clear();
    if (mutation === "restore") await worker.restore({});
    gate.resolve(); await running;
    assert.equal((await worker.get()).memories.some(item => item.text === "May prefer flexible reading sessions."), false);
  }
});

test("worker restart respects an existing lease and recovers an interrupted job once", async () => {
  const h = harness(), worker = h.make(); await enable(h, worker);
  const store = await worker.get();
  store.job = { id: "interrupted", startedAt: "2026-09-10T09:59:50Z", epoch: store.epoch, memoryRevision: store.memoryRevision, throughSequence: 1, evidenceIds: store.evidence.map(item => item.id) };
  store.usage = { day: "2026-09-10", calls: 1, automaticDay: "2026-09-10" };
  h.values.set(LEARNED_MEMORY_KEY, store);
  await worker.initialize(); await worker.update(true); assert.equal(h.calls.length, 0);
  h.setDate("2026-09-10T10:02:00Z"); await worker.initialize(); await worker.update(true);
  assert.equal(h.calls.length, 1); assert.equal((await worker.get()).usage.calls, 2);
});

test("backup restore writes tasks and memory in the same storage operation and preserves quota", async () => {
  const h = harness(), worker = h.make(); await enable(h, worker); await worker.update(true);
  await worker.save({ text: "Current memory.", scope: "general" });
  const current = structuredClone(h.values.get(STATE_KEY)), memory = await worker.get();
  const imported = addTask(createDefaultState(), { title: "Restored task" }).state;
  h.failStorage(true);
  await assert.rejects(worker.restore({ memories: memory.memories }, imported), /Storage unavailable/);
  assert.deepEqual(h.values.get(STATE_KEY), current); assert.deepEqual(await worker.get(), memory);
  h.failStorage(false); await worker.restore({ memories: memory.memories }, imported);
  assert.ok(h.writes.at(-1)[STATE_KEY]); assert.ok(h.writes.at(-1)[LEARNED_MEMORY_KEY]);
  assert.equal((await worker.get()).settings.learningEnabled, false);
  assert.equal((await worker.get()).usage.calls, 1);
});

test("context explanation cannot substitute a newer edited memory for what was sent", async () => {
  const h = harness(), worker = h.make();
  await worker.settings({ useWithGemini: true });
  let store = await worker.save({ text: "Original guidance.", scope: "general" });
  const selected = selectMemories(store, "advice");
  await worker.save({ ...store.memories[0], text: "Corrected guidance." });
  await worker.recordContext("advice", selected);
  assert.equal((await worker.get()).lastContext, null);
  store = await worker.get(); await worker.recordContext("advice", selectMemories(store, "advice"));
  assert.deepEqual((await worker.get()).lastContext.memoryIds, [store.memories[0].id]);
  await worker.recordContext("advice", []);
  assert.deepEqual((await worker.get()).lastContext.memoryIds, []);
});

test("empty learning queue schedules the next workday instead of polling every minute", async () => {
  const h = harness(), worker = h.make(); h.setDate("2026-09-10T22:00:00Z");
  await worker.settings({ learningEnabled: true });
  assert.equal(new Date(h.alarm.get(MEMORY_ALARM).when).toISOString(), "2026-09-11T21:30:00.000Z");
});

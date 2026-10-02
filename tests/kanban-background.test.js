import test from "node:test";
import assert from "node:assert/strict";
import { addTask, createDefaultState, STATE_KEY } from "../src/core/state.js";
import { applyKanbanAction, kanbanItem } from "../src/core/kanban.js";
import { toggleTodayTask } from "../src/core/time-management.js";

async function worker(initial) {
  const local = new Map([[STATE_KEY, structuredClone(initial)]]), session = new Map(), writes = [];
  let onMessage, failWrites = false, calls = 0;
  const originalFetch = globalThis.fetch;
  const area = map => ({
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => map.has(key)).map(key => [key, structuredClone(map.get(key))])); },
    async set(values) {
      if (map === local && failWrites) throw new Error("Storage unavailable.");
      for (const [key, value] of Object.entries(values)) map.set(key, structuredClone(value));
      if (values[STATE_KEY]) writes.push(structuredClone(values[STATE_KEY]));
    },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) map.delete(key); }
  });
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
    runtime: { id: "test-extension", onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener(fn) { onMessage = fn; } } },
    storage: { local: area(local), session: area(session) },
    alarms: { onAlarm: { addListener() {} }, async clear() {}, async create() {} },
    sidePanel: { async setPanelBehavior() {} }, action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} }
  } });
  globalThis.fetch = async () => { calls++; throw new Error("No network allowed."); };
  await import(`../src/background.js?kanban=${Date.now()}-${Math.random()}`);
  const request = (message, sender = { id: "test-extension" }) => new Promise(resolve => onMessage(message, sender, resolve));
  assert.equal((await request({ type: "timer:action", action: "reconcile" })).ok, true);
  return {
    request, writes, state: () => structuredClone(local.get(STATE_KEY)), networkCalls: () => calls,
    fail(value) { failWrites = value; },
    cleanup() { delete globalThis.chrome; globalThis.fetch = originalFetch; }
  };
}

function sample() {
  let state = createDefaultState();
  state = addTask(state, { id: "t0", title: "First task" }).state;
  return addTask(state, { id: "t1", title: "Second task" }).state;
}
const action = (name, options) => ({ type: "kanban:action", action: name, options });

test("Kanban messages reject content-script and foreign senders without changes", async () => {
  const w = await worker(sample());
  try {
    const before = w.state();
    for (const sender of [{ id: "other-extension" }, { id: "test-extension", tab: { id: 1 } }]) {
      const result = await w.request(action("enable"), sender);
      assert.equal(result.ok, false);
      assert.match(result.error, /panel/);
    }
    assert.deepEqual(w.state(), before);
    assert.equal(w.networkCalls(), 0);
  } finally { w.cleanup(); }
});

test("timer and automatic Kanban start persist together; stale forms cannot revert them or opt-out", async () => {
  const initial = applyKanbanAction(toggleTodayTask(sample(), "t0"), "enable");
  const w = await worker(initial);
  try {
    const stale = w.state();
    const start = await w.request({ type: "timer:action", action: "start", options: { taskId: "t0", durationMinutes: 25 } });
    assert.equal(start.ok, true);
    assert.equal(kanbanItem(start.data, "t0").stage, "doing");
    assert.equal(start.data.kanban.changes.at(-1).evidence.sessionId, start.data.focus.activeSessionId);
    for (const write of w.writes.filter(state => state.focus.status === "running")) assert.equal(kanbanItem(write, "t0").stage, "doing");
    stale.preferences.theme = "paper";
    const save = await w.request({ type: "app:save", state: stale });
    assert.equal(save.ok, true);
    assert.equal(save.data.preferences.theme, "paper");
    assert.deepEqual(save.data.kanban, start.data.kanban);
    assert.deepEqual(save.data.focus, start.data.focus);
    await w.request(action("block", { taskId: "t0", reason: "Waiting for review" }));
    await w.request(action("settings", { patch: { autoReady: false, wipLimit: 1 } }));
    await w.request(action("disable"));
    const current = w.state();
    await w.request({ type: "app:save", state: stale });
    assert.deepEqual(w.state().kanban, current.kanban);
    assert.equal(w.networkCalls(), 0);
  } finally { w.cleanup(); }
});

test("concurrent Kanban edits check latest revision and duplicate Undo cannot reapply", async () => {
  const initial = applyKanbanAction(sample(), "enable");
  const w = await worker(initial);
  try {
    const results = await Promise.all([
      w.request(action("move", { taskId: "t0", stage: "ready", expectedRevision: 0 })),
      w.request(action("move", { taskId: "t0", stage: "doing", expectedRevision: 0 }))
    ]);
    assert.deepEqual(results.map(result => result.ok), [true, false]);
    assert.match(results[1].error, /changed/);
    assert.equal(kanbanItem(w.state(), "t0").stage, "ready");
    assert.equal(kanbanItem(w.state(), "t0").manualHold, true);
    await w.request({ type: "timer:action", action: "start", options: { taskId: "t1" } });
    const changeId = w.state().kanban.changes.at(-1).id;
    const undone = await Promise.all([w.request(action("undo", { changeId })), w.request(action("undo", { changeId }))]);
    assert.deepEqual(undone.map(result => result.ok), [true, false]);
    assert.equal(kanbanItem(w.state(), "t1").stage, "backlog");
    assert.equal(kanbanItem(w.state(), "t1").manualHold, true);
    assert.equal(w.state().focus.status, "running");
    const stale = structuredClone(initial);
    await w.request({ type: "app:save", state: stale });
    assert.equal(kanbanItem(w.state(), "t1").manualHold, true);
    assert.equal(w.state().kanban.changes.filter(change => change.undoneAt).length, 1);
  } finally { w.cleanup(); }
});

test("storage failure keeps timer and Kanban unchanged; serialized queue recovers without duplicates", async () => {
  const w = await worker(applyKanbanAction(sample(), "enable"));
  try {
    const before = w.state();
    w.fail(true);
    const failed = await w.request({ type: "timer:action", action: "start", options: { taskId: "t0" } });
    assert.equal(failed.ok, false);
    assert.match(failed.error, /Storage unavailable/);
    assert.deepEqual(w.state(), before);
    w.fail(false);
    assert.equal((await w.request({ type: "timer:action", action: "start", options: { taskId: "t0" } })).ok, true);
    await Promise.all(Array.from({ length: 5 }, () => w.request({ type: "timer:action", action: "reconcile" })));
    assert.equal(w.state().kanban.changes.length, 1);
    assert.equal(w.state().focus.status, "running");
    w.fail(true);
    assert.equal((await w.request(action("disable"))).ok, false);
    assert.equal(w.state().kanban.enabled, true);
    w.fail(false);
    assert.equal((await w.request(action("disable"))).ok, true);
    assert.equal(w.state().kanban.enabled, false);
    assert.equal(w.networkCalls(), 0);
  } finally { w.cleanup(); }
});

test("worker reopening syncs today's explicit picks only once and disabled boards stay unchanged", async () => {
  const initial = toggleTodayTask(applyKanbanAction(sample(), "enable"), "t0");
  let w = await worker(initial);
  try {
    assert.equal(kanbanItem(w.state(), "t0").stage, "ready");
    assert.equal(w.state().kanban.changes.length, 1);
    const saved = w.state(); w.cleanup(); w = await worker(saved);
    assert.equal(w.state().kanban.changes.length, 1);
    await w.request(action("disable"));
    const off = toggleTodayTask(w.state(), "t1"), board = off.kanban;
    w.cleanup(); w = await worker(off);
    assert.deepEqual(w.state().kanban, board);
    assert.equal(kanbanItem(w.state(), "t1").stage, "backlog");
  } finally { w.cleanup(); }
});

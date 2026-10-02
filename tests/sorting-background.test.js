import test from "node:test";
import assert from "node:assert/strict";
import { addTask, createDefaultState, STATE_KEY } from "../src/core/state.js";
import { moveToQuadrant } from "../src/core/time-management.js";

async function boot() {
  let initial = createDefaultState(); initial.preferences.autoSort = true; initial.preferences.language = "vi";
  initial = addTask(initial, { title: "Final project", notes: "Required for graduation", dueAt: "2027-01-01T12:00:00Z" }).state;
  const local = new Map([[STATE_KEY, initial]]), session = new Map([["studioGeminiSessionKey", "fake-sorting-test-key-12345"]]);
  const original = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  let listener, gate, started, corrupt = false; const calls = [];
  const area = map => ({ async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(map.get(key))])); }, async set(values) { for (const [key, value] of Object.entries(values)) map.set(key, structuredClone(value)); }, async remove(key) { map.delete(key); } });
  globalThis.chrome = {
    runtime: { id: "test", onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
    storage: { local: area(local), session: area(session) }, alarms: { onAlarm: { addListener() {} }, async clear() {}, async create() {} }, sidePanel: { async setPanelBehavior() {} }
  };
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body); calls.push(request); started?.(); if (gate) await gate;
    const context = request.response_format.schema.properties.decisions ? JSON.parse(request.input.split("\n").at(-1)) : {};
    const result = request.response_format.schema.properties.decisions
      ? { decisions: context.tasks.map(task => ({ id: corrupt ? "forged-id" : task.id, importance: "important", urgency: "urgent", confidence: "high", reason: "Mục tiêu tốt nghiệp." })) }
      : { headline: "A week", narrative: "Recorded time.", wins: [], gentle_experiment: "Keep a short plan." };
    return { ok: true, status: 200, async json() { return { output_text: JSON.stringify(result) }; } };
  };
  await import(`../src/background.js?sorting=${Math.random()}`);
  return {
    calls, initial, local, state: () => structuredClone(local.get(STATE_KEY)),
    send: request => new Promise(resolve => listener(request, { id: "test" }, resolve)),
    corrupt: () => { corrupt = true; },
    hold() { let release; gate = new Promise(resolve => { release = resolve; }); return { release, started: new Promise(resolve => { started = resolve; }) }; },
    close() { Object.assign(globalThis, original); }
  };
}

test("sorting calls use a bounded contract, persist once, and never count as interactive AI usage", async () => {
  const app = await boot();
  try {
    const responses = await Promise.all([app.send({ type: "sorting:run" }), app.send({ type: "sorting:run" })]);
    assert.ok(responses.every(result => result.ok));
    assert.equal(app.calls.length, 1);
    assert.match(app.calls[0].input, /Vietnamese/);
    assert.equal(app.calls[0].response_format.schema.properties.decisions.maxItems, 10);
    assert.equal(app.state().tasks[0].important, true);
    assert.equal(app.state().tasks[0].urgency, "auto");
    assert.deepEqual(app.state().aiUsage.days, []);
    await app.send({ type: "sorting:run" }); assert.equal(app.calls.length, 1);
    const stale = structuredClone(app.initial); stale.preferences.theme = "paper";
    await app.send({ type: "app:save", state: stale });
    assert.equal(app.state().tasks[0].important, true);
    assert.equal(app.state().preferences.theme, "paper");
  } finally { app.close(); }
});

test("manual sorting and disabling the toggle win against an in-flight cloud result", async () => {
  const app = await boot();
  try {
    const hold = app.hold(); const pending = app.send({ type: "sorting:run" }); await hold.started;
    let next = moveToQuadrant(app.state(), app.state().tasks[0].id, "defer"); next.preferences.autoSort = false;
    await app.send({ type: "app:save", state: next }); hold.release(); await pending;
    assert.equal(app.state().tasks[0].important, false);
    assert.equal(app.state().tasks[0].sortSource, "manual");
    assert.equal(app.state().preferences.autoSort, false);
  } finally { app.close(); }
});

test("invalid AI output changes no tasks and is not retried automatically", async () => {
  const app = await boot();
  try {
    app.corrupt(); const result = await app.send({ type: "sorting:run" });
    assert.match(result.data.error, /Invalid sorting response/);
    assert.equal(app.state().tasks[0].important, null);
    await app.send({ type: "sorting:run" }); assert.equal(app.calls.length, 1);
  } finally { app.close(); }
});

test("interactive AI calls increment the daily counter and stale form saves cannot erase it", async () => {
  const app = await boot();
  try {
    const before = app.state();
    const result = await app.send({ type: "gemini:run", action: "reflect", payload: { metrics: {} } });
    assert.equal(result.ok, true);
    assert.equal(app.state().aiUsage.days[0].count, 1);
    await app.send({ type: "app:save", state: before });
    assert.equal(app.state().aiUsage.days[0].count, 1);
  } finally { app.close(); }
});

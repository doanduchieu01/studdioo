import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultState, STATE_KEY } from "../src/core/state.js";
import { startFocus } from "../src/core/timer.js";

function area(map) {
  return {
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => map.has(key)).map(key => [key, structuredClone(map.get(key))])); },
    async set(values) { for (const [key, value] of Object.entries(values)) map.set(key, structuredClone(value)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) map.delete(key); }
  };
}

test("background serializes alarm/UI reconciliation and preserves timer history during stale form saves", async () => {
  const start = new Date(Date.now() - 120000);
  const initial = startFocus(createDefaultState(start), { mode: "pomodoro", durationMinutes: 1, cycles: 2 }, start);
  const local = new Map([[STATE_KEY, initial]]), session = new Map(), alarms = new Map();
  let onMessage, badge;
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
    runtime: { id: "test-extension", onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener(fn) { onMessage = fn; } } },
    storage: { local: area(local), session: area(session) },
    alarms: { onAlarm: { addListener() {} }, async clear(name) { alarms.delete(name); }, async create(name, spec) { alarms.set(name, spec); } },
    sidePanel: { async setPanelBehavior() {} }, action: { async setBadgeText({ text }) { badge = text; }, async setBadgeBackgroundColor() {} }
  } });
  const request = message => new Promise(resolve => onMessage(message, { id: "test-extension" }, resolve));
  try {
    await import(`../src/background.js?timers=${Date.now()}`);
    const results = await Promise.all(Array.from({ length: 8 }, () => request({ type: "timer:action", action: "reconcile" })));
    assert.ok(results.every(result => result.ok));
    assert.equal(local.get(STATE_KEY).sessions.length, 1);
    assert.equal(local.get(STATE_KEY).focus.status, "ready");
    assert.equal(badge, "REST");
    const staleForm = structuredClone(initial);
    staleForm.preferences.theme = "paper";
    const saved = await request({ type: "app:save", state: staleForm });
    assert.equal(saved.ok, true);
    assert.equal(saved.data.preferences.theme, "paper");
    assert.equal(saved.data.sessions.length, 1);
    assert.equal(saved.data.focus.status, "ready");
    assert.ok(saved.data.events.some(event => event.type === "focus_completed"));
    const nexts = await Promise.all([request({ type: "timer:action", action: "next" }), request({ type: "timer:action", action: "next" })]);
    assert.equal(nexts[0].data.focus.endsAt, nexts[1].data.focus.endsAt);
    assert.equal(local.get(STATE_KEY).focus.phase, "break");
    assert.ok(alarms.has("studio-focus-alarm"));
    await request({ type: "timer:action", action: "pause" });
    assert.equal(alarms.has("studio-focus-alarm"), false);
    await request({ type: "timer:action", action: "resume" });
    assert.equal(alarms.has("studio-focus-alarm"), true);
    await request({ type: "timer:action", action: "stop" });
    assert.equal(local.get(STATE_KEY).sessions.length, 1);
  } finally { delete globalThis.chrome; }
});

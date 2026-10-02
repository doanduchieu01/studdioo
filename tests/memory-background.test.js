import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultState, STATE_KEY, updateMemory } from "../src/core/state.js";

async function bootBackground() {
  const state = createDefaultState(new Date("2026-09-07T08:00:00Z"));
  state.feedback = [{ id: "private", text: "unrelated-private-feedback", createdAt: state.createdAt }];
  const local = new Map([[STATE_KEY, state]]);
  const session = new Map([["studioGeminiSessionKey", "fake-test-only-credential-12345"]]);
  const calls = [];
  let onMessage;
  let failNext = false;
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  const area = map => ({
    async get(keys) { return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => map.has(key)).map(key => [key, map.get(key)]))); },
    async set(values) { for (const [key, value] of Object.entries(values)) map.set(key, structuredClone(value)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) map.delete(key); }
  });
  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener() {} }, onStartup: { addListener() {} },
      onMessage: { addListener(listener) { onMessage = listener; } }
    },
    storage: { local: area(local), session: area(session) },
    alarms: { onAlarm: { addListener() {} }, async clear() { return true; }, async create() {} },
    sidePanel: { async setPanelBehavior() {} }
  };
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body, headers: options.headers });
    if (failNext) {
      failNext = false;
      return { ok: false, status: 503, async json() { return { error: { message: "untrusted-provider-body" } }; } };
    }
    const fields = body.response_format.schema.properties;
    const output = fields.ok ? { ok: true, message: "Ready" }
      : fields.duration_minutes ? { title: "Read", notes: "", duration_minutes: 25, due_at: "", energy: "medium", priority: "normal", confidence: 0.8, assumptions: [] }
      : fields.gentle_experiment ? { headline: "A start", narrative: "One session recorded.", wins: [], gentle_experiment: "Try another session." }
      : { headline: "A fit", summary: "One block fits.", reasons: [], tradeoffs: [], suggested_adjustments: [] };
    // Even a model attempting a memory update must not get a write path.
    output.memory = { enabled: true, customInstructions: "model-invented-memory" };
    return { ok: true, status: 200, async json() { return { steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(output) }] }] }; } };
  };
  await import(`../src/background.js?memory=${Date.now()}-${Math.random()}`);
  return {
    local, calls,
    send(request) { return new Promise(resolve => onMessage(request, {}, resolve)); },
    saveMemory(customInstructions, enabled = true) { local.set(STATE_KEY, updateMemory(local.get(STATE_KEY), { enabled, customInstructions })); },
    failNext() { failNext = true; },
    cleanup() { globalThis.fetch = originalFetch; if (originalChrome === undefined) delete globalThis.chrome; else globalThis.chrome = originalChrome; }
  };
}

const requests = [
  { action: "capture", payload: { text: "Read for 25 minutes", nowIso: "2026-09-07T08:00:00Z", timezone: "UTC", defaultDuration: 25 } },
  { action: "explain", payload: { proposal: { blocks: [{ taskId: "t1", startAt: "2026-09-07T09:00:00Z", endAt: "2026-09-07T09:25:00Z" }] }, tasks: [{ id: "t1", title: "Read", notes: "unrelated-task-notes" }], timezone: "UTC" } },
  { action: "reflect", payload: { metrics: { total_focus_minutes: 25, completed_sessions: 1 } } }
];

test("all three assistance actions send enabled saved instructions without unrelated data or task/memory writes", async () => {
  const background = await bootBackground();
  try {
    const instructions = "Prefer brief responses.\n" + "Explain one next step at a time.\n".repeat(200) + "Final preference.";
    assert.ok(instructions.length > 2000);
    background.saveMemory(instructions);
    const before = structuredClone(background.local.get(STATE_KEY));
    for (const request of requests) {
      const result = await background.send({ type: "gemini:run", ...request });
      assert.equal(result.ok, true);
      assert.equal("memory" in result.data, false);
      const call = background.calls.at(-1);
      assert.equal(call.url, "https://generativelanguage.googleapis.com/v1beta/interactions");
      assert.deepEqual(JSON.parse(call.body.system_instruction.split("\n").at(-1)), { custom_instructions: instructions });
      assert.equal(call.body.store, false);
      assert.equal(call.body.response_format.mime_type, "application/json");
      const serialized = JSON.stringify(call.body);
      for (const excluded of ["unrelated-private-feedback", "unrelated-task-notes", "fake-test-only-credential", "model-invented-memory"]) assert.equal(serialized.includes(excluded), false);
      assert.deepEqual({ ...background.local.get(STATE_KEY), aiUsage: null }, { ...before, aiUsage: null });
    }
    assert.equal(background.calls.length, 3);
  } finally { background.cleanup(); }
});

test("connection tests omit saved instructions, including Connect & test", async () => {
  const background = await bootBackground();
  try {
    background.saveMemory("Do not include in connection tests.");
    for (const request of [{ type: "gemini:run", action: "test" }, { type: "gemini:connect", apiKey: "fake-connect-test-123456789", remember: false }]) {
      assert.equal((await background.send(request)).ok, true);
      assert.equal("system_instruction" in background.calls.at(-1).body, false);
      assert.equal(JSON.stringify(background.calls.at(-1).body).includes("Do not include"), false);
    }
  } finally { background.cleanup(); }
});

test("requests read the latest saved memory and ignore caller-supplied unsaved instructions", async () => {
  const background = await bootBackground();
  try {
    const request = { type: "gemini:run", action: "capture", payload: { text: "Read", memory: { enabled: true, customInstructions: "unsaved-forged-text" }, customInstructions: "unsaved-forged-text" } };
    background.saveMemory("First saved preference.");
    await background.send(request);
    assert.match(background.calls.at(-1).body.system_instruction, /First saved preference/);
    background.saveMemory("Latest saved preference.");
    await background.send(request);
    assert.match(background.calls.at(-1).body.system_instruction, /Latest saved preference/);
    assert.doesNotMatch(background.calls.at(-1).body.system_instruction, /First saved preference|unsaved-forged-text/);
    for (const memory of [{ customInstructions: "Retained but disabled.", enabled: false }, { customInstructions: "", enabled: false }]) {
      background.saveMemory(memory.customInstructions, memory.enabled);
      for (const action of requests) {
        await background.send({ type: "gemini:run", ...action });
        assert.equal("system_instruction" in background.calls.at(-1).body, false);
        assert.equal(JSON.stringify(background.calls.at(-1).body).includes("Retained but disabled"), false);
      }
    }
  } finally { background.cleanup(); }
});

test("local memory saves, status checks, and timer sync make no API call", async () => {
  const background = await bootBackground();
  try {
    background.saveMemory("Local only until an explicit assistance action.");
    assert.equal((await background.send({ type: "gemini:status" })).ok, true);
    assert.equal((await background.send({ type: "timer:sync" })).ok, true);
    assert.equal((await background.send({ type: "timer:clear" })).ok, true);
    assert.equal(background.calls.length, 0);
    assert.equal(background.local.get(STATE_KEY).memory.customInstructions, "Local only until an explicit assistance action.");
  } finally { background.cleanup(); }
});

test("provider failure neither overwrites memory nor exposes the provider body", async () => {
  const background = await bootBackground();
  try {
    background.saveMemory("Keep this saved preference.");
    const before = structuredClone(background.local.get(STATE_KEY));
    background.failNext();
    const response = await background.send({ type: "gemini:run", ...requests[0] });
    assert.equal(response.ok, false);
    assert.doesNotMatch(response.error, /untrusted-provider-body|Keep this saved preference/);
    assert.deepEqual({ ...background.local.get(STATE_KEY), aiUsage: null }, { ...before, aiUsage: null });
    assert.equal(background.calls.length, 1);
  } finally { background.cleanup(); }
});

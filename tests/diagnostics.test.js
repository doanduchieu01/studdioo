import test from "node:test";
import assert from "node:assert/strict";
import { appendDiagnostic, createDiagnosticReport, diagnosticRequestText, DIAGNOSTICS_KEY, DIAGNOSTICS_SETTINGS_KEY, httpFailureDetails, MAX_DIAGNOSTIC_ERROR_LENGTH, MAX_DIAGNOSTIC_RECORDS, MAX_DIAGNOSTIC_PROMPT_LENGTH } from "../src/core/diagnostics.js";
import { createBackup, createDefaultState, STATE_KEY, updateMemory } from "../src/core/state.js";

const privateText = "PRIVATE-INSTRUCTIONS-DO-NOT-EXPORT";
const privatePrompt = "PRIVATE-PROMPT-DO-NOT-EXPORT";
const credential = "fake-diagnostics-credential-12345";
const singleDraft = { title: "PRIVATE-MODEL-OUTPUT", notes: "", duration_minutes: 25, due_at: "", energy: "medium", priority: "normal", confidence: 0.8, assumptions: [] };
const multiDraft = () => ({ rationale: "PRIVATE-MODEL-RATIONALE", tasks: [{ ...singleDraft, focus_blocks: [{ label: "PRIVATE-BLOCK", duration_minutes: 25, start_at: "" }] }] });
const output = value => ({ status: 200, body: { status: "completed", output_text: JSON.stringify(value) } });

async function boot() {
  const state = updateMemory(createDefaultState(), { enabled: true, customInstructions: privateText });
  state.profile.experience = "beginner";
  const local = new Map([[STATE_KEY, state]]);
  const session = new Map([["studioGeminiSessionKey", credential]]);
  const original = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  let onMessage;
  let nextResponse = output(multiDraft());
  let rejectDebugWrites = false;
  let calls = 0;
  const area = map => ({
    async get(keys) { return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => map.has(key)).map(key => [key, map.get(key)]))); },
    async set(values) {
      if (rejectDebugWrites && DIAGNOSTICS_KEY in values) throw new Error("Debug storage unavailable.");
      for (const [key, value] of Object.entries(values)) map.set(key, structuredClone(value));
    },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) map.delete(key); }
  });
  globalThis.chrome = {
    runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener(listener) { onMessage = listener; } } },
    storage: { local: area(local), session: area(session) },
    alarms: { onAlarm: { addListener() {} }, async clear() { return true; }, async create() {} },
    sidePanel: { async setPanelBehavior() {} }
  };
  globalThis.fetch = async () => {
    calls += 1;
    const result = nextResponse;
    result.started?.();
    if (result.gate) await result.gate;
    if (result.throw) throw result.throw;
    return { ok: result.status >= 200 && result.status < 300, status: result.status, async json() { if (result.unreadable) throw new Error("PRIVATE-RESPONSE-BODY"); return structuredClone(result.body); } };
  };
  async function reload() { await import(`../src/background.js?diagnostics=${Date.now()}-${Math.random()}`); }
  await reload();
  const send = request => new Promise(resolve => onMessage(request, {}, resolve));
  return {
    local, session, reload, send,
    calls: () => calls,
    respond: response => { nextResponse = response; },
    rejectDebugWrites: value => { rejectDebugWrites = value; },
    run: (text = privatePrompt) => send({ type: "gemini:run", action: "capture", payload: { text, timezone: "Asia/Ho_Chi_Minh" } }),
    toggleText: includeText => send({ type: "gemini:diagnostics-text", includeText }),
    async report() { const result = await send({ type: "gemini:diagnostics" }); assert.equal(result.ok, true); return result.data; },
    cleanup() { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
  };
}

test("reports distinguish rejected multiple-block requests from successful single-task requests without content", async () => {
  const app = await boot();
  try {
    const before = structuredClone(app.local.get(STATE_KEY));
    app.respond({ status: 400, body: { error: { status: "INVALID_ARGUMENT", message: `Too many states for serving schema. ${credential} ${privateText} ${privatePrompt}`, details: [{ fieldViolations: [{ field: "response_format.schema.properties.tasks.maxItems", description: privateText }] }] } } });
    const rejected = await app.run();
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /rejected/);
    assert.deepEqual({ ...app.local.get(STATE_KEY), aiUsage: null }, { ...before, aiUsage: null });
    app.local.get(STATE_KEY).preferences.allowMultipleFocusBlocks = false;
    app.respond(output(singleDraft));
    assert.equal((await app.run()).ok, true);
    const report = await app.report();
    assert.equal(report.reportType, "studio-gemini-debug");
    assert.deepEqual(report.records.map(record => [record.mode, record.phase, record.code, record.httpStatus]), [
      ["multiple-blocks", "response", "schema_complexity", 400], ["single-task", "complete", "ok", 200]
    ]);
    assert.equal(report.records[0].providerStatus, "INVALID_ARGUMENT");
    assert.equal(report.records[0].schemaVariant, "multiple-flat-v2");
    assert.ok(report.records[0].affectedFields.includes("maxItems"));
    assert.equal(report.records[0].promptCharacters, privatePrompt.length);
    assert.equal(report.records[0].memoryCharacters, privateText.length);
    assert.ok(report.records[0].schemaCharacters > report.records[1].schemaCharacters);
    for (const excluded of [credential, privatePrompt, privateText, "PRIVATE-MODEL-OUTPUT", "Too many states for serving"]) {
      assert.equal(JSON.stringify(report).includes(excluded), false);
      assert.equal(JSON.stringify(app.local.get(DIAGNOSTICS_KEY)).includes(excluded), false);
    }
  } finally { app.cleanup(); }
});

test("debug text defaults off and a caller cannot enable it in the Gemini payload", async () => {
  const app = await boot();
  try {
    assert.equal((await app.send({ type: "gemini:diagnostics-settings" })).data.includeText, false);
    assert.equal((await app.send({ type: "gemini:run", action: "capture", payload: { text: privatePrompt, includeText: true } })).ok, true);
    const report = await app.report();
    assert.equal(report.includeTextEnabled, false);
    assert.equal(report.containsRequestText, false);
    assert.equal("requestText" in report.records[0], false);
    assert.equal(JSON.stringify(app.local.get(DIAGNOSTICS_KEY)).includes(privatePrompt), false);
  } finally { app.cleanup(); }
});

test("opted-in reports include the sent prompt, instructions, and specific provider reason with keys redacted", async () => {
  const app = await boot();
  try {
    assert.equal((await app.run()).ok, true);
    assert.equal((await app.toggleText(true)).ok, true);
    const recognizableKey = "AQ" + "." + "q".repeat(40);
    app.local.get(STATE_KEY).memory.customInstructions = `${privateText} ${credential} ${recognizableKey}`;
    app.respond({ status: 400, body: { error: { message: `Invalid schema ${credential} ${recognizableKey} SPECIFIC-PROVIDER-REASON`, details: [{ debug: "PRIVATE-PROVIDER-DETAILS" }] } } });
    await app.run(`${privatePrompt} ${credential} ${recognizableKey}`);
    const report = await app.report();
    assert.equal(report.reportVersion, 4);
    assert.equal(report.includeTextEnabled, true);
    assert.equal(report.containsRequestText, true);
    assert.equal("requestText" in report.records[0], false);
    assert.match(report.records[1].requestText.prompt, /PRIVATE-PROMPT-DO-NOT-EXPORT/);
    assert.match(report.records[1].requestText.customInstructions, /PRIVATE-INSTRUCTIONS-DO-NOT-EXPORT/);
    assert.match(report.records[1].requestText.customInstructions, /REDACTED API KEY/);
    assert.match(report.records[1].requestText.providerErrorMessage, /SPECIFIC-PROVIDER-REASON/);
    assert.match(report.records[1].requestText.providerErrorMessage, /REDACTED API KEY/);
    for (const excluded of [credential, recognizableKey, "PRIVATE-PROVIDER-DETAILS", "PRIVATE-MODEL-OUTPUT"]) {
      assert.equal(JSON.stringify(report).includes(excluded), false);
      assert.equal(JSON.stringify(app.local.get(DIAGNOSTICS_KEY)).includes(excluded), false);
    }
    await app.reload();
    assert.equal((await app.report()).includeTextEnabled, true);
    const backup = createBackup({ ...app.local.get(STATE_KEY), [DIAGNOSTICS_SETTINGS_KEY]: app.local.get(DIAGNOSTICS_SETTINGS_KEY) });
    assert.equal(JSON.stringify(backup).includes(DIAGNOSTICS_SETTINGS_KEY), false);
  } finally { app.cleanup(); }
});

test("HTTP errors normalize flat, nested, array-wrapped, and listed provider reasons", () => {
  const error = { code: "invalid_argument", message: "Too many states for serving schema", details: [{ fieldViolations: [{ field: "response_format.schema.properties.tasks.maxItems" }] }] };
  const cases = [
    [{ error }, "nested"], [error, "flat"], [[{ error }], "array-nested"], [[error], "array-flat"],
    [{ errors: [error] }, "error-list"], [[{ errors: [error] }], "array-error-list"]
  ];
  for (const [body, envelope] of cases) {
    const details = httpFailureDetails(400, body);
    assert.equal(details.code, "schema_complexity");
    assert.equal(details.providerStatus, "INVALID_ARGUMENT");
    assert.equal(details.errorEnvelope, envelope);
    assert.ok(details.affectedFields.includes("maxItems"));
    assert.equal(JSON.stringify(details).includes(error.message), false);
  }
  assert.equal(httpFailureDetails(403, { error: { code: "https://example.invalid/errors/permission_denied" } }).providerStatus, "PERMISSION_DENIED");
  for (const body of [null, "PRIVATE-BODY", [], [{}, {}], { error: "PRIVATE-BODY" }]) {
    const details = httpFailureDetails(400, body);
    assert.equal(details.code, "invalid_request");
    assert.equal(details.providerStatus, null);
    assert.equal(details.errorEnvelope, "unknown");
  }
});

test("a flat array-wrapped HTTP rejection preserves its reason only after opting in", async () => {
  const app = await boot();
  try {
    app.respond({ status: 400, body: [{ code: "invalid_argument", message: `Invalid response_format: schema too complex. ${credential} PRIVATE-PROVIDER-REASON` }] });
    const before = structuredClone(app.local.get(STATE_KEY));
    assert.equal((await app.run()).ok, false);
    assert.equal(JSON.stringify(app.local.get(DIAGNOSTICS_KEY)).includes("PRIVATE-PROVIDER-REASON"), false);
    await app.toggleText(true);
    const rejected = await app.run();
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /response format/);
    assert.doesNotMatch(rejected.error, /PRIVATE-PROVIDER-REASON/);
    const records = (await app.report()).records;
    assert.equal(records[1].errorEnvelope, "array-flat");
    assert.equal(records[1].providerStatus, "INVALID_ARGUMENT");
    assert.match(records[1].requestText.providerErrorMessage, /PRIVATE-PROVIDER-REASON/);
    assert.equal("requestText" in records[0], false);
    assert.equal(JSON.stringify(records).includes(credential), false);
    assert.deepEqual({ ...app.local.get(STATE_KEY), aiUsage: null }, { ...before, aiUsage: null });
    assert.equal(app.calls(), 2);
  } finally { app.cleanup(); }
});

test("debug text contains only instructions actually sent and excludes connection tests", async () => {
  const app = await boot();
  try {
    await app.toggleText(true);
    app.local.get(STATE_KEY).memory.enabled = false;
    assert.equal((await app.run()).ok, true);
    assert.equal((await app.report()).records[0].requestText.customInstructions, "");
    assert.equal(JSON.stringify(await app.report()).includes(privateText), false);
    app.local.get(STATE_KEY).memory.enabled = true;
    app.respond(output({ ok: true, message: "Ready" }));
    assert.equal((await app.send({ type: "gemini:run", action: "test" })).ok, true);
    assert.equal("requestText" in (await app.report()).records[1], false);
    assert.equal((await app.report()).records[1].memoryCharacters, 0);
  } finally { app.cleanup(); }
});

test("turning debug text off purges saved content and re-enabling cannot recover older text", async () => {
  const app = await boot();
  try {
    await app.toggleText(true);
    app.respond({ status: 400, body: { message: "PRIVATE-PROVIDER-REASON" } });
    await app.run();
    assert.equal((await app.report()).containsRequestText, true);
    const calls = app.calls();
    assert.equal((await app.toggleText(false)).ok, true);
    assert.equal((await app.report()).containsRequestText, false);
    assert.equal(JSON.stringify(app.local.get(DIAGNOSTICS_KEY)).includes(privateText), false);
    assert.equal(JSON.stringify(app.local.get(DIAGNOSTICS_KEY)).includes("PRIVATE-PROVIDER-REASON"), false);
    await app.toggleText(true);
    assert.equal((await app.report()).containsRequestText, false);
    assert.equal(app.calls(), calls);
    await app.send({ type: "gemini:diagnostics-clear", resetSettings: true });
    assert.equal((await app.report()).includeTextEnabled, false);
  } finally { app.cleanup(); }
});

test("changing consent or clearing history prevents in-flight requests from restoring debug text", async () => {
  for (const scenario of ["enable-during-request", "off-then-on", "clear-during-request"]) {
    const app = await boot();
    try {
      if (scenario !== "enable-during-request") await app.toggleText(true);
      let started, release;
      const entered = new Promise(resolve => { started = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      app.respond({ status: 400, body: { message: "PRIVATE-PROVIDER-REASON" }, gate, started });
      const pending = app.run();
      await entered;
      if (scenario === "off-then-on") await app.toggleText(false);
      if (scenario === "clear-during-request") await app.send({ type: "gemini:diagnostics-clear" });
      else await app.toggleText(true);
      release();
      assert.equal((await pending).ok, false);
      assert.equal((await app.report()).containsRequestText, false);
      assert.equal(JSON.stringify(app.local.get(DIAGNOSTICS_KEY)).includes(privatePrompt), false);
      assert.equal(JSON.stringify(app.local.get(DIAGNOSTICS_KEY)).includes("PRIVATE-PROVIDER-REASON"), false);
    } finally { app.cleanup(); }
  }
});

test("a failed debug-text setting write preserves the prior setting and can be retried", async () => {
  const app = await boot();
  try {
    await app.toggleText(true);
    await app.run();
    app.rejectDebugWrites(true);
    assert.equal((await app.toggleText(false)).ok, false);
    assert.equal((await app.report()).includeTextEnabled, true);
    app.rejectDebugWrites(false);
    assert.equal((await app.toggleText(false)).ok, true);
    assert.equal((await app.report()).containsRequestText, false);
  } finally { app.cleanup(); }
});

test("optional debug text and provider reason are bounded, marked, and restricted to allowed fields", () => {
  const text = diagnosticRequestText("x".repeat(MAX_DIAGNOSTIC_PROMPT_LENGTH + 1), "y".repeat(10001), [], "z".repeat(MAX_DIAGNOSTIC_ERROR_LENGTH + 1));
  assert.equal(text.prompt.length, MAX_DIAGNOSTIC_PROMPT_LENGTH);
  assert.equal(text.customInstructions.length, 10000);
  assert.equal(text.promptTruncated, true);
  assert.equal(text.customInstructionsTruncated, true);
  assert.equal(text.providerErrorMessage.length, MAX_DIAGNOSTIC_ERROR_LENGTH);
  assert.equal(text.providerErrorMessageTruncated, true);
  const record = { requestText: { ...text, headers: credential, response: privateText } };
  assert.equal(createDiagnosticReport([record]).containsRequestText, false);
  const report = createDiagnosticReport([record], new Date(), { includeText: true });
  assert.equal(report.containsRequestText, true);
  assert.deepEqual(report.records[0].requestText, text);
  assert.equal(JSON.stringify(report).includes(credential), false);
  assert.equal(JSON.stringify(report).includes(privateText), false);
});

test("a successful HTTP response can fail parsing or draft validation with a distinct report code", async () => {
  const app = await boot();
  try {
    const mismatch = multiDraft(); mismatch.tasks[0].duration_minutes = 30;
    const badDate = multiDraft(); badDate.tasks[0].focus_blocks[0].start_at = "2026-09-09T09:00";
    const cases = [
      [output({ rationale: "No explicit work to add.", tasks: [] }), "validation", "empty_tasks"],
      [output(mismatch), "validation", "duration_mismatch"],
      [output(badDate), "validation", "invalid_date"],
      [{ status: 200, body: { output_text: "PRIVATE-MALFORMED-JSON" } }, "parse", "malformed_output"],
      [{ status: 200, body: { status: "failed", steps: [] } }, "response", "empty_output"]
    ];
    const before = structuredClone(app.local.get(STATE_KEY));
    for (const [response, phase, code] of cases) {
      app.respond(response);
      const result = await app.run("what's the plan tomorrow?");
      assert.equal(result.ok, false);
      if (code === "empty_tasks") assert.match(result.error, /capture cannot retrieve your existing plan/);
      const record = (await app.report()).records.at(-1);
      assert.deepEqual([record.httpStatus, record.phase, record.code], [200, phase, code]);
      assert.deepEqual({ ...app.local.get(STATE_KEY), aiUsage: null }, { ...before, aiUsage: null });
    }
    assert.equal(JSON.stringify(await app.report()).includes("PRIVATE-MALFORMED-JSON"), false);
  } finally { app.cleanup(); }
});

test("network, timeout, quota, access, service, and unreadable-response errors remain distinct", async () => {
  const app = await boot();
  try {
    const cases = [
      [{ throw: new Error("PRIVATE-NETWORK-DETAIL") }, "request", "network_error", null],
      [{ throw: Object.assign(new Error("PRIVATE-TIMEOUT"), { name: "AbortError" }) }, "request", "timeout", null],
      [{ status: 403, body: { error: { status: "PERMISSION_DENIED" } } }, "response", "access_error", 403],
      [{ status: 429, body: { error: { status: "RESOURCE_EXHAUSTED" } } }, "response", "quota_error", 429],
      [{ status: 503, body: { error: { status: "UNAVAILABLE" } } }, "response", "provider_error", 503],
      [{ status: 200, unreadable: true }, "response", "invalid_response", 200]
    ];
    for (const [response, phase, code, httpStatus] of cases) {
      app.respond(response);
      assert.equal((await app.run()).ok, false);
      const record = (await app.report()).records.at(-1);
      assert.deepEqual([record.phase, record.code, record.httpStatus], [phase, code, httpStatus]);
    }
  } finally { app.cleanup(); }
});

test("debug writes cannot break a usable draft and storage recovery allows later reports", async () => {
  const app = await boot();
  try {
    app.rejectDebugWrites(true);
    assert.equal((await app.run()).ok, true);
    assert.equal((await app.report()).records.length, 0);
    app.rejectDebugWrites(false);
    assert.equal((await app.run()).ok, true);
    assert.equal((await app.report()).records.length, 1);
  } finally { app.cleanup(); }
});

test("reports survive background reloads, are excluded from backups, and export/clear make no API calls", async () => {
  const app = await boot();
  try {
    assert.equal((await app.run()).ok, true);
    const calls = app.calls();
    const saved = await app.report();
    await app.reload();
    assert.deepEqual((await app.report()).records, saved.records);
    const backup = createBackup({ ...app.local.get(STATE_KEY), [DIAGNOSTICS_KEY]: saved.records });
    assert.equal(JSON.stringify(backup).includes(DIAGNOSTICS_KEY), false);
    assert.equal((await app.send({ type: "gemini:diagnostics-clear" })).ok, true);
    assert.deepEqual((await app.report()).records, []);
    assert.equal(app.calls(), calls);
  } finally { app.cleanup(); }
});

test("concurrent attempts preserve both diagnostic records", async () => {
  const app = await boot();
  try {
    const results = await Promise.all([app.run("One"), app.run("Another")]);
    assert.ok(results.every(result => result.ok));
    assert.deepEqual((await app.report()).records.map(record => record.promptCharacters).sort((a, b) => a - b), [3, 7]);
  } finally { app.cleanup(); }
});

test("retention and export allowlists exclude arbitrary stored fields and untrusted messages", () => {
  const poisoned = { action: "capture", phase: "response", code: "response_format", httpStatus: 400, model: credential, timestamp: privateText, providerStatus: privateText, affectedFields: ["schema", privateText], promptCharacters: -1, memoryCharacters: Infinity, request: privatePrompt, response: privateText, headers: credential, summary: privateText };
  let records = [];
  for (let i = 0; i < 25; i += 1) records = appendDiagnostic(records, { ...poisoned, durationMs: i });
  assert.equal(records.length, MAX_DIAGNOSTIC_RECORDS);
  assert.equal(records[0].durationMs, 5);
  const report = createDiagnosticReport([...records, poisoned]);
  assert.equal(report.records.length, MAX_DIAGNOSTIC_RECORDS);
  assert.deepEqual(report.records.at(-1).affectedFields, ["schema"]);
  assert.equal(report.records.at(-1).promptCharacters, 0);
  assert.equal(report.records.at(-1).memoryCharacters, 0);
  for (const excluded of [credential, privateText, privatePrompt]) assert.equal(JSON.stringify(report).includes(excluded), false);
});

import { isDeepStrictEqual } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createDefaultState, STATE_KEY, updateMemory } from "../src/core/state.js";
import { localDateTimeInput } from "../src/core/utils.js";
import { LEARNED_MEMORY_KEY, normalizeLearnedMemory } from "../src/core/learned-memory.js";
import { FREE_TIER_MODELS } from "../src/core/models.js";
import { TRACKING_KEY, TRACKING_ALARM, TRACKING_PERMISSIONS } from "../src/core/browser-tracking.js";

process.env.TZ = "UTC";

function sampleResponse() {
  const day = new Date(); day.setDate(day.getDate() + 1); day.setHours(9, 0, 0, 0);
  const start = minutes => new Date(day.getTime() + minutes * 60_000).toISOString();
  const common = { notes: "", due_at: "", energy: "medium", priority: "normal", confidence: 0.8, assumptions: ["Tomorrow morning is assumed available."] };
  return { rationale: "Use different block lengths for different steps.", tasks: [
    { ...common, title: "Study", duration_minutes: 60 },
    { ...common, title: "Write", duration_minutes: 30 }
  ], focus_blocks: [
    { task_index: 0, label: "Read", duration_minutes: 20, start_at: start(0) },
    { task_index: 1, label: "Outline", duration_minutes: 30, start_at: start(80) },
    { task_index: 0, label: "Practice", duration_minutes: 40, start_at: start(30) }
  ] };
}

// Model ancestor lookup without pretending to implement browser default actions.
// Cancelable click events below detect when the app would suppress those actions.
function element(tagName, dataset = {}, parentElement = null) {
  return {
    tagName, dataset, parentElement,
    closest(selector) {
      assert.equal(selector, "[data-action]");
      for (let node = this; node; node = node.parentElement) {
        if (node.dataset.action) return node;
      }
      return null;
    }
  };
}

async function boot(options = {}) {
  let state = options.state ?? createDefaultState();
  state.profile = { ...state.profile, onboardingComplete: !options.onboarding, experience: options.experience ?? "beginner" };
  const local = new Map([[STATE_KEY, structuredClone(state)]]);
  const session = new Map(options.connected === false ? [] : [["studioGeminiSessionKey", "fake-capture-test-credential-12345"]]);
  const changes = new Set();
  const listeners = new Map();
  const calls = [];
  const fields = new Map();
  let markup = "";
  let renderWrites = 0;
  const app = { get innerHTML() { return markup; }, set innerHTML(value) { markup = value; renderWrites += 1; }, className: "", querySelector() { return null; } };
  const toast = { innerHTML: "" };
  const downloads = [];
  const downloadBlobs = new Map();
  const originalCreateUrl = URL.createObjectURL;
  const originalRevokeUrl = URL.revokeObjectURL;
  URL.createObjectURL = blob => { const url = `blob:test-${downloadBlobs.size}`; downloadBlobs.set(url, blob); return url; };
  URL.revokeObjectURL = () => {};
  const originals = Object.fromEntries(["chrome", "fetch", "document", "FormData", "setTimeout", "setInterval", "requestAnimationFrame"].map(key => [key, globalThis[key]]));
  let onMessage;
  let writeFailure = false;
  let stateWrites = 0;
  let trackingPermission = false, trackingRequests = 0, permissionRenderWrites = null, trackingQueries = 0, alarmListener;
  const permissionCalls = [], grants = new Set(), registeredScripts = [];
  let privacyDecision = options.grantPrivacy !== false;
  let providerResponse = options.response ?? sampleResponse();
  let providerFailure = 0;
  const area = (map, notify = false) => ({
    async get(keys) { return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => map.has(key)).map(key => [key, map.get(key)]))); },
    async set(values) {
      if (notify && (writeFailure === true || typeof writeFailure === "string" && Object.hasOwn(values,writeFailure))) throw new Error("Storage temporarily unavailable.");
      for (const [key, value] of Object.entries(values)) {
        const oldValue = map.get(key);
        map.set(key, structuredClone(value));
        if (notify) {
          if (key === STATE_KEY && !isDeepStrictEqual({ ...oldValue, aiUsage: null }, { ...value, aiUsage: null })) stateWrites += 1;
          for (const listener of changes) listener({ [key]: { oldValue: structuredClone(oldValue), newValue: structuredClone(value) } }, "local");
        }
      }
    },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) map.delete(key); }
  });
  globalThis.chrome = {
    runtime: {
      id: "studio-test-extension",
      getURL(path) { return `chrome-extension://studio-test-extension/${path}`; },
      onInstalled: { addListener() {} }, onStartup: { addListener() {} },
      onMessage: { addListener(listener) { onMessage = listener; } },
      sendMessage(request) { return new Promise(resolve => onMessage(request, {}, resolve)); }
    },
    storage: { local: area(local, true), session: area(session), onChanged: { addListener(fn) { changes.add(fn); }, removeListener(fn) { changes.delete(fn); } } },
    alarms: { onAlarm: { addListener(listener) { alarmListener = listener; } }, async get() { return null; }, async clear() { return true; }, async create() {} },
    sidePanel: { async setPanelBehavior() {} }
  };
  if (options.tracking || options.privacy) {
    const event = { addListener() {} };
    chrome.permissions = {
      async contains(value) { return options.privacy ? [...(value.permissions ?? []), ...(value.origins ?? [])].every(x => grants.has(x)) : trackingPermission; },
      request(value) {
        permissionCalls.push(structuredClone(value)); permissionRenderWrites = renderWrites;
        if (options.privacy) { if (privacyDecision) for (const x of [...(value.permissions ?? []), ...(value.origins ?? [])]) grants.add(x); return Promise.resolve(privacyDecision); }
        assert.deepEqual(value, TRACKING_PERMISSIONS); trackingRequests++; trackingPermission = options.grantTracking !== false; return Promise.resolve(trackingPermission);
      },
      async remove(value) { for (const origin of value.origins ?? []) grants.delete(origin); return true; },
      onAdded: event, onRemoved: event
    };
    chrome.idle = { async queryState() { return "active"; }, setDetectionInterval() {}, onStateChanged: event };
    chrome.windows = { async getLastFocused() { return { id: 1, focused: true, incognito: false, state: "normal" }; }, onFocusChanged: event };
    chrome.tabs = { async query() { trackingQueries++; return [{ active: true, incognito: false, url: "https://private-tracking-only.example/private?q=SECRET" }]; }, onActivated: event, onUpdated: event, onRemoved: event };
    if (options.privacy) {
      chrome.notifications = { async create() {}, async clear() {}, onClicked: event, onButtonClicked: event };
      chrome.scripting = { async getRegisteredContentScripts() { return registeredScripts; }, async unregisterContentScripts() { registeredScripts.length = 0; }, async registerContentScripts(values) { registeredScripts.push(...values); } };
    }
  }
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body, headers: options.headers });
    if (providerFailure) return { ok: false, status: providerFailure, async json() { return { error: { message: "Model unavailable", status: "NOT_FOUND" } }; } };
    const properties = body.response_format.schema.properties;
    const output = (properties.tasks || properties.changes || properties.questions || properties.suggestions) ? providerResponse
      : body.response_format.schema.properties.ok ? { ok: true, message: "Ready" }
      : { title: "Single draft", notes: "", duration_minutes: 25, due_at: "", energy: "medium", priority: "normal", confidence: 0.8, assumptions: [] };
    return { ok: true, status: 200, async json() { return { output_text: JSON.stringify(output) }; } };
  };
  globalThis.document = {
    documentElement: { dataset: {} }, body: { append() {} },
    querySelector(selector) {
      if (selector === "#app") return app;
      if (selector === "#toast-region") return toast;
      if (!["#capture-", "#model-", "#connected-model-"].some(prefix => selector.startsWith(prefix))) return null;
      if (!fields.has(selector)) fields.set(selector, { innerHTML: "", textContent: "" });
      return fields.get(selector);
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    createElement() { return { click() { downloads.push({ filename: this.download, blob: downloadBlobs.get(this.href) }); }, remove() {} }; }
  };
  globalThis.FormData = class { constructor(form) { this.values = form.values ?? {}; } get(name) { return this.values[name] ?? null; } };
  globalThis.setTimeout = () => 1;
  globalThis.setInterval = () => 1;
  globalThis.requestAnimationFrame = callback => { callback(); return 1; };
  await import(`../src/background.js?capture=${Date.now()}-${Math.random()}`);
  await import(`../src/app.js?capture=${Date.now()}-${Math.random()}`);
  await delay(20);
  return {
    app, toast, calls, fields, listeners, downloads, permissionCalls, registeredScripts,
    privacyDecision(value) { privacyDecision = value; },
    stored(key) { return structuredClone(local.get(key)); },
    renderWrites() { return renderWrites; },
    trackingRequests() { return trackingRequests; },
    permissionRenderWrites() { return permissionRenderWrites; },
    trackingQueries() { return trackingQueries; },
    async alarm(name) { alarmListener({ name }); await delay(20); },
    state() { return structuredClone(local.get(STATE_KEY)); },
    memory() { return normalizeLearnedMemory(local.get(LEARNED_MEMORY_KEY)); },
    send(request) { return new Promise(resolve => onMessage(request, {}, resolve)); },
    failProvider(status) { providerFailure = status; },
    stateWrites() { return stateWrites; },
    rejectWrites(value) { writeFailure = value; },
    respondWith(value) { providerResponse = value; },
    async externalState(next) { await chrome.storage.local.set({ [STATE_KEY]: next }); await delay(20); },
    async click(action, extra = {}) {
      listeners.get("click")({ target: { closest: () => ({ dataset: { action, ...extra } }) }, preventDefault() {} });
      await delay(20);
    },
    async clickElement(target) {
      const event = new Event("click", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "target", { value: target });
      listeners.get("click")(event);
      await delay(20);
      return event;
    },
    async toggle(checked) {
      listeners.get("change")({ target: { id: "capture-multiple", checked, dataset: { captureMultiple: "true" } } });
      await delay(20);
    },
    async change(id, value, extras = {}) {
      listeners.get("change")({ target: { id, value, dataset: {}, ...extras } }); await delay(20);
    },
    input(id, value, dataset = {}) { listeners.get("input")({ target: { id, value, dataset } }); },
    async debugText(checked) {
      listeners.get("change")({ target: { id: "diagnostics-include-text", checked, dataset: {} } });
      await delay(20);
    },
    edit(taskIndex, field, value, blockIndex = null) {
      const input = { value, checked: value, dataset: { captureTask: String(taskIndex), captureField: field, ...(blockIndex === null ? {} : { captureBlock: String(blockIndex) }) } };
      listeners.get(field === "selected" ? "change" : "input")({ target: input });
    },
    async submit(id, values = {}) {
      listeners.get("submit")({ target: { id, values, dataset: {} }, preventDefault() {} });
      await delay(20);
    },
    cleanup() { URL.createObjectURL = originalCreateUrl; URL.revokeObjectURL = originalRevokeUrl; for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
  };
}

test("bulk local onboarding reviews exact sites before requesting permission and leaves AI separate",async()=>{
  const app=await boot({privacy:true,onboarding:true,connected:false});
  try{
    await app.click("onboarding-defaults");
    assert.equal(app.permissionCalls.length,0);
    await app.change("","",{dataset:{privacy:"localAll"},checked:true});
    assert.match(app.app.innerHTML,/local-review-title/);assert.equal(app.permissionCalls.length,0);
    assert.equal(app.stored("studioActivity")?.settings.enabled ?? false,false);
    await app.click("close-modal");assert.equal(app.permissionCalls.length,0);
    await app.change("","",{dataset:{privacy:"localAll"},checked:true});
    const {MEDIA_PRESETS}=await import("../src/core/media-sites.js");
    for(const site of MEDIA_PRESETS.slice(1))await app.change("","",{dataset:{bulkSite:site.origin},checked:false});
    const before=app.renderWrites();await app.click("confirm-local-extras");
    assert.equal(app.permissionRenderWrites(),before,"The permission request retains the original user gesture");
    assert.deepEqual(app.permissionCalls[0],{permissions:["tabs","idle","notifications","scripting"],origins:["https://www.youtube.com/*"]});
    const activity=app.stored("studioActivity");
    assert.equal(activity.settings.enabled,true);assert.equal(activity.settings.details,true);assert.equal(activity.settings.backgroundMedia,true);
    assert.deepEqual(activity.settings.signalOrigins,["https://www.youtube.com"]);
    assert.equal(activity.settings.aiEnabled,false);assert.equal(app.stored("studioAIPolicy").automaticEnabled,false);
    assert.equal(app.state().preferences.autoSort,false);assert.equal(app.state().memory.enabled,false);
    assert.equal(app.calls.length,0);assert.doesNotMatch(app.app.innerHTML,/local-review-title/);
    await app.change("","",{dataset:{privacy:"localAll"},checked:false});
    const paused=app.stored("studioActivity");assert.equal(paused.settings.enabled,false);assert.deepEqual(paused.sessions.map(s=>s.id),activity.sessions.map(s=>s.id));assert.deepEqual(paused.sessions[0]?.segments,activity.sessions[0]?.segments);
    assert.equal(app.stored("studioReminders").settings.enabled,false);
  }finally{app.cleanup();}
});

test("denied bulk permission preserves mixed choices and makes no cloud request",async()=>{
  const app=await boot({privacy:true,grantPrivacy:false,connected:false});
  try{
    await app.click("open-privacy");await app.change("","",{dataset:{privacy:"details"},checked:true});
    const before=app.stored("studioActivity");
    await app.change("","",{dataset:{privacy:"localAll"},checked:true});await app.click("confirm-local-extras");
    assert.deepEqual(app.stored("studioActivity"),before);
    assert.match(app.app.innerHTML,/Custom · 1\/6 enabled/);
    assert.match(app.toast.innerHTML,/Permission was not granted/);
    assert.equal(app.calls.length,0);
  }finally{app.cleanup();}
});

test("a partial bulk write shows saved local settings and never claims complete success",async()=>{
  const app=await boot({privacy:true,connected:false});
  try{
    await app.click("open-privacy");await app.change("","",{dataset:{privacy:"localAll"},checked:true});
    app.rejectWrites("studioReminders");await app.click("confirm-local-extras");
    assert.equal(app.stored("studioActivity").settings.enabled,true);
    assert.equal(app.stored("studioReminders")?.settings.enabled ?? false,false);
    assert.match(app.app.innerHTML,/Custom · 4\/6 enabled/);assert.match(app.toast.innerHTML,/Storage temporarily unavailable/);
    assert.equal(app.calls.length,0);
  }finally{app.cleanup();}
});

test("media catalogue starts inactive; one preset grants only its site and can revoke it",async()=>{
  const app=await boot({privacy:true,connected:false});
  try{
    await app.click("open-privacy");assert.match(app.app.innerHTML,/Common media sites/);
    assert.equal(app.permissionCalls.length,0);assert.equal(app.registeredScripts.length,0);
    await app.click("privacy-add-preset",{origin:"https://open.spotify.com"});
    assert.deepEqual(app.permissionCalls[0],{permissions:["scripting"],origins:["https://open.spotify.com/*"]});
    assert.deepEqual(app.stored("studioActivity").settings.signalOrigins,["https://open.spotify.com"]);
    assert.equal(app.stored("studioActivity").settings.enabled,false);
    await app.click("privacy-revoke-site",{origin:"https://open.spotify.com"});
    assert.deepEqual(app.stored("studioActivity").settings.signalOrigins,[]);
    assert.equal(await chrome.permissions.contains({origins:["https://open.spotify.com/*"]}),false);
    assert.equal(app.calls.length,0);
  }finally{app.cleanup();}
});

test("automatic AI needs its own confirmation; zero allowance still permits manual capture",async()=>{
  const app=await boot({privacy:true});
  try{
    await app.click("go-settings");assert.equal(app.stored("studioAIPolicy").automaticEnabled,false);
    await app.change("ai-mode","automatic");assert.match(app.app.innerHTML,/ai-review-title/);
    assert.equal(app.stored("studioAIPolicy").automaticEnabled,false);
    await app.click("close-modal");assert.equal(app.stored("studioAIPolicy").automaticEnabled,false);
    await app.change("ai-mode","automatic");await app.click("confirm-automatic-ai");
    assert.equal(app.stored("studioAIPolicy").automaticEnabled,true);
    assert.equal(app.state().preferences.autoSort,false);assert.equal(app.memory().settings.learningEnabled,false);
    assert.equal(app.stored("studioActivity")?.settings.aiEnabled ?? false,false);
    await app.submit("ai-budget-form",{dailyLimit:"0"});assert.equal(app.stored("studioAIPolicy").dailyLimit,0);
    await app.submit("omnibar-form",{capture:"Study tomorrow"});assert.equal(app.calls.length,1);
    assert.equal(app.stored("studioAIPolicy").used,0);
    await app.click("close-modal");await app.change("ai-mode","manual");assert.equal(app.stored("studioAIPolicy").automaticEnabled,false);
  }finally{app.cleanup();}
});

test("new AI connections default to 3.5 Flash-Lite and reconnecting does not restore automatic consent",async()=>{
  const app=await boot({privacy:true,connected:false});
  try{
    const blocked=await app.send({type:"ai-policy:settings",patch:{automaticEnabled:true}});assert.equal(blocked.ok,false);
    const connected=await app.send({type:"gemini:connect",apiKey:"fake-test-connection-12345",remember:false});assert.equal(connected.ok,true);
    assert.equal(app.calls[0].body.model,"gemini-3.5-flash-lite");assert.equal(app.stored("studioAIPolicy").automaticEnabled,false);
    await app.send({type:"ai-policy:settings",patch:{automaticEnabled:true}});
    await app.send({type:"gemini:disconnect"});assert.equal(app.stored("studioAIPolicy").automaticEnabled,false);
    await app.send({type:"gemini:connect",apiKey:"fake-test-connection-12345",remember:false});
    assert.equal(app.stored("studioAIPolicy").automaticEnabled,false);
  }finally{app.cleanup();}
});

test("review modal disclosure clicks retain native expand/collapse behavior", async () => {
  const app = await boot();
  try {
    await app.submit("omnibar-form", { capture: "Study and write tomorrow" });
    assert.match(app.app.innerHTML, /<div class="modal-backdrop" data-action="backdrop-close"><section class="modal capture-review"/);
    assert.match(app.app.innerHTML, /<details class="capture-details"><summary>Task details and assumptions<\/summary>/);
    for (const field of ["Notes", "Deadline", "Energy", "Priority"]) assert.ok(app.app.innerHTML.includes(`>${field}</label>`));
    const backdrop = element("DIV", { action: "backdrop-close" });
    const details = element("DETAILS", {}, element("SECTION", {}, backdrop));
    const summary = element("SUMMARY", {}, details);
    const before = app.app.innerHTML;
    for (const target of [summary, element("SPAN", {}, summary)]) {
      assert.equal((await app.clickElement(target)).defaultPrevented, false);
      assert.equal(app.app.innerHTML, before, "Clicking details must leave the draft content unchanged");
    }
    assert.equal(app.stateWrites(), 0);
    assert.equal(app.calls.length, 1);
  } finally { app.cleanup(); }
});

test("review modal controls and checkbox labels retain native click behavior", async () => {
  const app = await boot();
  try {
    await app.submit("omnibar-form", { capture: "Study and write tomorrow" });
    const panel = element("SECTION", {}, element("DIV", { action: "backdrop-close" }));
    const label = element("LABEL", {}, panel);
    for (const target of [element("INPUT", {}, label), label, element("STRONG", {}, label), element("TEXTAREA", {}, panel), element("SELECT", {}, panel), panel]) {
      assert.equal((await app.clickElement(target)).defaultPrevented, false, `${target.tagName} must keep its default click behavior`);
      assert.match(app.app.innerHTML, /id="capture-blocks-form"/);
    }
    // Exercise the change event separately; this harness does not simulate a browser checkbox.
    app.edit(0, "selected", false, 0);
    assert.match(app.app.innerHTML, /Add 2 selected blocks/);
    app.edit(0, "selected", true, 0);
    assert.match(app.app.innerHTML, /Add 3 selected blocks/);
    assert.equal(app.stateWrites(), 0);
    assert.equal(app.calls.length, 1);
  } finally { app.cleanup(); }
});

test("review modal submit buttons remain native and the submit handler saves once", async () => {
  const app = await boot();
  try {
    await app.submit("omnibar-form", { capture: "Study and write tomorrow" });
    const form = element("FORM", {}, element("DIV", { action: "backdrop-close" }));
    assert.equal((await app.clickElement(element("BUTTON", {}, form))).defaultPrevented, false);
    assert.equal(app.stateWrites(), 0, "The click handler must not save the draft itself");
    await app.submit("capture-blocks-form");
    assert.equal(app.stateWrites(), 1);
    assert.equal(app.state().schedule.length, 3);
    assert.equal(app.state().focus.status, "idle");
    assert.equal(app.calls.length, 1);
  } finally { app.cleanup(); }
});

test("review modal explicit close actions and direct backdrop clicks still discard", async () => {
  const app = await boot();
  try {
    const backdrop = element("DIV", { action: "backdrop-close" });
    const button = element("BUTTON", { action: "close-modal" }, backdrop);
    for (const target of [button, element("SVG", {}, button), backdrop]) {
      await app.submit("omnibar-form", { capture: "Study and write tomorrow" });
      assert.equal((await app.clickElement(target)).defaultPrevented, true);
      assert.doesNotMatch(app.app.innerHTML, /id="capture-blocks-form"/);
      assert.equal(app.stateWrites(), 0);
    }
    assert.equal(app.calls.length, 3);
  } finally { app.cleanup(); }
});

test("review modal distinguishes missing assumptions from escaped supplied text", async () => {
  const response = sampleResponse();
  response.tasks[0].assumptions = [];
  response.tasks[1].assumptions = ["Time is <flexible> & not confirmed."];
  const app = await boot({ response });
  try {
    await app.submit("omnibar-form", { capture: "Study and write tomorrow" });
    assert.equal(app.app.innerHTML.split("No assumptions were provided for this task.").length - 1, 1);
    assert.match(app.app.innerHTML, /Time is &lt;flexible&gt; &amp; not confirmed\./);
    assert.doesNotMatch(app.app.innerHTML, /Time is <flexible>/);
    assert.match(app.app.innerHTML, /id="capture-notes-0"/);
    assert.match(app.app.innerHTML, /id="capture-priority-0"/);
  } finally { app.cleanup(); }
});

test("tracking permission denial leaves tracking off without tab reads or Gemini requests", async () => {
  const app = await boot({ tracking: true, grantTracking: false });
  try {
    await app.click("go-settings");
    assert.match(app.app.innerHTML, /Website time today/);
    const renders = app.renderWrites();
    await app.click("tracking-enable");
    assert.equal(app.permissionRenderWrites(), renders, "Request permission before awaiting or re-rendering the click action");
    assert.equal(app.trackingRequests(), 1);
    assert.equal(app.trackingQueries(), 0);
    assert.equal((await app.send({ type: "tracking:get" })).data.enabled, false);
    assert.equal(app.calls.length, 0);
  } finally { app.cleanup(); }
});

test("tracking heartbeat and UI are local, excluded from AI/backups, and clear requires confirmation", async () => {
  const app = await boot({ tracking: true });
  try {
    await app.click("go-settings");
    await app.click("tracking-enable");
    const stored = (await chrome.storage.local.get(TRACKING_KEY))[TRACKING_KEY];
    assert.equal(stored.enabled, true);
    stored.cursor.at -= 30_000;
    await chrome.storage.local.set({ [TRACKING_KEY]: stored });
    await app.alarm(TRACKING_ALARM);
    await app.click("tracking-refresh");
    assert.match(app.app.innerHTML, /private-tracking-only.example/);
    assert.doesNotMatch(app.app.innerHTML, /\?q=SECRET/);
    assert.equal(app.calls.length, 0);
    await app.debugText(true);
    await app.submit("omnibar-form", { capture: "Study and write tomorrow" });
    assert.doesNotMatch(JSON.stringify(app.calls), /private-tracking-only|SECRET/);
    const debug = (await app.send({ type: "gemini:diagnostics" })).data;
    assert.doesNotMatch(JSON.stringify(debug), /private-tracking-only|SECRET/);
    assert.doesNotMatch(JSON.stringify(app.memory()), /private-tracking-only|SECRET/);
    await app.click("close-modal");
    await app.click("export-backup");
    assert.doesNotMatch(await app.downloads.at(-1).blob.text(), /private-tracking-only|studioBrowserTracking/);
    await app.click("tracking-pause");
    await app.click("tracking-ask-clear");
    assert.match(app.app.innerHTML, /Clear website tracking\?/);
    assert.ok((await app.send({ type: "tracking:get" })).data.totalMs >= 30_000);
    await app.click("tracking-clear");
    const result = (await app.send({ type: "tracking:get" })).data;
    assert.equal(result.totalMs, 0); assert.equal(result.enabled, false);
    assert.match(app.toast.innerHTML, /Website totals deleted and tracking paused/);
    assert.equal(app.calls.length, 1);
  } finally { app.cleanup(); }
});

test("Settings exports a usable debug JSON after failure and can clear the history", async () => {
  const app = await boot({ response: { rationale: "No task named.", tasks: [] } });
  try {
    await app.submit("omnibar-form", { capture: "what's the plan tomorrow?" });
    assert.match(app.toast.innerHTML, /capture cannot retrieve your existing plan/);
    await app.click("go-settings");
    assert.match(app.app.innerHTML, /Gemini diagnostics/);
    await app.click("export-gemini-debug");
    assert.equal(app.downloads.length, 1);
    assert.match(app.downloads[0].filename, /^studio-gemini-debug-v[\d.]+-.*\.json$/);
    const report = JSON.parse(await app.downloads[0].blob.text());
    assert.equal(report.records[0].code, "empty_tasks");
    assert.equal(report.records[0].mode, "multiple-blocks");
    assert.equal(JSON.stringify(report).includes("what's the plan tomorrow?"), false);
    assert.equal(app.calls.length, 1);
    await app.click("clear-gemini-debug");
    await app.click("export-gemini-debug");
    assert.deepEqual(JSON.parse(await app.downloads[1].blob.text()).records, []);
    assert.equal(app.calls.length, 1);
    assert.equal(app.stateWrites(), 0);
  } finally { app.cleanup(); }
});

test("debug text and saved instruction sharing are independent opt-ins", async () => {
  const state = updateMemory(createDefaultState(), { customInstructions: "PRIVATE-DEFAULT-INSTRUCTIONS", enabled: true });
  const app = await boot({ state });
  try {
    await app.click("go-settings");
    assert.match(app.app.innerHTML, /id="memory-enabled"[^>]*checked/);
    assert.doesNotMatch(app.app.innerHTML, /id="diagnostics-include-text"[^>]*checked/);
    await app.debugText(true);
    assert.match(app.app.innerHTML, /id="diagnostics-include-text"[^>]*checked/);
    assert.equal(app.calls.length, 0);
    await app.submit("omnibar-form", { capture: "PRIVATE-CAPTURE-PROMPT" });
    assert.match(app.calls[0].body.system_instruction, /PRIVATE-DEFAULT-INSTRUCTIONS/);
    await app.click("close-modal");
    await app.click("export-gemini-debug");
    const report = JSON.parse(await app.downloads[0].blob.text());
    assert.equal(report.containsRequestText, true);
    assert.match(report.records[0].requestText.prompt, /PRIVATE-CAPTURE-PROMPT/);
    assert.equal(report.records[0].requestText.customInstructions, "PRIVATE-DEFAULT-INSTRUCTIONS");
    await app.debugText(false);
    await app.click("export-gemini-debug");
    const cleared = JSON.parse(await app.downloads[1].blob.text());
    assert.equal(cleared.containsRequestText, false);
    assert.equal(JSON.stringify(cleared).includes("PRIVATE-"), false);
    assert.equal(app.state().memory.enabled, true);
    assert.equal(app.state().memory.customInstructions, "PRIVATE-DEFAULT-INSTRUCTIONS");
    assert.equal(app.calls.length, 1);
  } finally { app.cleanup(); }
});

test("a failed debug toggle returns to the saved choice and erasing data restores both defaults", async () => {
  const app = await boot();
  try {
    await app.click("go-settings");
    app.rejectWrites(true);
    await app.debugText(true);
    assert.match(app.toast.innerHTML, /Storage temporarily unavailable/);
    assert.doesNotMatch(app.app.innerHTML, /id="diagnostics-include-text"[^>]*checked/);
    app.rejectWrites(false);
    await app.debugText(true);
    assert.match(app.app.innerHTML, /id="diagnostics-include-text"[^>]*checked/);
    await app.click("confirm-reset");
    assert.equal(app.state().memory.enabled, false);
    assert.equal(app.state().memory.customInstructions, "");
    const settings = await chrome.runtime.sendMessage({ type: "gemini:diagnostics-settings" });
    assert.equal(settings.data.includeText, false);
    assert.equal(app.calls.length, 0);
  } finally { app.cleanup(); }
});

test("beginner capture previews multiple blocks and one confirmation saves them without Plan", async () => {
  const app = await boot();
  try {
    await app.click("open-omnibar");
    assert.match(app.app.innerHTML, /id="capture-multiple"[^>]* checked/);
    assert.match(app.app.innerHTML, /busy times for the next seven days/);
    await app.submit("omnibar-form", { capture: "Study for an hour and outline for thirty minutes" });
    assert.equal(app.calls.length, 1);
    assert.ok(app.calls[0].body.response_format.schema.properties.tasks);
    assert.ok(app.calls[0].body.response_format.schema.properties.focus_blocks);
    assert.match(app.app.innerHTML, /Review Gemini’s focus blocks/);
    assert.match(app.app.innerHTML, /Add 3 selected blocks/);
    assert.equal(app.state().tasks.length, 0);
    assert.equal(app.state().schedule.length, 0);
    await app.submit("capture-blocks-form");
    assert.equal(app.state().tasks.length, 2);
    assert.equal(app.state().schedule.length, 3);
    assert.deepEqual(app.state().schedule.map(block => [app.state().tasks.find(task => task.id === block.taskId).title, block.label]), [["Study", "Read"], ["Study", "Practice"], ["Write", "Outline"]]);
    assert.equal(app.state().proposals.length, 0);
    assert.equal(app.state().focus.status, "idle");
    assert.equal(app.stateWrites(), 1);
    assert.equal(app.calls.length, 1);
    assert.match(app.toast.innerHTML, /Added 3 focus blocks across 2 tasks/);
    assert.doesNotMatch(app.app.innerHTML, /id="capture-blocks-form"/);
    await app.click("navigate", { view: "plan" });
    await app.click("plan-view", { value: "schedule" });
    assert.match(app.app.innerHTML, /Practice/);
    assert.match(app.app.innerHTML, /Outline/);
  } finally { app.cleanup(); }
});

test("editing, deselection, and unrelated state refresh preserve the reviewed batch", async () => {
  const app = await boot();
  try {
    await app.submit("omnibar-form", { capture: "Study and write" });
    app.edit(0, "title", "Edited study");
    app.edit(0, "label", "Edited practice", 1);
    app.edit(0, "durationMinutes", "35", 1);
    app.edit(1, "selected", false, 0);
    const updated = app.state(); updated.preferences.theme = "paper";
    await app.externalState(updated);
    assert.match(app.app.innerHTML, /Edited study/);
    assert.match(app.app.innerHTML, /Edited practice/);
    assert.match(app.app.innerHTML, /Add 2 selected blocks/);
    await app.submit("capture-blocks-form");
    assert.equal(app.state().tasks.length, 1);
    assert.equal(app.state().tasks[0].title, "Edited study");
    assert.equal(app.state().tasks[0].durationMinutes, 55);
    assert.equal(app.state().schedule[1].label, "Edited practice");
    assert.equal(app.state().preferences.theme, "paper");
  } finally { app.cleanup(); }
});

test("turning the toggle off persists and uses the original single-task response and save flow", async () => {
  let app = await boot();
  try {
    await app.toggle(false);
    assert.equal(app.state().preferences.allowMultipleFocusBlocks, false);
    assert.equal(app.calls.length, 0);
    const saved = app.state(); app.cleanup(); app = await boot({ state: saved });
    await app.click("open-omnibar");
    assert.doesNotMatch(app.app.innerHTML, /id="capture-multiple"[^>]* checked/);
    assert.doesNotMatch(app.app.innerHTML, /busy times for the next seven days/);
    await app.submit("omnibar-form", { capture: "Read one chapter" });
    assert.equal("tasks" in app.calls[0].body.response_format.schema.properties, false);
    assert.match(app.app.innerHTML, /id="task-form"/);
    await app.submit("task-form", { title: "Single task", notes: "", durationMinutes: "25", dueAt: "", energy: "medium", priority: "normal" });
    assert.equal(app.state().tasks.length, 1);
    assert.equal(app.state().schedule.length, 0);
    assert.doesNotMatch(app.app.innerHTML, /id="task-form"/);
    assert.equal(app.calls.length, 1);
  } finally { app.cleanup(); }
});

test("system mode starts off and a saved override to on takes effect without a reconnect", async () => {
  const app = await boot({ experience: "system" });
  try {
    await app.click("open-omnibar");
    assert.doesNotMatch(app.app.innerHTML, /id="capture-multiple"[^>]* checked/);
    await app.toggle(true);
    await app.submit("omnibar-form", { capture: "Study and write" });
    assert.equal(app.calls.length, 1);
    assert.ok(app.calls[0].body.response_format.schema.properties.tasks);
    assert.match(app.app.innerHTML, /id="capture-blocks-form"/);
  } finally { app.cleanup(); }
});

test("discarding a multi-block draft adds no tasks or schedule entries", async () => {
  const app = await boot();
  try {
    await app.submit("omnibar-form", { capture: "Study and write" });
    await app.click("close-modal");
    assert.equal(app.stateWrites(), 0);
    assert.equal(app.state().tasks.length, 0);
    assert.equal(app.state().schedule.length, 0);
    assert.equal(app.calls.length, 1);
  } finally { app.cleanup(); }
});

test("storage failure retains edits; retry adds the batch once and a duplicate submit is ignored", async () => {
  const app = await boot();
  try {
    await app.submit("omnibar-form", { capture: "Study and write" });
    app.edit(0, "label", "Retain this edit", 0);
    app.rejectWrites(true);
    await app.submit("capture-blocks-form");
    assert.equal(app.state().tasks.length, 0);
    assert.match(app.app.innerHTML, /Retain this edit/);
    assert.match(app.toast.innerHTML, /Storage temporarily unavailable/);
    app.rejectWrites(false);
    await Promise.all([app.submit("capture-blocks-form"), app.submit("capture-blocks-form")]);
    assert.equal(app.state().tasks.length, 2);
    assert.equal(app.state().schedule.length, 3);
    assert.equal(app.stateWrites(), 1);
    assert.equal(app.state().schedule[0].label, "Retain this edit");
  } finally { app.cleanup(); }
});

test("a busy period arriving during review blocks save and preserves the draft for correction", async () => {
  const app = await boot();
  try {
    await app.submit("omnibar-form", { capture: "Study and write" });
    const state = app.state();
    const startAt = sampleResponse().focus_blocks[0].start_at;
    state.tasks.push({ id: "existing", title: "An appointment", notes: "", durationMinutes: 20, status: "planned", energy: "medium", priority: "normal", source: "manual", createdAt: state.createdAt });
    state.schedule.push({ id: "existing-block", taskId: "existing", startAt, endAt: new Date(new Date(startAt).getTime() + 20 * 60_000).toISOString(), status: "planned", source: "manual" });
    await app.externalState(state);
    await app.submit("capture-blocks-form");
    assert.equal(app.state().tasks.length, 1);
    assert.equal(app.state().schedule.length, 1);
    assert.match(app.toast.innerHTML, /overlaps/);
    assert.match(app.app.innerHTML, /id="capture-blocks-form"/);
    app.edit(0, "selected", false, 0);
    await app.submit("capture-blocks-form");
    assert.equal(app.state().tasks.length, 3);
    assert.equal(app.state().schedule.length, 3);
  } finally { app.cleanup(); }
});

test("a missing start can be edited in local time and saved without regenerating", async () => {
  const raw = sampleResponse();
  const actualStart = raw.focus_blocks[0].start_at;
  raw.focus_blocks[0].start_at = "";
  const app = await boot({ response: raw });
  try {
    await app.submit("omnibar-form", { capture: "Study and write" });
    assert.match(app.app.innerHTML, /choose a start time/);
    app.edit(0, "startAt", localDateTimeInput(actualStart), 0);
    await app.submit("capture-blocks-form");
    assert.equal(app.state().schedule.length, 3);
    assert.equal(app.state().schedule[0].startAt, actualStart);
    assert.equal(app.calls.length, 1);
  } finally { app.cleanup(); }
});

test("multi-block requests include saved memory but not existing task text or feedback", async () => {
  const state = updateMemory(createDefaultState(), { enabled: true, customInstructions: "Prefer clear steps." });
  state.tasks.push({ id: "private", title: "PRIVATE-TASK", notes: "PRIVATE-NOTES", durationMinutes: 20, createdAt: state.createdAt });
  state.feedback.push({ id: "feedback", text: "PRIVATE-FEEDBACK", createdAt: state.createdAt });
  const app = await boot({ state });
  try {
    const memoryBefore = app.state().memory;
    await app.submit("omnibar-form", { capture: "Study and write" });
    const request = app.calls[0].body;
    assert.match(request.system_instruction, /Prefer clear steps/);
    assert.doesNotMatch(JSON.stringify(request), /PRIVATE-TASK|PRIVATE-NOTES|PRIVATE-FEEDBACK|fake-capture-test-credential/);
    assert.equal(request.store, false);
    assert.deepEqual(app.state().memory, memoryBefore);
    assert.equal(app.state().tasks.length, 1);
  } finally { app.cleanup(); }
});

test("model markup is escaped and malformed batches never produce a partial review or save", async () => {
  const raw = sampleResponse();
  raw.rationale = '<img src=x onerror="example">';
  raw.tasks[0].title = '</input><script>example</script>';
  raw.focus_blocks[0].label = '<svg onload="example">';
  const app = await boot({ response: raw });
  try {
    await app.submit("omnibar-form", { capture: "Study and write" });
    assert.match(app.app.innerHTML, /&lt;img/);
    assert.match(app.app.innerHTML, /&lt;script&gt;/);
    assert.match(app.app.innerHTML, /&lt;svg onload/);
    assert.doesNotMatch(app.app.innerHTML, /<script>example|<img src=x/);
    await app.click("close-modal");
    const malformed = sampleResponse(); malformed.tasks[1].duration_minutes = 99;
    app.respondWith(malformed);
    await app.submit("omnibar-form", { capture: "Study and write" });
    assert.match(app.toast.innerHTML, /do not match the task total/);
    assert.doesNotMatch(app.app.innerHTML, /id="capture-blocks-form"/);
    assert.equal(app.stateWrites(), 0);
  } finally { app.cleanup(); }
});

test("disconnected capture stays manual even when multiple blocks are enabled", async () => {
  const app = await boot({ connected: false });
  try {
    await app.submit("omnibar-form", { capture: "Study and write" });
    assert.match(app.app.innerHTML, /id="task-form"/);
    assert.match(app.toast.innerHTML, /manual draft/);
    assert.equal(app.calls.length, 0);
    assert.equal(app.stateWrites(), 0);
  } finally { app.cleanup(); }
});

test("guided planning is local by default and saves the user's task without Gemini", async () => {
  const app = await boot({ connected: false });
  try {
    await app.click("go-settings");
    await app.change("planning-enabled", "", { checked: true });
    assert.match(app.app.innerHTML, /Guide me/);
    assert.match(app.app.innerHTML, /id="guide-title"[^>]*value=""/);
    await app.submit("guided-plan-form", { output: "task", title: "My own reading task", durationMinutes: "20", notes: "My own choice" });
    assert.equal(app.state().tasks[0].title, "My own reading task");
    assert.equal(app.state().tasks[0].source, "manual");
    assert.equal(app.state().focus.status, "idle");
    assert.equal(app.state().schedule.length, 0); assert.equal(app.calls.length, 0);
  } finally { app.cleanup(); }
});

test("Gemini coaching never fills or submits the manual planning form", async () => {
  const app = await boot({ response: { overview: "Consider your own priorities.", questions: ["What matters now?"], steps: ["Estimate the time yourself."], ideas: ["AI BRAINSTORMED IDEA"], tasks: [{ title: "FORGED TASK" }] } });
  try {
    await app.click("go-settings");
    await app.change("planning-enabled", "", { checked: true });
    const before = app.state();
    app.input("guide-title", "UNSAVED USER CHOICE", { guideField: "title" });
    app.input("guide-duration", "35", { guideField: "durationMinutes" });
    await app.submit("guide-help-form", { reflection: "How should I choose a reading goal?" });
    assert.equal(app.calls.length, 1);
    assert.match(app.app.innerHTML, /AI BRAINSTORMED IDEA/);
    assert.match(app.app.innerHTML, /id="guide-title"[^>]*value="UNSAVED USER CHOICE"/);
    assert.match(app.app.innerHTML, /id="guide-duration"[^>]*value="35"/);
    assert.doesNotMatch(app.app.innerHTML, /FORGED TASK/);
    assert.deepEqual({ ...app.state(), aiUsage: null }, { ...before, aiUsage: null });
    await app.click("go-settings");
    await app.click("export-gemini-debug");
    const report = JSON.parse(await app.downloads.at(-1).blob.text());
    assert.equal(report.records[0].schemaVariant, "guided-planning-v1");
    assert.doesNotMatch(JSON.stringify(report), /reading goal|USER CHOICE|AI BRAINSTORMED/);
  } finally { app.cleanup(); }
});

test("guided block creation requires a user-chosen time, stays manual, and rejects overlap", async () => {
  const app = await boot({ connected: false });
  try {
    await app.click("go-settings");
    await app.change("planning-enabled", "", { checked: true });
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
    const values = { output: "block", title: "My chosen block", durationMinutes: "30", startAt: localDateTimeInput(tomorrow) };
    await app.submit("guided-plan-form", values);
    assert.equal(app.state().tasks.length, 1); assert.equal(app.state().schedule.length, 1);
    assert.equal(app.state().schedule[0].source, "manual"); assert.equal(app.state().focus.status, "idle");
    await app.submit("guided-plan-form", { ...values, title: "Overlapping block" });
    assert.match(app.toast.innerHTML, /overlaps/);
    assert.equal(app.state().tasks.length, 1); assert.equal(app.state().schedule.length, 1);
    assert.equal(app.calls.length, 0);
  } finally { app.cleanup(); }
});

test("next-step advice uses current tasks and opens review without starting a timer", async () => {
  const app = await boot();
  try {
    await app.click("go-settings");
    await app.change("planning-enabled", "", { checked: true });
    await app.submit("guided-plan-form", { output: "task", title: "Existing reading task", durationMinutes: "40" });
    const task = app.state().tasks[0];
    await app.change("planning-mode", "suggest");
    app.respondWith({ overview: "A small option.", suggestions: [{ task_id: task.id, title: "Wrong model title", reason: "It is already in your inbox.", duration_minutes: 15 }] });
    const before = app.state();
    await app.click("day-advice");
    assert.match(app.calls.at(-1).body.input, /Existing reading task/);
    assert.match(app.app.innerHTML, /Review focus setup/);
    assert.doesNotMatch(app.app.innerHTML, /Wrong model title/);
    assert.deepEqual({ ...app.state(), aiUsage: null }, { ...before, aiUsage: null });
    await app.click("advice-use", { suggestionIndex: "0" });
    assert.match(app.app.innerHTML, /Set up focus/);
    assert.match(app.app.innerHTML, /name="durationMinutes"[^>]*value="15"/);
    assert.equal(app.state().focus.status, "idle");
  } finally { app.cleanup(); }
});

test("memory UI supports local create, edit, confirm, forget, and separate learning opt-in", async () => {
  const app = await boot();
  try {
    await app.click("go-settings");
    assert.doesNotMatch(app.app.innerHTML, /id="learned-learning"[^>]*checked/);
    assert.doesNotMatch(app.app.innerHTML, /id="learned-use"[^>]*checked/);
    await app.click("learned-add");
    await app.submit("learned-memory-form", { text: "Use brief reading explanations.", scope: "reading", kind: "preference", expiresAt: "" });
    assert.equal(app.memory().memories.length, 1); assert.equal(app.calls.length, 0);
    let record = app.memory().memories[0];
    await app.click("learned-edit", { memoryId: record.id });
    await app.submit("learned-memory-form", { text: "Use flexible reading explanations.", scope: "reading", kind: "preference", expiresAt: "" });
    assert.equal(app.memory().memories[0].text, "Use flexible reading explanations.");
    await app.change("learned-learning", "", { checked: true });
    await app.submit("learning-note-form", { text: "A short reading session felt manageable.", scope: "reading" });
    const evidence = app.memory().evidence[0];
    assert.ok(evidence); assert.equal(app.calls.length, 0);
    app.respondWith({ changes: [{ operation: "create", target_id: "", text: "May benefit from shorter reading sessions.", scope: "reading", kind: "preference", evidence_ids: [evidence.id], expires_at: "" }] });
    await app.click("learned-update");
    assert.equal(app.calls.length, 1); assert.equal(app.memory().memories.length, 2);
    record = app.memory().memories.find(item => item.status === "tentative");
    assert.ok(record);
    await app.click("learned-confirm", { memoryId: record.id });
    assert.equal(app.memory().memories.find(item => item.id === record.id).status, "confirmed");
    await app.click("learned-ask-forget", { memoryId: record.id });
    assert.equal(app.memory().memories.length, 2);
    await app.click("learned-forget");
    assert.equal(app.memory().memories.length, 1);
    assert.equal(app.memory().evidence.length, 0);
    assert.equal(app.calls.length, 1);
  } finally { app.cleanup(); }
});

test("saved memory accompanies assistance, remains absent from default debug, and obeys use toggle", async () => {
  const app = await boot({ response: { overview: "Think it through.", questions: [], steps: [], ideas: [] } });
  try {
    await app.send({ type: "memory:save", draft: { text: "PRIVATE-MEMORY-PREFERENCE", scope: "general", kind: "preference" } });
    await app.send({ type: "memory:settings", patch: { useWithGemini: true } });
    await app.submit("guide-help-form", { reflection: "PRIVATE-PLANNING-REFLECTION" });
    assert.match(app.calls.at(-1).body.system_instruction, /PRIVATE-MEMORY-PREFERENCE/);
    let report = (await app.send({ type: "gemini:diagnostics" })).data;
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE-/);
    await app.debugText(true);
    await app.submit("guide-help-form", { reflection: "PRIVATE-PLANNING-REFLECTION" });
    report = (await app.send({ type: "gemini:diagnostics" })).data;
    assert.match(report.records.at(-1).requestText.savedMemoryContext, /PRIVATE-MEMORY-PREFERENCE/);
    await app.send({ type: "memory:settings", patch: { useWithGemini: false } });
    await app.submit("guide-help-form", { reflection: "PRIVATE-PLANNING-REFLECTION" });
    assert.doesNotMatch(JSON.stringify(app.calls.at(-1).body), /PRIVATE-MEMORY-PREFERENCE/);
    await app.debugText(false);
    assert.doesNotMatch(JSON.stringify((await app.send({ type: "gemini:diagnostics" })).data), /PRIVATE-/);
  } finally { app.cleanup(); }
});

test("model dropdown is in Settings and no longer competes with Today", async () => {
  const app = await boot();
  try {
    assert.doesNotMatch(app.app.innerHTML, /id="connected-model"/);
    for (const view of ["settings"]) {
      if (view === "settings") await app.click("go-settings");
      const card = app.app.innerHTML.match(/<section class="card" aria-labelledby="gemini-title">([\s\S]*?)<\/section>/)?.[1];
      assert.ok(card);
      assert.match(card, /<label for="connected-model">Gemini model<\/label>/);
      assert.match(card, /<select id="connected-model"[^>]*name="model"/);
      assert.ok(card.indexOf('id="model-choice-form"') < card.indexOf("<details"));
      assert.doesNotMatch(card, /<summary>Choose a free-tier model/);
      for (const model of FREE_TIER_MODELS) assert.ok(card.includes(`value="${model.id}"`));
      assert.match(card, /Use &amp; test sends one request|Use & test sends one request/);
    }
    assert.equal(app.calls.length, 0);
  } finally { app.cleanup(); }
});

test("model dropdown in setup reveals custom input without rebuilding the key form", async () => {
  const app = await boot({ connected: false });
  try {
    await app.click("show-gemini-form");
    assert.match(app.app.innerHTML, /<select id="model"[^>]*name="model"/);
    assert.doesNotMatch(app.app.innerHTML, /<datalist|<input id="model"/);
    assert.match(app.app.innerHTML, /id="model-custom-field"[^>]*hidden/);
    const renders = app.renderWrites();
    await app.change("model", "__custom__", { dataset: { modelPicker: "model" } });
    assert.equal(app.fields.get("#model-custom-field").hidden, false);
    assert.equal(app.fields.get("#model-custom").disabled, false);
    assert.equal(app.fields.get("#model-custom").required, true);
    app.input("model-custom", "gemini-test-custom", { modelCustom: "model" });
    assert.equal(app.renderWrites(), renders, "Changing model must not clear the API-key form by re-rendering");
    assert.equal(app.calls.length, 0);
    await app.submit("gemini-form", { apiKey: "fake-setup-credential-12345", model: "__custom__", customModel: " gemini-test-custom " });
    assert.equal(app.calls.length, 1);
    assert.equal(app.calls[0].body.model, "gemini-test-custom");
    assert.equal(app.state().preferences.model, "gemini-test-custom");
    assert.match(app.app.innerHTML, /Active model: gemini-test-custom/);
    assert.match(app.app.innerHTML, /<option value="__custom__" selected>/);
    assert.match(app.app.innerHTML, /id="connected-model-custom"[^>]*value="gemini-test-custom"/);
  } finally { app.cleanup(); }
});

test("model dropdown selection survives renders and applies only after an explicit test", async () => {
  const app = await boot();
  try {
    await app.click("go-settings");
    const active = (await app.send({ type: "gemini:status" })).data.model;
    await app.change("connected-model", "gemini-2.5-flash", { dataset: { modelPicker: "connected-model" } });
    assert.equal(app.calls.length, 0);
    assert.equal(app.stateWrites(), 0);
    assert.equal((await app.send({ type: "gemini:status" })).data.model, active);
    await app.click("set-theme", { value: "paper" });
    assert.match(app.app.innerHTML, /<option value="gemini-2.5-flash" selected>/);
    assert.ok(app.app.innerHTML.includes(`Active model: ${active}`));
    await app.submit("model-choice-form", { model: "gemini-2.5-flash", customModel: "ignored-stale-custom-value" });
    assert.equal(app.calls.length, 1);
    assert.equal(app.calls[0].body.model, "gemini-2.5-flash");
    assert.match(app.app.innerHTML, /Active model: gemini-2.5-flash/);
    await app.submit("omnibar-form", { capture: "Study and write tomorrow" });
    assert.equal(app.calls[1].body.model, "gemini-2.5-flash");
  } finally { app.cleanup(); }
});

test("model dropdown custom choice validates locally and a failed test retains the active model", async () => {
  const app = await boot();
  try {
    await app.click("go-settings");
    const active = (await app.send({ type: "gemini:status" })).data.model;
    await app.change("connected-model", "__custom__", { dataset: { modelPicker: "connected-model" } });
    await app.submit("model-choice-form", { model: "__custom__", customModel: "  " });
    assert.equal(app.calls.length, 0);
    assert.match(app.toast.innerHTML, /enter a custom model ID/);
    app.input("connected-model-custom", "gemini-unavailable-custom", { modelCustom: "connected-model" });
    app.failProvider(404);
    await app.submit("model-choice-form", { model: "__custom__", customModel: "gemini-unavailable-custom" });
    assert.equal(app.calls.length, 1);
    assert.equal((await app.send({ type: "gemini:status" })).data.model, active);
    assert.ok(app.app.innerHTML.includes(`Active model: ${active}`));
    assert.match(app.app.innerHTML, /id="connected-model-custom"[^>]*value="gemini-unavailable-custom"/);
    await app.change("connected-model", active, { dataset: { modelPicker: "connected-model" } });
    assert.equal(app.fields.get("#connected-model-custom-field").hidden, true);
    assert.equal(app.fields.get("#connected-model-custom").disabled, true);
    assert.equal(app.fields.get("#connected-model-custom").required, false);
    assert.equal(app.calls.length, 1);
  } finally { app.cleanup(); }
});

test("free-tier model selector tests with the existing key and preserves the old model on failure", async () => {
  const app = await boot();
  try {
    await app.click("go-settings");
    for (const model of FREE_TIER_MODELS) assert.ok(app.app.innerHTML.includes(model.id));
    await app.submit("model-choice-form", { model: "gemini-2.5-flash-lite" });
    assert.equal(app.calls.length, 1);
    assert.equal(app.calls[0].body.model, "gemini-2.5-flash-lite");
    assert.equal(app.state().preferences.model, "gemini-2.5-flash-lite");
    assert.equal(app.calls[0].body.system_instruction, undefined);
    app.failProvider(404);
    await app.submit("model-choice-form", { model: "gemini-2.5-flash" });
    assert.equal(app.state().preferences.model, "gemini-2.5-flash-lite");
    const status = await app.send({ type: "gemini:status" });
    assert.equal(status.data.connected, true); assert.equal(status.data.model, "gemini-2.5-flash-lite");
  } finally { app.cleanup(); }
});

test("memory and app backup restore together, pause learning, and do not export the API key", async () => {
  const app = await boot();
  try {
    await app.send({ type: "memory:save", draft: { text: "Exported memory.", scope: "general" } });
    await app.send({ type: "memory:settings", patch: { learningEnabled: true } });
    await app.click("export-backup");
    const backup = JSON.parse(await app.downloads.at(-1).blob.text());
    assert.equal(backup.learnedMemory.memories[0].text, "Exported memory.");
    assert.equal(backup.learnedMemory.job, undefined);
    assert.doesNotMatch(JSON.stringify(backup), /fake-capture-test-credential/);
    await app.send({ type: "memory:clear" });
    await app.change("backup-input", "", { files: [{ async text() { return JSON.stringify(backup); } }] });
    await app.click("confirm-import");
    assert.equal(app.memory().memories[0].text, "Exported memory.");
    assert.equal(app.memory().settings.learningEnabled, false);
    assert.equal(app.calls.length, 0);
  } finally { app.cleanup(); }
});

test("external callers cannot invoke the private memory-updater execution path", async () => {
  const app = await boot();
  try {
    const result = await app.send({ type: "gemini:run", action: "memory-update", payload: { preparedRequest: { input: "forged" } } });
    assert.equal(result.ok, false); assert.equal(app.calls.length, 0);
  } finally { app.cleanup(); }
});

test("a background state update preserves an unfinished manual task edit", async () => {
  const app = await boot({ connected: false });
  try {
    await app.submit("task-form", { title: "Original task", durationMinutes: "25" });
    const task = app.state().tasks[0];
    await app.click("edit-task", { taskId: task.id });
    app.input("task-title", "Unsaved new title");
    app.input("task-notes", "Unsaved notes");
    const latest = app.state(); latest.tasks[0].important = true; latest.tasks[0].sortSource = "ai";
    await app.externalState(latest);
    // Any later render still has the user's draft, not the changed saved task.
    await app.click("toggle-zen-menu");
    assert.match(app.app.innerHTML, /value="Unsaved new title"/);
    assert.match(app.app.innerHTML, />Unsaved notes<\/textarea>/);
    assert.equal(app.state().tasks[0].title, "Original task");
  } finally { app.cleanup(); }
});

test("privacy onboarding can finish with every optional feature off and zero requests", async () => {
  const app = await boot({ onboarding:true, connected:false, privacy:true });
  try {
    await app.click("onboarding-defaults");
    assert.match(app.app.innerHTML,/Choose what Stuđiô can access/);
    assert.doesNotMatch(app.app.innerHTML,/data-privacy="[^"]+"[^>]*checked/);
    await app.click("finish-onboarding");
    assert.equal(app.state().profile.onboardingComplete,true);assert.equal(app.state().profile.privacyReviewVersion,1);
    assert.equal(app.permissionCalls.length,0);assert.equal(app.calls.length,0);
    assert.match(app.app.innerHTML,/id="quick-focus-form"/);
  } finally { app.cleanup(); }
});

test("privacy tracking asks in the original gesture and denial never checks the switch", async () => {
  const app = await boot({privacy:true,grantPrivacy:false,connected:false});
  try {
    await app.click("open-privacy");const renders=app.renderWrites();
    await app.change("", "", {dataset:{privacy:"tracking"},checked:true});
    assert.equal(app.permissionRenderWrites(),renders);
    assert.deepEqual(app.permissionCalls,[{permissions:["tabs","idle"]}]);
    assert.equal((await app.send({type:"activity:get"})).data.settings.enabled,false);
    assert.doesNotMatch(app.app.innerHTML,/data-privacy="tracking"[^>]*checked/);
    assert.match(app.toast.innerHTML,/permission was not granted/);
    assert.equal(app.trackingQueries(),0);assert.equal(app.calls.length,0);
  } finally { app.cleanup(); }
});

test("privacy tracking grants do not enable titles, media, AI or reminders", async () => {
  const app = await boot({privacy:true,connected:false});
  try {
    await app.click("open-privacy");
    await app.change("", "", {dataset:{privacy:"tracking"},checked:true});
    const a=(await app.send({type:"activity:get"})).data.settings;
    assert.equal(a.enabled,true);assert.equal(a.details,false);assert.equal(a.aiEnabled,false);assert.equal(a.backgroundMedia,false);assert.deepEqual(a.signalOrigins,[]);
    assert.equal((await app.send({type:"reminder:get"})).data.settings.enabled,false);
    await app.change("", "", {dataset:{privacy:"tracking"},checked:false});
    assert.equal((await app.send({type:"activity:get"})).data.settings.enabled,false);
    assert.equal(app.permissionCalls.length,1);assert.equal(app.calls.length,0);
  } finally { app.cleanup(); }
});

test("media setup requests one exact origin, denial is off, and removal unregisters it", async () => {
  const app = await boot({privacy:true,connected:false,grantPrivacy:false});
  try {
    await app.click("open-privacy");
    await app.change("", "", {dataset:{privacy:"media"},checked:true});
    assert.equal(app.permissionCalls.length,0);assert.match(app.app.innerHTML,/id="privacy-site-form"/);
    assert.doesNotMatch(app.app.innerHTML,/data-privacy="media"[^>]*checked/);
    await app.submit("privacy-site-form",{origin:"https://lecture.example/watch?q=private"});
    assert.deepEqual(app.permissionCalls[0],{permissions:["scripting"],origins:["https://lecture.example/*"]});
    assert.deepEqual((await app.send({type:"activity:get"})).data.settings.signalOrigins,[]);
    app.privacyDecision(true);
    await app.change("", "", {dataset:{privacy:"tracking"},checked:true});
    await app.submit("privacy-site-form",{origin:"https://lecture.example/watch?q=private"});
    assert.deepEqual((await app.send({type:"activity:get"})).data.settings.signalOrigins,["https://lecture.example"]);
    assert.match(app.app.innerHTML,/data-privacy="media"[^>]*checked/);
    assert.ok(app.registeredScripts.length);
    await app.change("", "", {dataset:{privacy:"media"},checked:false});
    assert.deepEqual((await app.send({type:"activity:get"})).data.settings.signalOrigins,[]);
    assert.equal(app.registeredScripts.length,0);assert.equal(app.calls.length,0);
  } finally { app.cleanup(); }
});

test("notification opt-in is separate and daily review remains off", async () => {
  const app = await boot({privacy:true,connected:false,grantPrivacy:false});
  try {
    await app.click("open-privacy");await app.change("", "", {dataset:{privacy:"notifications"},checked:true});
    assert.doesNotMatch(app.app.innerHTML,/data-privacy="notifications"[^>]*checked/);
    app.privacyDecision(true);await app.change("", "", {dataset:{privacy:"notifications"},checked:true});
    let r=(await app.send({type:"reminder:get"})).data.settings;
    assert.equal(r.enabled,true);assert.equal(r.review,false);
    assert.deepEqual(app.permissionCalls[0],{permissions:["notifications"]});
    await app.change("", "", {dataset:{privacy:"review"},checked:true});
    r=(await app.send({type:"reminder:get"})).data.settings;assert.equal(r.review,true);
    await app.change("", "", {dataset:{privacy:"notifications"},checked:false});
    assert.equal((await app.send({type:"reminder:get"})).data.settings.enabled,false);
    assert.equal(app.calls.length,0);
  } finally { app.cleanup(); }
});

test("cloud setup stays off until an explicit successful key test", async () => {
  const app = await boot({onboarding:true,privacy:true,connected:false});
  try {
    await app.click("onboarding-defaults");
    await app.change("", "", {dataset:{privacy:"gemini"},checked:true});
    assert.match(app.app.innerHTML,/id="gemini-form"/);assert.doesNotMatch(app.app.innerHTML,/data-privacy="gemini"[^>]*checked/);
    assert.equal(app.calls.length,0);assert.equal(app.permissionCalls.length,0);
    app.failProvider(404);await app.submit("gemini-form",{apiKey:"fake-private-test-credential",model:"gemini-test"});
    assert.doesNotMatch(app.app.innerHTML,/data-privacy="gemini"[^>]*checked/);
    app.failProvider(0);await app.submit("gemini-form",{apiKey:"fake-private-test-credential",model:"gemini-test"});
    assert.match(app.app.innerHTML,/data-privacy="gemini"[^>]*checked/);
    assert.equal(app.memory().settings.learningEnabled,false);assert.equal(app.memory().settings.useWithGemini,false);
    assert.equal(app.state().memory.enabled,false);assert.equal(app.state().preferences.autoSort,false);
    await app.change("", "", {dataset:{privacy:"gemini"},checked:false});
    assert.equal((await app.send({type:"gemini:status"})).data.connected,false);
    assert.equal(app.calls.length,2);
  } finally { app.cleanup(); }
});

test("privacy choices persist independently and storage failures show the saved choice", async () => {
  const app = await boot({privacy:true});
  try {
    await app.click("open-privacy");
    await app.change("", "", {dataset:{privacy:"details"},checked:true});
    await app.change("", "", {dataset:{privacy:"activityAI"},checked:true});
    assert.equal((await app.send({type:"activity:get"})).data.settings.aiEnabled,true);
    await app.change("", "", {dataset:{privacy:"details"},checked:false});
    assert.equal((await app.send({type:"activity:get"})).data.settings.aiEnabled,false);
    for (const key of ["instructions","memory","learning","autoSort","diagnostics"]) await app.change("", "", {dataset:{privacy:key},checked:true});
    assert.equal(app.state().memory.enabled,true);assert.equal(app.memory().settings.useWithGemini,true);assert.equal(app.memory().settings.learningEnabled,true);
    assert.equal(app.state().preferences.autoSort,true);
    app.rejectWrites(true);await app.change("", "", {dataset:{privacy:"details"},checked:true});
    assert.doesNotMatch(app.app.innerHTML,/data-privacy="details"[^>]*checked/);assert.match(app.toast.innerHTML,/Storage temporarily unavailable/);
    app.rejectWrites(false);await app.click("close-privacy");await app.click("open-privacy");
    assert.match(app.app.innerHTML,/data-privacy="memory"[^>]*checked/);assert.equal(app.calls.length,0);
  } finally { app.cleanup(); }
});

test("legacy collection is visible and can be stopped from Privacy without erasing totals", async () => {
  const app = await boot({privacy:true,connected:false});
  try {
    await chrome.permissions.request(TRACKING_PERMISSIONS);await app.send({type:"tracking:enable"});
    await app.click("tracking-refresh");await app.click("open-privacy");
    assert.match(app.app.innerHTML,/data-privacy="legacy"[^>]*checked/);
    await app.change("", "", {dataset:{privacy:"legacy"},checked:false});
    assert.equal((await app.send({type:"tracking:get"})).data.enabled,false);
    assert.equal(app.calls.length,0);
  } finally { app.cleanup(); }
});

test("media privacy setup refuses wildcard hosts, credentials and non-web schemes without a prompt", async () => {
  const app = await boot({privacy:true,connected:false});
  try {
    await app.click("open-privacy");await app.change("", "", {dataset:{privacy:"media"},checked:true});
    for(const origin of ["https://*/*","https://*.example.com/","file:///private","https://name:password@example.com/"]) await app.submit("privacy-site-form",{origin});
    assert.equal(app.permissionCalls.length,0);assert.deepEqual((await app.send({type:"activity:get"})).data.settings.signalOrigins,[]);
    assert.doesNotMatch(app.app.innerHTML,/data-privacy="media"[^>]*checked/);
  } finally { app.cleanup(); }
});

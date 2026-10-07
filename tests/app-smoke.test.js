import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { addTask, createBackup, createDefaultState, updateMemory } from "../src/core/state.js";
import { MAX_CUSTOM_INSTRUCTIONS_LENGTH } from "../src/core/memory.js";
import { localDateKey } from "../src/core/utils.js";
import { saveDayPlan, toggleTodayTask } from "../src/core/time-management.js";
import { applyKanbanAction, kanbanItem, kanbanWip } from "../src/core/kanban.js";
import { saveProposal } from "../src/core/state.js";
import { proposeSchedule } from "../src/core/scheduler.js";

async function bootApp(initialState = null, extraStores = {}) {
  const store = new Map(Object.entries(extraStores).map(([key,value])=>[key,JSON.stringify(value)]));
  if (initialState) store.set("studioPreviewState", JSON.stringify(initialState));
  let appMarkup = "", appRenders = 0;
  const app = {
    get innerHTML() { return appMarkup; },
    set innerHTML(value) { appRenders += 1; appMarkup = value; },
    className: "app-loading",
    querySelector() { return null; }
  };
  const toast = { innerHTML: "" };
  const learningSlot = {
    set innerHTML(value) {
      const start = appMarkup.indexOf('<div id="learning-slot">') + '<div id="learning-slot">'.length;
      const end = appMarkup.indexOf('</div><!-- learning-slot-end -->', start);
      assert.ok(end >= start);
      appMarkup = appMarkup.slice(0, start) + value + appMarkup.slice(end);
    }
  };
  const overlayHost = { set innerHTML(value) {
    const start = appMarkup.indexOf('<div id="learning-overlay-host">') + '<div id="learning-overlay-host">'.length;
    const end = appMarkup.indexOf('</div><!-- learning-overlay-end -->', start);
    assert.ok(end >= start);
    appMarkup = appMarkup.slice(0, start) + value + appMarkup.slice(end);
  } };
  const fields = new Map(["#memory-count", "#memory-draft-status", "#memory-discard"].map(id => [id, { textContent: "", disabled: true }]));
  const listeners = new Map();
  let rejectSave = false;
  let rejectGuideSave = false;
  let networkCalls = 0;
  const originalInterval = globalThis.setInterval;
  const originalTimeout = globalThis.setTimeout;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  const originalFormData = globalThis.FormData;
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key) { return store.get(key) ?? null; },
      setItem(key, value) { if (rejectSave || rejectGuideSave && key === "studioLearningGuide") throw new Error("Test storage is full."); store.set(key, String(value)); },
      removeItem(key) { store.delete(key); }
    }
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      documentElement: { dataset: {} },
      body: { append() {} },
      querySelector(selector) { return selector === "#app" ? app : selector === "#toast-region" ? toast : selector === "#learning-slot" && appMarkup.includes('id="learning-slot"') ? learningSlot : selector === "#learning-overlay-host" && appMarkup.includes('id="learning-overlay-host"') ? overlayHost : fields.get(selector) ?? null; },
      addEventListener(type, handler) { listeners.set(type, handler); },
      createElement() { return { click() {}, remove() {} }; }
    }
  });
  globalThis.requestAnimationFrame = callback => { callback(); return 1; };
  globalThis.setInterval = () => 1;
  globalThis.setTimeout = () => 1;
  globalThis.FormData = class {
    constructor(form) { this.values = form.values; }
    get(name) { return this.values[name] ?? null; }
  };
  globalThis.fetch = async () => { networkCalls += 1; throw new Error("No network allowed in UI tests."); };

  await import(`../src/app.js?smoke=${Date.now()}-${Math.random()}`);
  await delay(20);

  return {
    app,
    toast,
    fields,
    listeners,
    rejectSaves(value) { rejectSave = value; },
    rejectGuideSaves(value) { rejectGuideSave = value; },
    networkCalls() { return networkCalls; },
    renderCount() { return appRenders; },
    stored(key) { return JSON.parse(store.get(key) ?? "null"); },
    savedState() {
      const value = store.get("studioPreviewState");
      return value ? JSON.parse(value) : null;
    },
    async click(action, value, dataset = {}) {
      const button = { dataset: { action, ...(value ? { value } : {}), ...dataset } };
      listeners.get("click")({ target: { closest: () => button }, preventDefault() {} });
      await delay(20);
    },
    input(id, value) { listeners.get("input")({ target: { id, value, dataset: {} } }); },
    async change(id, properties) {
      listeners.get("change")({ target: { id, dataset: {}, ...properties } });
      await delay(20);
    },
    async submit(id, values) {
      listeners.get("submit")({ target: { id, values, dataset: {} }, preventDefault() {} });
      await delay(20);
    },
    cleanup() {
      globalThis.setInterval = originalInterval;
      globalThis.setTimeout = originalTimeout;
      globalThis.requestAnimationFrame = originalAnimationFrame;
      globalThis.FormData = originalFormData;
      globalThis.fetch = originalFetch;
      delete globalThis.document;
      delete globalThis.localStorage;
    }
  };
}

function activitySample() {
  const {state}=addTask(createDefaultState(),{title:"Activity",durationMinutes:25});state.profile.onboardingComplete=true;
  const end=new Date(Date.now()-60000).toISOString(),start=new Date(Date.now()-21*60000).toISOString();
  const activity={settings:{details:true},sessions:[{id:"review-1",revision:1,closed:true,segments:[{host:"study.example",title:"Activity",resource:"https://study.example/chapter",startAt:start,endAt:end,kind:"reading",uncertain:true,reasons:["visible_no_input"]}],suggestions:[{source:"local",taskId:state.tasks[0].id,reasons:['<img src=x onerror="alert(1)">']}]}]};
  return {state,activity};
}

function newLearner(language = "en") {
  const state = createDefaultState();
  state.profile.onboardingComplete = true;
  state.preferences.language = language;
  return state;
}

test("Choose another changes the focus choice without changing tasks or starting early",async()=>{
  let state=addTask(newLearner(),{title:"First task"}).state;
  state=addTask(state,{title:"Second <task>"}).state;
  const browser=await bootApp(state);
  try{
    const before=browser.savedState(),chosen=before.tasks.find(task=>task.title==="Second <task>");
    await browser.click("choose-focus");assert.match(browser.app.innerHTML,/What fits right now/);
    await browser.click("select-focus",null,{taskId:chosen.id});
    assert.deepEqual(browser.savedState(),before);assert.match(browser.app.innerHTML,/Second &lt;task&gt;/);
    await browser.submit("quick-focus-form",{durationMinutes:"10"});
    assert.equal(browser.savedState().focus.taskId,chosen.id);assert.equal(browser.savedState().focus.plannedSeconds,600);
    assert.equal(browser.networkCalls(),0);
  }finally{browser.cleanup();}
});

test("About credits MD Studio and the reference apps in English and Vietnamese",async()=>{
  for(const language of ["en","vi"]){
    const browser=await bootApp(newLearner(language));
    try{
      await browser.click("go-settings");await browser.click("open-about");
      assert.match(browser.app.innerHTML,/MD Studio/);assert.match(browser.app.innerHTML,/OffScreen/);assert.match(browser.app.innerHTML,/MD Clock/);assert.match(browser.app.innerHTML,/MD Vinyl/);
      assert.match(browser.app.innerHTML,/apps.apple.com\/app\/id1474340105/);
      assert.match(browser.app.innerHTML,language==="vi"?/Dự án độc lập/:/independent project/);
      assert.equal(browser.networkCalls(),0);
    }finally{browser.cleanup();}
  }
});

test("guide opens only on demand and explanations require no task or timer", async () => {
  const browser = await bootApp(newLearner());
  try {
    assert.match(browser.app.innerHTML, /Explain this screen/);
    assert.doesNotMatch(browser.app.innerHTML, /class="learning-overlay"/);
    await browser.click("learning-next"); // An unopened tour cannot be advanced.
    assert.deepEqual(browser.stored("studioLearningGuide").steps, {});
    await browser.click("learning-start");
    assert.match(browser.app.innerHTML, /Add one thing to do/);
    await browser.click("learning-next");
    assert.equal(browser.stored("studioLearningGuide").steps["basics.add"], "done");
    assert.match(browser.app.innerHTML, /Start when you are ready/);
    await browser.click("learning-back");
    assert.match(browser.app.innerHTML, /Add one thing to do/);
    await browser.click("learning-next");
    await browser.click("learning-next");
    assert.equal(browser.stored("studioLearningGuide").steps["basics.focus"], "done");
    assert.equal(browser.savedState().tasks.length, 0);
    assert.equal(browser.savedState().focus.status, "idle");
    await browser.submit("quick-task-form", { title: "Read chapter one" });
    await browser.submit("quick-focus-form", { durationMinutes: "5" });
    assert.equal(browser.savedState().tasks[0].status, "inbox");
    assert.doesNotMatch(browser.app.innerHTML, /class="learning-overlay"/);
    await browser.click("minimize-timer");
    await browser.click("navigate", null, { view: "activity" });
    assert.doesNotMatch(browser.app.innerHTML, /class="learning-overlay"/);
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

test("task saves are independent of guide saves; failed guide writes keep the current step", async () => {
  const browser = await bootApp(newLearner());
  try {
    browser.rejectSaves(true);
    await browser.submit("quick-task-form", { title: "Keep this task" });
    assert.equal(browser.savedState().tasks.length, 0);
    assert.deepEqual(browser.stored("studioLearningGuide").steps, {});
    browser.rejectSaves(false);
    browser.rejectGuideSaves(true);
    await browser.submit("quick-task-form", { title: "Keep this task" });
    assert.equal(browser.savedState().tasks.length, 1);
    assert.deepEqual(browser.stored("studioLearningGuide").steps, {});
    assert.doesNotMatch(browser.toast.innerHTML, /Guide progress could not be saved/);
    browser.rejectGuideSaves(false);
    await browser.click("learning-start");
    browser.rejectGuideSaves(true);
    await browser.click("learning-next");
    assert.match(browser.toast.innerHTML, /Guide progress could not be saved/);
    assert.match(browser.app.innerHTML, /Add one thing to do/);
    browser.rejectGuideSaves(false);
    await browser.click("learning-skip");
    assert.equal(browser.stored("studioLearningGuide").steps["basics.add"], "skipped");
    assert.match(browser.app.innerHTML, /Start when you are ready/);
  } finally { browser.cleanup(); }
});

test("contextual lessons follow navigation without activating optional features", async () => {
  const browser = await bootApp(newLearner());
  try {
    const before = browser.savedState();
    await browser.click("navigate", null, { view: "plan" });
    assert.doesNotMatch(browser.app.innerHTML, /class="learning-overlay"/);
    await browser.click("learning-start");
    assert.match(browser.app.innerHTML, /Decide what matters/);
    await browser.click("learning-next");
    assert.match(browser.app.innerHTML, /Leave room in today/);
    await browser.click("navigate", null, { view: "activity" });
    await browser.click("learning-start");
    assert.match(browser.app.innerHTML, /You choose what is recorded/);
    await browser.click("learning-next");
    assert.match(browser.app.innerHTML, /Read estimates as estimates/);
    await browser.click("navigate", null, { view: "insights" });
    await browser.click("learning-start");
    assert.match(browser.app.innerHTML, /Notice the pattern/);
    await browser.click("go-settings");
    await browser.click("learning-start");
    assert.match(browser.app.innerHTML, /Connect AI only if useful/);
    await browser.click("open-privacy");
    await browser.click("learning-start");
    assert.match(browser.app.innerHTML, /Read before switching on/);
    await browser.click("learning-next");
    assert.equal(browser.stored("studioLearningGuide").steps["privacy.choices"], "done");
    assert.doesNotMatch(browser.app.innerHTML, /data-privacy="[^"]+"[^>]*checked/);
    assert.equal(browser.stored("studioActivity")?.settings?.enabled ?? false, false);
    assert.deepEqual(browser.savedState().preferences, before.preferences);
    assert.deepEqual(browser.savedState().memory, before.memory);
    assert.equal(browser.savedState().kanban.enabled, false);
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

test("guide pause, skip and opt-out persist; manual resume works with automatic tips off", async () => {
  let browser = await bootApp(newLearner());
  try {
    await browser.click("learning-start");
    await browser.click("learning-skip");
    await browser.click("learning-pause");
    assert.doesNotMatch(browser.app.innerHTML, /class="learning-card"/);
    const saved = browser.savedState(), guide = browser.stored("studioLearningGuide");
    browser.cleanup(); browser = await bootApp(saved, { studioLearningGuide: guide });
    assert.doesNotMatch(browser.app.innerHTML, /class="learning-card"/);
    await browser.click("learning-open");
    assert.match(browser.app.innerHTML, /2 short explanations/);
    await browser.click("learning-enabled");
    assert.equal(browser.stored("studioLearningGuide").enabled, false);
    await browser.click("learning-resume", null, { topic: "basics" });
    assert.match(browser.app.innerHTML, /Start when you are ready/);
    await browser.click("navigate", null, { view: "activity" });
    assert.doesNotMatch(browser.app.innerHTML, /class="learning-card"/);
    await browser.click("learning-open");
    await browser.click("learning-replay", null, { topic: "basics" });
    assert.match(browser.app.innerHTML, /Add one thing to do/);
    assert.deepEqual(browser.stored("studioLearningGuide").steps, {});
    assert.equal(browser.stored("studioLearningGuide").enabled, false);
    assert.deepEqual(browser.savedState(), saved);
  } finally { browser.cleanup(); }
});

test("Escape pauses a lesson, and manual guides never enable Kanban or submit Smart Capture", async () => {
  const browser = await bootApp(newLearner());
  try {
    await browser.click("learning-start");
    browser.listeners.get("keydown")({ key: "Escape" }); await delay(20);
    assert.deepEqual(browser.stored("studioLearningGuide").pausedTopics, ["basics"]);
    await browser.click("learning-open");
    await browser.click("learning-resume", null, { topic: "kanban" });
    assert.match(browser.app.innerHTML, /Move work at your pace/);
    assert.equal(browser.savedState().kanban.enabled, false);
    await browser.click("learning-next");
    await browser.click("learning-open");
    await browser.click("learning-resume", null, { topic: "capture" });
    assert.match(browser.app.innerHTML, /id="capture-input"/);
    assert.equal(browser.savedState().tasks.length, 0);
    browser.listeners.get("keydown")({ key: "Escape" }); await delay(20);
    assert.match(browser.app.innerHTML, /id="capture-input"/); // Closing the tour preserves the form.
    assert.doesNotMatch(browser.app.innerHTML, /class="learning-overlay"/);
    assert.deepEqual(browser.stored("studioLearningGuide").pausedTopics, ["basics", "capture"]);
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

test("guide is deferred until privacy onboarding finishes and supports Vietnamese", async () => {
  const state = createDefaultState(); state.preferences.language = "vi";
  const browser = await bootApp(state);
  try {
    assert.doesNotMatch(browser.app.innerHTML, /class="learning-card"/);
    await browser.click("onboarding-defaults");
    assert.doesNotMatch(browser.app.innerHTML, /class="learning-card"/);
    await browser.click("finish-onboarding");
    assert.doesNotMatch(browser.app.innerHTML, /class="learning-overlay"/);
    await browser.click("learning-start");
    assert.match(browser.app.innerHTML, /Thêm một việc cần làm/);
    assert.match(browser.app.innerHTML, /Đóng hướng dẫn/);
    await browser.click("learning-open");
    assert.match(browser.app.innerHTML, /id="learning-center-title">Trợ giúp &(?:amp;)? hướng dẫn/);
    assert.match(browser.app.innerHTML, /Tắt lời mời/);
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

test("guide defers the usage-based AI invitation until later ordinary navigation", async () => {
  const state = createDefaultState(new Date(Date.now() - 8 * 86400000));
  state.profile.onboardingComplete = true;
  state.aiUsage.days = [{ date: localDateKey(new Date(Date.now() - 86400000)), count: 21 }];
  const browser = await bootApp(state);
  try {
    assert.match(browser.app.innerHTML, /Explain this screen/);
    assert.doesNotMatch(browser.app.innerHTML, /planning-prompt-title/);
    assert.equal(browser.savedState().aiUsage.promptSeenAt, null);
    await browser.click("learning-pause");
    assert.doesNotMatch(browser.app.innerHTML, /planning-prompt-title/);
    await browser.click("navigate", null, { view: "today" });
    assert.match(browser.app.innerHTML, /planning-prompt-title/);
    assert.equal(browser.savedState().preferences.planningEnabled, false);
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

test("advancing tips preserves surrounding forms and Not now does not chain another topic", async () => {
  const browser = await bootApp(newLearner());
  try {
    await browser.click("navigate", null, { view: "plan" });
    await browser.click("learning-start");
    const renders = browser.renderCount();
    await browser.click("learning-next");
    assert.equal(browser.renderCount(), renders);
    assert.match(browser.app.innerHTML, /Leave room in today/);
    await browser.click("learning-skip");
    assert.equal(browser.renderCount(), renders);
    assert.doesNotMatch(browser.app.innerHTML, /class="learning-card"/);
    await browser.click("learning-open");
    await browser.click("learning-resume", null, { topic: "kanban" });
    assert.match(browser.app.innerHTML, /Move work at your pace/);
    await browser.click("learning-pause");
    assert.doesNotMatch(browser.app.innerHTML, /class="learning-card"|Connect AI only if useful/);
    await browser.click("navigate", null, { view: "settings" });
    assert.doesNotMatch(browser.app.innerHTML, /class="learning-overlay"/);
    await browser.click("learning-start");
    assert.match(browser.app.innerHTML, /Connect AI only if useful/);
  } finally { browser.cleanup(); }
});

test("erase local data clears guide progress and its automatic-tip preference", async () => {
  const browser = await bootApp(newLearner(), { studioLearningGuide: { enabled: false, steps: { "basics.add": "done" }, pausedTopics: ["activity"] } });
  try {
    await browser.click("go-settings");
    await browser.click("ask-reset");
    await browser.click("confirm-reset");
    assert.deepEqual(browser.stored("studioLearningGuide"), { version: 2, enabled: true, steps: {}, pausedTopics: [] });
    assert.equal(browser.savedState().profile.onboardingComplete, false);
    assert.doesNotMatch(browser.app.innerHTML, /class="learning-card"/);
  } finally { browser.cleanup(); }
});
test("Activity review assigns reusable labels, preserves estimates and supports Undo through the UI",async()=>{
  const {state,activity}=activitySample(),browser=await bootApp(state,{studioActivity:activity});
  try{
    await browser.click("navigate",null,{view:"activity"});await browser.change("activity-filter",{value:"all"});assert.match(browser.app.innerHTML,/Recorded browser time/);assert.match(browser.app.innerHTML,/20 min/);assert.match(browser.app.innerHTML,/&lt;img/);assert.doesNotMatch(browser.app.innerHTML,/<img src=x/);
    await browser.click("activity-edit",null,{id:"review-1"});assert.match(browser.app.innerHTML,/activity-assignment-form/);
    await browser.submit("activity-assignment-form",{taskId:state.tasks[0].id,projectName:"Research",tagNames:"reading, notes",remember:"on"});
    let saved=browser.stored("studioActivity");assert.equal(saved.sessions[0].assignment.source,"manual");assert.equal(saved.sessions[0].confirmed,false);assert.equal(saved.rules.length,1);
    await browser.click("activity-undo",null,{id:saved.undo[0].id});saved=browser.stored("studioActivity");assert.equal(saved.sessions[0].assignment.source,"unknown");assert.equal(saved.rules.length,1);
    assert.equal(browser.networkCalls(),0);
  }finally{browser.cleanup();}
});
test("Vietnamese Activity and recovery controls preserve literal user text",async()=>{
  const {state,activity}=activitySample();state.preferences.language="vi";
  state.schedule=[{id:"missed",taskId:state.tasks[0].id,startAt:new Date(Date.now()-120*60000).toISOString(),endAt:new Date(Date.now()-60*60000).toISOString(),status:"planned"}];
  const browser=await bootApp(state,{studioActivity:activity});
  try{
    await browser.click("navigate",null,{view:"activity"});await browser.change("activity-filter",{value:"all"});assert.match(browser.app.innerHTML,/Thời gian trình duyệt đã ghi/);assert.match(browser.app.innerHTML,/<h3>Activity<\/h3>/);assert.match(browser.app.innerHTML,/Cài đặt ghi nhận/);
    await browser.click("navigate",null,{view:"plan",planView:"schedule"});assert.match(browser.app.innerHTML,/Xếp lại việc bị trễ/);assert.match(browser.app.innerHTML,/<span>Activity<\/span>/);
    await browser.click("go-settings");assert.match(browser.app.innerHTML,/Bật thông báo trên máy/);assert.match(browser.app.innerHTML,/Bắt đầu giờ yên lặng/);
  }finally{browser.cleanup();}
});
test("recovery review, Apply and Undo work from the Schedule UI",async()=>{
  const {state}=activitySample();state.preferences.dayStart="00:00";state.preferences.dayEnd="23:59";
  state.schedule=[{id:"missed",taskId:state.tasks[0].id,startAt:new Date(Date.now()-120*60000).toISOString(),endAt:new Date(Date.now()-60*60000).toISOString(),status:"planned"}];
  const browser=await bootApp(state);
  try{
    await browser.click("navigate",null,{view:"plan",planView:"schedule"});assert.match(browser.app.innerHTML,/Recover delayed work/);
    await browser.submit("activity-recovery-form",{[`recover-${state.tasks[0].id}`]:"on",[`remaining-${state.tasks[0].id}`]:"20"});
    const p=browser.stored("studioRecovery").pending;assert.ok(p.blocks.length);assert.match(browser.app.innerHTML,/Apply recovery/);
    await browser.click("activity-recovery-apply",null,{id:p.id});assert.equal(browser.savedState().schedule.find(b=>b.id==="missed").status,"skipped");
    await browser.click("activity-recovery-undo",null,{id:p.id});assert.equal(browser.savedState().schedule.find(b=>b.id==="missed").status,"planned");assert.equal(browser.savedState().schedule.length,1);
  }finally{browser.cleanup();}
});

test("side-panel application bootstraps and renders the preview dashboard", async () => {
  const browser = await bootApp();
  try {
    assert.match(browser.app.innerHTML, /Good (morning|afternoon|evening)/);
    assert.match(browser.app.innerHTML, /id="quick-task-form"/);
    assert.doesNotMatch(browser.app.innerHTML, /Gemini connection/);
    assert.match(browser.app.innerHTML, /Open Smart Capture/);
    assert.ok(browser.listeners.has("click"));
    assert.ok(browser.listeners.has("submit"));
  } finally {
    browser.cleanup();
  }
});

test("memory editor keeps edits unsaved across renders, saves locally, and reloads", async () => {
  let browser = await bootApp();
  try {
    await browser.click("go-settings");
    assert.match(browser.app.innerHTML, /Custom instructions/);
    assert.doesNotMatch(browser.app.innerHTML, /id="memory-enabled"[^>]*checked/);
    await browser.change("memory-enabled", { checked: true });
    assert.match(browser.app.innerHTML, new RegExp(`id="memory-instructions"[^>]*maxlength="${MAX_CUSTOM_INSTRUCTIONS_LENGTH}"`));
    assert.match(browser.app.innerHTML, /Saving is local/);
    const text = 'Be concise. </textarea><script>alert("example")</script>\n' + "Giữ hướng dẫn rõ ràng.\n".repeat(200) + "Last preference.";
    assert.ok(text.length > 2000);
    browser.input("memory-instructions", text);
    assert.equal(browser.savedState().memory.customInstructions, "");
    assert.equal(browser.fields.get("#memory-count").textContent, `${text.length} / ${MAX_CUSTOM_INSTRUCTIONS_LENGTH}`);
    assert.match(browser.fields.get("#memory-draft-status").textContent, /Unsaved changes/);
    assert.equal(browser.fields.get("#memory-discard").disabled, false);
    await browser.click("set-theme", "paper");
    assert.equal(browser.savedState().memory.customInstructions, "");
    assert.match(browser.app.innerHTML, /&lt;\/textarea&gt;&lt;script&gt;/);
    assert.doesNotMatch(browser.app.innerHTML, /<script>alert/);
    assert.match(browser.app.innerHTML, /name="memoryEnabled" checked/);
    await browser.submit("memory-form", { customInstructions: text, memoryEnabled: "on" });
    const saved = browser.savedState();
    assert.equal(saved.memory.customInstructions, text);
    assert.equal(saved.memory.enabled, true);
    assert.equal(browser.networkCalls(), 0);
    assert.match(browser.app.innerHTML, /No unsaved changes/);
    assert.match(browser.toast.innerHTML, /Instructions saved/);
    browser.cleanup();
    browser = await bootApp(saved);
    await browser.click("go-settings");
    assert.equal(browser.savedState().memory.customInstructions, text);
    assert.match(browser.app.innerHTML, /&lt;\/textarea&gt;&lt;script&gt;/);
    assert.match(browser.app.innerHTML, /name="memoryEnabled" checked/);
  } finally { browser.cleanup(); }
});

test("disable keeps saved text and clear requires confirmation", async () => {
  const browser = await bootApp();
  try {
    await browser.click("go-settings");
    await browser.submit("memory-form", { customInstructions: "Use brief explanations.", memoryEnabled: "on" });
    await browser.change("memory-enabled", { checked: false });
    assert.equal(browser.savedState().memory.enabled, true);
    await browser.submit("memory-form", { customInstructions: "Use brief explanations." });
    assert.equal(browser.savedState().memory.enabled, false);
    assert.equal(browser.savedState().memory.customInstructions, "Use brief explanations.");
    assert.match(browser.app.innerHTML, /Off · text kept/);
    browser.input("memory-instructions", "Unsaved replacement.");
    await browser.click("discard-memory-draft");
    assert.doesNotMatch(browser.app.innerHTML, /Unsaved replacement/);
    await browser.click("ask-clear-memory");
    assert.match(browser.app.innerHTML, /does not delete previous Gemini responses/);
    assert.equal(browser.savedState().memory.customInstructions, "Use brief explanations.");
    await browser.click("close-modal");
    assert.equal(browser.savedState().memory.customInstructions, "Use brief explanations.");
    await browser.click("ask-clear-memory");
    await browser.click("confirm-clear-memory");
    assert.equal(browser.savedState().memory.customInstructions, "");
    assert.equal(browser.savedState().memory.enabled, false);
    assert.match(browser.app.innerHTML, /status-chip ">Empty/);
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

test("storage errors retain memory edits and a later save can recover", async () => {
  const browser = await bootApp();
  try {
    await browser.click("go-settings");
    browser.rejectSaves(true);
    await browser.submit("memory-form", { customInstructions: "Keep this draft.", memoryEnabled: "on" });
    assert.equal(browser.savedState().memory.customInstructions, "");
    assert.match(browser.app.innerHTML, /Keep this draft/);
    assert.match(browser.app.innerHTML, /Unsaved changes/);
    assert.match(browser.toast.innerHTML, /Test storage is full/);
    browser.rejectSaves(false);
    await browser.submit("memory-form", { customInstructions: "Keep this draft.", memoryEnabled: "on" });
    assert.equal(browser.savedState().memory.customInstructions, "Keep this draft.");
    await browser.submit("memory-form", { customInstructions: "x".repeat(MAX_CUSTOM_INSTRUCTIONS_LENGTH + 1), memoryEnabled: "on" });
    assert.equal(browser.savedState().memory.customInstructions, "Keep this draft.");
    assert.match(browser.toast.innerHTML, new RegExp(`${MAX_CUSTOM_INSTRUCTIONS_LENGTH} characters`));
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

test("replaying onboarding preserves saved memory, while erase resets it", async () => {
  const browser = await bootApp();
  try {
    await browser.click("go-settings");
    await browser.submit("memory-form", { customInstructions: "Preserve my preferences.", memoryEnabled: "on" });
    const memory = browser.savedState().memory;
    await browser.click("replay-onboarding");
    assert.deepEqual(browser.savedState().memory, memory);
    await browser.click("confirm-reset");
    assert.deepEqual(browser.savedState().memory, { enabled: false, customInstructions: "", updatedAt: null });
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

test("restoring memory is disclosed and replaces both saved text and unsaved edits", async () => {
  const browser = await bootApp();
  try {
    await browser.click("go-settings");
    await browser.submit("memory-form", { customInstructions: "Old preferences.", memoryEnabled: "on" });
    browser.input("memory-instructions", "Unsaved preferences.");
    const imported = updateMemory(browser.savedState(), { enabled: true, customInstructions: "Restored preferences." });
    await browser.change("backup-input", { files: [{ async text() { return JSON.stringify(createBackup(imported)); } }] });
    assert.match(browser.app.innerHTML, /custom instructions will be replaced/);
    assert.match(browser.app.innerHTML, /on and will be sent with new Gemini requests/);
    assert.equal(browser.savedState().memory.customInstructions, "Old preferences.");
    await browser.click("confirm-import");
    await browser.click("go-settings");
    assert.match(browser.app.innerHTML, /Restored preferences/);
    assert.doesNotMatch(browser.app.innerHTML, /Unsaved preferences|Old preferences/);
    assert.equal(browser.savedState().memory.customInstructions, "Restored preferences.");
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

test("reflection and proposal screens disclose only saved, enabled memory", async () => {
  const browser = await bootApp();
  try {
    await browser.click("go-settings");
    browser.input("memory-instructions", "Unsaved preferences.");
    await browser.change("memory-enabled", { checked: true });
    await browser.click("navigate", null, { view: "insights" });
    assert.match(browser.app.innerHTML, /Custom instructions are not sent/);
    await browser.click("go-settings");
    await browser.submit("memory-form", { customInstructions: "Saved preferences.", memoryEnabled: "on" });
    await browser.click("navigate", null, { view: "insights" });
    assert.match(browser.app.innerHTML, /Saved custom instructions are also sent/);
    assert.doesNotMatch(browser.app.innerHTML, /Task titles and notes stay here/);
    await browser.click("navigate", null, { view: "plan" });
    await browser.click("plan-view", "schedule");
    await browser.click("propose-schedule");
    assert.match(browser.app.innerHTML, /Gemini explanation sends/);
    assert.match(browser.app.innerHTML, /Saved custom instructions are also sent/);
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

test("personalized onboarding ends with optional granular privacy choices", async () => {
  const browser = await bootApp(createDefaultState(new Date("2026-09-04T08:00:00Z")));
  try {
    assert.match(browser.app.innerHTML, /Plan your time/);
    await browser.click("onboarding-advance");
    assert.match(browser.app.innerHTML, /How do you manage time/);
    assert.doesNotMatch(browser.app.innerHTML, /choice selected/);
    assert.match(browser.app.innerHTML, /data-action="onboarding-advance" disabled/);

    await browser.click("choose-experience", "beginner");
    assert.match(browser.app.innerHTML, /How do you manage time/);
    assert.equal(browser.savedState().profile.onboardingStep, 1);
    assert.equal(browser.savedState().profile.experience, "beginner");
    assert.doesNotMatch(browser.app.innerHTML, /data-action="onboarding-advance" disabled/);

    await browser.click("onboarding-advance");
    assert.match(browser.app.innerHTML, /Main goal/);
    assert.match(browser.app.innerHTML, /data-action="onboarding-advance" disabled/);
    await browser.click("choose-aim", "deep-work");
    assert.equal(browser.savedState().profile.onboardingStep, 2);
    assert.equal(browser.savedState().profile.aim, "deep-work");

    await browser.click("onboarding-advance");
    assert.match(browser.app.innerHTML, /Choose what Stuđiô can access/);
    assert.match(browser.app.innerHTML, /data-privacy="tracking"/);
    assert.doesNotMatch(browser.app.innerHTML, /data-action="finish-onboarding" disabled/);
    await browser.click("finish-onboarding");
    assert.equal(browser.savedState().profile.onboardingComplete, true);
    assert.equal(browser.savedState().profile.privacyReviewVersion, 1);
    assert.doesNotMatch(browser.app.innerHTML, /Gemini connection/);
    assert.doesNotMatch(browser.app.innerHTML, /id="gemini-form"/);
  } finally {
    browser.cleanup();
  }
});

test("Eisenhower, today selection, and budget changes persist without AI", async () => {
  let browser = await bootApp();
  try {
    await browser.click("open-matrix");
    assert.match(browser.app.innerHTML, /Eisenhower priorities/);
    assert.match(browser.app.innerHTML, /Needs sorting/);
    const task = browser.savedState().tasks[0];
    await browser.change(`quadrant-${task.id}`, { dataset: { quadrantTask: task.id }, value: "do" });
    assert.equal(browser.savedState().tasks[0].important, true);
    assert.equal(browser.savedState().tasks[0].urgency, "urgent");
    await browser.click("toggle-today-task", null, { taskId: task.id });
    assert.ok(browser.savedState().dayPlans[0].taskIds.includes(task.id));
    await browser.submit("budget-form", { availableMinutes: "15" });
    assert.equal(browser.savedState().dayPlans[0].availableMinutes, 15);
    assert.match(browser.app.innerHTML, /over/);
    const saved = browser.savedState();
    assert.equal(browser.networkCalls(), 0);
    browser.cleanup(); browser = await bootApp(saved);
    await browser.click("open-matrix");
    assert.match(browser.app.innerHTML, /Picked for today/);
    assert.equal(browser.savedState().tasks[0].important, true);
  } finally { browser.cleanup(); }
});

test("automatic budget settings, source disclosure and explicit manual reset persist without network calls", async () => {
  const now = new Date();
  let { state, task } = addTask(createDefaultState(now), { title: "Keep today's task", durationMinutes: 180 }, now);
  state.profile.onboardingComplete = true;
  for (let day = 1; day <= 3; day++) {
    const ended = new Date(now); ended.setDate(ended.getDate() - day);
    state.dayPlans.push({ date: localDateKey(ended), availableMinutes: 180, taskIds: [], budgetSource: "manual" });
    state.sessions.push({ id: `past-${day}`, endedAt: ended.toISOString(), startedAt: new Date(ended.getTime() - 3600000).toISOString(), focusedSeconds: 3600, plannedSeconds: 3600, outcome: "completed" });
  }
  state = saveDayPlan(state, { availableMinutes: 0, taskIds: [task.id] }, now);
  let browser = await bootApp(state);
  try {
    await browser.click("go-settings");
    assert.match(browser.app.innerHTML, /Blends recent budgets and recorded focus/);
    await browser.change("auto-daily-budget", { checked: true });
    assert.equal(browser.savedState().preferences.autoDailyBudget, true);
    await browser.click("navigate", null, { view: "today" });
    assert.match(browser.app.innerHTML, /Manual for today/);
    assert.match(browser.app.innerHTML, /Recent budgets · 3 days/);
    assert.match(browser.app.innerHTML, /Focus history \+ breaks · 3 days/);
    assert.match(browser.app.innerHTML, /id="budget-minutes"[^>]*value="0"/);
    await browser.click("use-automatic-budget");
    const plan = browser.savedState().dayPlans.find(item => item.date === localDateKey(now));
    assert.equal(plan.budgetSource, "automatic");
    assert.equal(plan.availableMinutes, 143);
    assert.deepEqual(plan.taskIds, [task.id]);
    assert.match(browser.toast.innerHTML, /Automatic budget restored/);
    assert.match(browser.app.innerHTML, /Your plan exceeds today's budget/);
    assert.equal(browser.networkCalls(), 0);
    const saved = browser.savedState();
    browser.cleanup(); browser = await bootApp(saved);
    assert.match(browser.app.innerHTML, /id="budget-minutes"[^>]*value="143"/);
    assert.doesNotMatch(browser.app.innerHTML, /data-action="use-automatic-budget"/);
    await browser.submit("budget-form", { availableMinutes: "15" });
    assert.match(browser.app.innerHTML, /Manual for today/);
    assert.equal(browser.savedState().dayPlans.find(item => item.date === localDateKey(now)).availableMinutes, 15);
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

test("Vietnamese automatic-budget controls retain overrides on a failed save", async () => {
  let state = createDefaultState(); state.profile.onboardingComplete = true;
  state.preferences.language = "vi"; state.preferences.autoDailyBudget = true;
  state = saveDayPlan(state, { availableMinutes: 0 });
  const browser = await bootApp(state);
  try {
    assert.match(browser.app.innerHTML, /Dùng ước tính/);
    assert.match(browser.app.innerHTML, /Cơ sở ước tính/);
    browser.rejectSaves(true);
    await browser.click("use-automatic-budget");
    assert.match(browser.toast.innerHTML, /Test storage is full/);
    assert.equal(browser.savedState().dayPlans[0].budgetSource, "manual");
    assert.equal(browser.savedState().dayPlans[0].availableMinutes, 0);
    browser.rejectSaves(false);
    await browser.click("use-automatic-budget");
    assert.match(browser.toast.innerHTML, /Đã dùng lại ước tính tự động/);
    assert.equal(browser.savedState().dayPlans[0].budgetSource, "automatic");
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

test("Pomodoro UI starts, pauses, resumes after reload, and rejects replacing a paused timer", async () => {
  let browser = await bootApp();
  try {
    await browser.click("open-focus", null, { mode: "pomodoro" });
    assert.match(browser.app.innerHTML, /Start Pomodoro/);
    assert.match(browser.app.innerHTML, /Long break every/);
    await browser.submit("focus-form", { mode: "pomodoro", durationMinutes: "25", breakMinutes: "5", longBreakMinutes: "15", longBreakEvery: "4", cycles: "4" });
    assert.match(browser.app.innerHTML, /Pomodoro · 1 \/ 4/);
    assert.equal(browser.savedState().focus.mode, "pomodoro");
    await browser.click("pause-focus");
    assert.equal(browser.savedState().focus.status, "paused");
    await browser.click("minimize-timer");
    assert.match(browser.app.innerHTML, /Return to timer/);
    await browser.click("open-focus", null, { mode: "single" });
    assert.match(browser.toast.innerHTML, /current timer/);
    assert.equal(browser.savedState().focus.status, "paused");
    const saved = browser.savedState();
    assert.equal(browser.networkCalls(), 0);
    browser.cleanup(); browser = await bootApp(saved);
    assert.match(browser.app.innerHTML, /Focus paused/);
    await browser.click("resume-focus");
    assert.equal(browser.savedState().focus.status, "running");
    await browser.click("ask-stop");
    await browser.click("confirm-stop");
    assert.equal(browser.savedState().sessions.length, 1);
    assert.match(browser.app.innerHTML, /0 \/ 4 Pomodoro rounds/);
  } finally { browser.cleanup(); }
});

test("reopening an expired Pomodoro shows a waiting break and never starts it automatically", async () => {
  const { startFocus } = await import("../src/core/timer.js");
  const initial = createDefaultState(); initial.profile.onboardingComplete = true;
  const saved = startFocus(initial, { mode: "pomodoro", durationMinutes: 1, cycles: 2 }, new Date(Date.now() - 120000));
  const browser = await bootApp(saved);
  try {
    assert.match(browser.app.innerHTML, /Short break ready/);
    assert.match(browser.app.innerHTML, /Start break/);
    assert.equal(browser.savedState().sessions.length, 1);
    await browser.click("next-phase");
    assert.equal(browser.savedState().focus.phase, "break");
    assert.equal(browser.savedState().focus.status, "running");
    await browser.click("skip-break");
    assert.match(browser.app.innerHTML, /Start next focus/);
    assert.equal(browser.savedState().sessions.length, 1);
    await browser.click("next-phase");
    assert.equal(browser.savedState().focus.phase, "focus");
    assert.equal(browser.savedState().focus.completedCycles, 1);
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

test("Planning assistance stays in Settings and manual scheduling opens independently", async () => {
  const state = createDefaultState(); state.profile.onboardingComplete = true;
  const browser = await bootApp(state);
  try {
    assert.doesNotMatch(browser.app.innerHTML, /planning-enabled|planning-mode|guide-help-form/);
    await browser.click("go-settings");
    assert.match(browser.app.innerHTML, /id="planning-enabled"/);
    assert.doesNotMatch(browser.app.innerHTML, /guide-help-form/);
    await browser.change("planning-enabled", { checked: true });
    assert.match(browser.app.innerHTML, /guide-help-form/);
    await browser.click("navigate", null, { view: "today" });
    assert.doesNotMatch(browser.app.innerHTML, /guide-help-form|planning-mode/);
    await browser.submit("task-form", { title: "Today", durationMinutes: "25" });
    await browser.click("schedule-task", null, { taskId: browser.savedState().tasks[0].id });
    assert.match(browser.app.innerHTML, /manual-plan-title/);
    assert.match(browser.app.innerHTML, /guided-plan-form/);
    assert.doesNotMatch(browser.app.innerHTML, /guide-help-form/);
  } finally { browser.cleanup(); }
});

test("language switch persists and preserves user titles, notes and instruction text", async () => {
  const state = createDefaultState(); state.profile.onboardingComplete = true;
  const browser = await bootApp(state);
  try {
    await browser.submit("task-form", { title: "Today", notes: "Settings", durationMinutes: "25" });
    await browser.change("language", { value: "vi", dataset: { preference: "language" } });
    assert.equal(browser.savedState().preferences.language, "vi");
    assert.match(browser.app.innerHTML, /Hôm nay/);
    assert.match(browser.app.innerHTML, /Cài đặt/);
    assert.match(browser.app.innerHTML, /class="task-title">Today/);
    await browser.click("open-matrix");
    assert.match(browser.app.innerHTML, /Chưa phân loại/);
    assert.match(browser.app.innerHTML, /AI tự phân loại/);
    await browser.click("edit-task", null, { taskId: browser.savedState().tasks[0].id });
    assert.match(browser.app.innerHTML, /name="notes"[^>]*>Settings<\/textarea>/);
    assert.match(browser.app.innerHTML, /value="Today"/);
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

test("eligible planning prompt appears once, respects dismissal, and enables only through the button", async () => {
  const now = new Date(), start = new Date(now.getTime() - 8 * 86400000), yesterday = new Date(now.getTime() - 86400000);
  const state = createDefaultState(start); state.profile.onboardingComplete = true;
  state.aiUsage.days = [{ date: `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`, count: 21 }];
  const tipsOff = { studioLearningGuide: { enabled: false } };
  let browser = await bootApp(state, tipsOff);
  try {
    assert.match(browser.app.innerHTML, /planning-prompt-title/);
    assert.equal(browser.savedState().preferences.planningEnabled, false);
    await browser.click("close-modal");
    assert.doesNotMatch(browser.app.innerHTML, /planning-prompt-title/);
    const dismissed = browser.savedState(); browser.cleanup(); browser = await bootApp(dismissed, tipsOff);
    assert.doesNotMatch(browser.app.innerHTML, /planning-prompt-title/);
    browser.cleanup(); browser = await bootApp(state, tipsOff);
    await browser.click("enable-planning");
    assert.equal(browser.savedState().preferences.planningEnabled, true);
    assert.match(browser.app.innerHTML, /guide-help-form/);
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

function kanbanSample(count = 3) {
  let state = createDefaultState(); state.profile.onboardingComplete = true;
  for (let index = 0; index < count; index++) state = addTask(state, { id: `k${index}`, title: `Kanban task ${index}`, durationMinutes: 25 }).state;
  return state;
}

test("Kanban offer is optional: Eisenhower and budget default, preview is read-only, dismissal persists", async () => {
  let browser = await bootApp(kanbanSample());
  try {
    assert.doesNotMatch(browser.app.innerHTML, /Try Kanban|kanban-offer|data-action="kanban-preview"/);
    await browser.click("navigate", null, { view: "plan" });
    assert.match(browser.app.innerHTML, /data-value="matrix" aria-pressed="true"/);
    assert.match(browser.app.innerHTML, /Needs sorting/);
    assert.match(browser.app.innerHTML, /id="budget-form"/);
    assert.match(browser.app.innerHTML, /Try Kanban/);
    const before = browser.savedState();
    await browser.click("kanban-preview");
    const dialog = browser.app.innerHTML.split('aria-labelledby="kanban-modal-title"')[1];
    assert.match(dialog, /Read-only preview/);
    assert.doesNotMatch(dialog, /data-action="(?:kanban-move|kanban-undo|complete-task|open-focus)"/);
    assert.deepEqual(browser.savedState(), before);
    await browser.click("kanban-dismiss");
    assert.equal(browser.savedState().kanban.enabled, false);
    assert.equal(browser.savedState().kanban.offerDismissed, true);
    assert.doesNotMatch(browser.app.innerHTML, /Try Kanban/);
    const saved = browser.savedState(); browser.cleanup(); browser = await bootApp(saved);
    await browser.click("navigate", null, { view: "plan" });
    assert.doesNotMatch(browser.app.innerHTML, /Try Kanban/);
    await browser.click("go-settings");
    assert.match(browser.app.innerHTML, /data-action="kanban-ask-enable"/);
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

test("Kanban requires explicit enable, shows reasons and Undo, and turn-off keeps history and defaults", async () => {
  const initial = toggleTodayTask(kanbanSample(), "k0");
  const browser = await bootApp(initial);
  try {
    await browser.click("kanban-ask-enable");
    assert.equal(browser.savedState().kanban.enabled, false);
    assert.match(browser.app.innerHTML, /Enable Kanban\?/);
    await browser.click("kanban-enable");
    assert.equal(browser.savedState().kanban.enabled, true);
    assert.equal(kanbanItem(browser.savedState(), "k0").stage, "ready");
    assert.match(browser.app.innerHTML, /data-value="kanban" aria-pressed="true"/);
    assert.match(browser.app.innerHTML, /Auto move: Picked for today/);
    assert.match(browser.app.innerHTML, /id="budget-form"/);
    const changeId = browser.savedState().kanban.changes.at(-1).id;
    await browser.click("kanban-undo", null, { changeId });
    assert.equal(kanbanItem(browser.savedState(), "k0").stage, "backlog");
    assert.equal(kanbanItem(browser.savedState(), "k0").manualHold, true);
    assert.match(browser.app.innerHTML, /Undone/);
    await browser.click("kanban-allow-auto", null, { taskId: "k0" });
    assert.equal(kanbanItem(browser.savedState(), "k0").stage, "ready");
    const history = browser.savedState().kanban.changes;
    await browser.click("go-settings");
    await browser.click("kanban-disable");
    assert.equal(browser.savedState().kanban.enabled, false);
    assert.deepEqual(browser.savedState().kanban.changes, history);
    await browser.click("navigate", null, { view: "plan" });
    assert.match(browser.app.innerHTML, /data-value="matrix" aria-pressed="true"/);
    assert.doesNotMatch(browser.app.innerHTML, /data-value="kanban"/);
    assert.deepEqual(browser.savedState().tasks, initial.tasks);
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

test("Kanban manual starts guard WIP; blocker save failures retain drafts and blocked work still counts", async () => {
  const browser = await bootApp(applyKanbanAction(kanbanSample(), "enable"));
  try {
    await browser.click("kanban-open");
    for (const taskId of ["k0", "k1"]) await browser.click("kanban-move", null, { taskId, stage: "doing" });
    assert.equal(kanbanWip(browser.savedState()).length, 2);
    assert.equal(browser.savedState().focus.status, "idle");
    await browser.click("kanban-move", null, { taskId: "k2", stage: "doing" });
    assert.match(browser.app.innerHTML, /Start beyond the WIP limit/);
    assert.equal(kanbanItem(browser.savedState(), "k2").stage, "backlog");
    await browser.click("close-modal");
    await browser.click("kanban-block", null, { taskId: "k0" });
    browser.rejectSaves(true);
    await browser.submit("kanban-block-form", { reason: 'Wait for <review> & "sign-off"' });
    assert.equal(kanbanItem(browser.savedState(), "k0").blockedReason, "");
    assert.match(browser.app.innerHTML, /Wait for &lt;review&gt; &amp; &quot;sign-off&quot;/);
    assert.match(browser.toast.innerHTML, /Test storage is full/);
    browser.rejectSaves(false);
    await browser.submit("kanban-block-form", { reason: "Wait for review" });
    assert.equal(kanbanWip(browser.savedState()).length, 2);
    assert.match(browser.app.innerHTML, /Blocked<\/strong> · Wait for review/);
    await browser.click("kanban-move", null, { taskId: "k2", stage: "doing" });
    await browser.click("kanban-confirm-start");
    assert.equal(kanbanWip(browser.savedState()).length, 3);
    assert.equal(browser.savedState().focus.status, "idle");
    await browser.click("kanban-unblock", null, { taskId: "k0" });
    assert.equal(kanbanItem(browser.savedState(), "k0").blockedReason, "");
    assert.equal(kanbanWip(browser.savedState()).length, 3);
    await browser.click("complete-task", null, { taskId: "k0" });
    assert.equal(browser.savedState().tasks[0].status, "done");
    assert.equal(kanbanWip(browser.savedState()).length, 2);
    assert.match(browser.app.innerHTML, /Done · 1/);
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

test("task timer sync explains Doing; Undo keeps timer running; session end asks before task completion", async () => {
  const initial = applyKanbanAction(toggleTodayTask(kanbanSample(), "k0"), "enable");
  const browser = await bootApp(initial);
  try {
    await browser.click("open-focus", null, { taskId: "k0" });
    assert.match(browser.app.innerHTML, /Kanban WIP: 0 \/ 2/);
    await browser.submit("focus-form", { taskId: "k0", mode: "single", durationMinutes: "25" });
    assert.equal(kanbanItem(browser.savedState(), "k0").stage, "doing");
    assert.match(browser.toast.innerHTML, /Moved to Doing: task timer started/);
    const timer = browser.savedState().focus, changeId = browser.savedState().kanban.changes.at(-1).id;
    await browser.click("minimize-timer");
    await browser.click("kanban-open");
    await browser.click("kanban-undo", null, { changeId });
    assert.deepEqual(browser.savedState().focus, timer);
    assert.equal(kanbanItem(browser.savedState(), "k0").stage, "ready");
    assert.equal(kanbanItem(browser.savedState(), "k0").manualHold, true);
    await browser.click("return-timer");
    await browser.click("ask-stop");
    await browser.click("confirm-stop");
    assert.match(browser.app.innerHTML, /Session ended. The task is still open/);
    assert.equal(browser.savedState().tasks[0].status, "inbox");
    await browser.click("complete-task", null, { taskId: "k0" });
    assert.equal(browser.savedState().tasks[0].status, "done");
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

test("Kanban rule switches and limits persist and invalid settings leave stored values unchanged", async () => {
  const browser = await bootApp(toggleTodayTask(kanbanSample(), "k0"));
  try {
    await browser.click("go-settings");
    await browser.change("", { type: "checkbox", checked: false, dataset: { kanbanSetting: "autoReady" } });
    await browser.change("kanban-wip", { value: "1", dataset: { kanbanSetting: "wipLimit" } });
    await browser.change("kanban-age", { value: "5", dataset: { kanbanSetting: "ageDays" } });
    await browser.click("kanban-ask-enable");
    assert.match(browser.app.innerHTML, /WIP limit: 1/);
    await browser.click("kanban-enable");
    assert.equal(kanbanItem(browser.savedState(), "k0").stage, "backlog");
    await browser.click("go-settings");
    await browser.change("", { type: "checkbox", checked: true, dataset: { kanbanSetting: "autoReady" } });
    assert.equal(kanbanItem(browser.savedState(), "k0").stage, "ready");
    await browser.change("", { type: "checkbox", checked: false, dataset: { kanbanSetting: "autoStart" } });
    await browser.change("", { type: "checkbox", checked: false, dataset: { kanbanSetting: "showHints" } });
    await browser.change("kanban-wip", { value: "0", dataset: { kanbanSetting: "wipLimit" } });
    assert.equal(browser.savedState().kanban.wipLimit, 1);
    assert.equal(browser.savedState().kanban.ageDays, 5);
    assert.match(browser.toast.innerHTML, /within the shown range/);
    await browser.submit("focus-form", { taskId: "k0", durationMinutes: "25" });
    assert.equal(browser.savedState().focus.status, "running");
    assert.equal(kanbanItem(browser.savedState(), "k0").stage, "ready");
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

test("Vietnamese Kanban controls work and leave user titles and blockers unchanged", async () => {
  const state = kanbanSample(); state.preferences.language = "vi"; state.tasks[0].title = "Ready";
  const browser = await bootApp(state);
  try {
    await browser.click("open-matrix");
    assert.match(browser.app.innerHTML, /Thử Kanban/);
    await browser.click("kanban-preview");
    assert.match(browser.app.innerHTML, /Chỉ xem thử, không thay đổi công việc/);
    assert.match(browser.app.innerHTML, /<h4>Ready<\/h4>/);
    assert.match(browser.app.innerHTML, /Giữ mặc định/);
    await browser.click("kanban-enable");
    assert.match(browser.app.innerHTML, /Sẵn sàng · 0/);
    assert.match(browser.app.innerHTML, /Lịch sử tự chuyển và hoàn tác/);
    assert.doesNotMatch(browser.app.innerHTML, />Automation rules<|>Backlog ·|>Doing ·|Flow measures/);
    await browser.click("kanban-move", null, { taskId: "k0", stage: "doing" });
    await browser.click("kanban-block", null, { taskId: "k0" });
    assert.match(browser.app.innerHTML, /Việc này đang vướng gì/);
    await browser.submit("kanban-block-form", { reason: "Waiting for approval" });
    assert.match(browser.app.innerHTML, /Đang vướng<\/strong> · Waiting for approval/);
    assert.equal(browser.savedState().tasks[0].title, "Ready");
    await browser.click("go-settings");
    assert.match(browser.app.innerHTML, /Giới hạn việc đang làm/);
    assert.match(browser.app.innerHTML, /Tắt Kanban/);
    await browser.click("kanban-disable");
    assert.equal(browser.savedState().kanban.enabled, false);
    assert.equal(browser.networkCalls(), 0);
  } finally { browser.cleanup(); }
});

test("Today proposal review navigates to Schedule despite the new Eisenhower default", async () => {
  const now = new Date();
  const state = saveProposal(kanbanSample(), proposeSchedule(kanbanSample(), now));
  const browser = await bootApp(state);
  try {
    assert.match(browser.app.innerHTML, /data-view="plan" data-plan-view="schedule">Review proposal/);
    await browser.click("navigate", null, { view: "plan", planView: "schedule" });
    assert.match(browser.app.innerHTML, /data-value="schedule" aria-pressed="true"/);
    assert.match(browser.app.innerHTML, /data-action="apply-proposal"/);
  } finally { browser.cleanup(); }
});

for (const language of ["en", "vi"]) test(`simple onboarding and one-click default focus work in ${language}`, async () => {
  const state = createDefaultState(); state.preferences.language=language;
  const browser = await bootApp(state);
  try {
    await browser.click("onboarding-defaults");
    assert.match(browser.app.innerHTML,language==="vi"?/Chọn dữ liệu/:/Choose what Stuđiô can access/);
    assert.doesNotMatch(browser.app.innerHTML,/data-privacy="[^"]+"[^>]*checked/);
    await browser.click("finish-onboarding");
    await browser.submit("quick-task-form",{title:"Today <task>"});
    const saved=browser.savedState();assert.equal(saved.tasks.length,1);assert.equal(saved.tasks[0].title,"Today <task>");
    assert.equal(saved.tasks[0].durationMinutes,25);assert.match(browser.app.innerHTML,/Today &lt;task&gt;/);
    await browser.submit("quick-focus-form",{durationMinutes:"15"});
    assert.equal(browser.savedState().focus.status,"running");assert.equal(browser.savedState().focus.taskId,saved.tasks[0].id);
    assert.equal(browser.savedState().focus.plannedSeconds,900);assert.doesNotMatch(browser.app.innerHTML,/id="focus-form"/);
    await browser.click("confirm-stop");assert.equal(browser.savedState().tasks[0].status,"inbox");
    assert.match(browser.app.innerHTML,/data-action="complete-task"/);assert.match(browser.app.innerHTML,/data-action="close-post-session"/);
    assert.equal(browser.networkCalls(),0);
  } finally { browser.cleanup(); }
});

test("failed quick add keeps its draft; blank tasks and invalid timers are rejected", async () => {
  const state=createDefaultState();state.profile.onboardingComplete=true;
  const browser=await bootApp(state);
  try {
    await browser.submit("quick-task-form",{title:"   "});assert.equal(browser.savedState().tasks.length,0);
    browser.rejectSaves(true);await browser.submit("quick-task-form",{title:"Keep this draft"});
    assert.match(browser.app.innerHTML,/value="Keep this draft"/);assert.equal(browser.savedState().tasks.length,0);
    browser.rejectSaves(false);await browser.submit("quick-task-form",{title:"Keep this draft"});
    assert.equal(browser.savedState().tasks.length,1);
    for(const durationMinutes of ["0","-1","481","NaN","1.5"])await browser.submit("quick-focus-form",{durationMinutes});
    assert.equal(browser.savedState().focus.status,"idle");
    await browser.submit("quick-focus-form",{durationMinutes:"5"});await browser.click("pause-focus");
    const before=browser.savedState().focus;await browser.submit("quick-focus-form",{durationMinutes:"25"});
    assert.deepEqual(browser.savedState().focus,before);
  } finally { browser.cleanup(); }
});

test("task detail fields are optional to open but existing and AI drafts show their details", async () => {
  const browser=await bootApp();
  try {
    await browser.click("new-task");assert.match(browser.app.innerHTML,/<details class="task-details" >/);
    await browser.submit("task-form",{title:"Details later",durationMinutes:"25"});
    const task=browser.savedState().tasks.find(t=>t.title==="Details later");
    await browser.click("edit-task",null,{taskId:task.id});assert.match(browser.app.innerHTML,/<details class="task-details" open>/);
  } finally { browser.cleanup(); }
});

test("Today offers delayed recovery without changing the plan on view", async () => {
  const {state}=activitySample();state.schedule=[{id:"past",taskId:state.tasks[0].id,startAt:new Date(Date.now()-120*60000).toISOString(),endAt:new Date(Date.now()-60*60000).toISOString(),status:"planned"}];
  const browser=await bootApp(state);
  try {
    assert.match(browser.app.innerHTML,/Day changed\? Adjust the remaining work/);assert.match(browser.app.innerHTML,/id="activity-recovery-form"/);
    assert.equal(browser.savedState().schedule[0].status,"planned");assert.equal(browser.stored("studioRecovery"),null);
  } finally { browser.cleanup(); }
});

test("day summary groups sessions and estimates alone leave the conflict filter empty", async () => {
  const {state,activity}=activitySample();const browser=await bootApp(state,{studioActivity:activity});
  try {
    await browser.click("navigate",null,{view:"activity"});assert.match(browser.app.innerHTML,/<option value="summary" selected>/);
    assert.match(browser.app.innerHTML,/Adjust this group/);assert.doesNotMatch(browser.app.innerHTML,/class="card activity-session/);
    await browser.change("activity-filter",{value:"review"});assert.match(browser.app.innerHTML,/No conflicting associations/);
    await browser.change("activity-filter",{value:"all"});assert.match(browser.app.innerHTML,/class="card activity-session/);
    assert.equal(browser.stored("studioActivity").sessions[0].confirmed,undefined);
  } finally { browser.cleanup(); }
});

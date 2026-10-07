import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { STATE_KEY, createDefaultState } from "../src/core/state.js";
import { LEARNING_KEY } from "../src/core/learning-guide.js";
import { ACTIVITY_KEY } from "../src/core/activity.js";
import { RECOVERY_KEY } from "../src/core/recovery.js";
import { DIAGNOSTICS_KEY,DIAGNOSTICS_SETTINGS_KEY } from "../src/core/diagnostics.js";
import { appFixture, activityFixture, chromeFixture } from "./activity-fixtures.js";
async function boot() {
  const f=chromeFixture();let listener;
  f.api.runtime.onInstalled={addListener(){}};f.api.runtime.onStartup={addListener(){}};
  f.api.runtime.onMessage={addListener(fn){listener=fn;}};f.api.alarms.onAlarm={addListener(){}};f.api.sidePanel={async setPanelBehavior(){}};
  const state=appFixture(),now=Date.now();state.tasks.forEach(t=>t.dueAt=null);state.preferences.dayStart="00:00";state.preferences.dayEnd="23:59";
  state.schedule=[{id:"missed",taskId:"task-a",startAt:new Date(now-120*60000).toISOString(),endAt:new Date(now-60*60000).toISOString(),status:"planned"}];
  const activity=activityFixture({settings:{details:true,aiEnabled:true,enabled:false}});
  for(const session of activity.sessions)for(const segment of session.segments){segment.startAt=new Date(now-20*60000).toISOString();segment.endAt=new Date(now-60000).toISOString();}
  f.local.set(STATE_KEY,state);f.local.set(ACTIVITY_KEY,activity);
  globalThis.chrome=f.api;await import(`../src/background.js?activity=${crypto.randomUUID()}`);await delay(10);
  return {...f,request:(message,sender={id:"studio-test"})=>new Promise(resolve=>listener(message,sender,resolve)),cleanup:()=>{delete globalThis.chrome;}};
}
test("content frames cannot access activity, task or recovery controls; notification app tabs can",async()=>{
  const f=await boot();try{
    const sender={id:"studio-test",tab:{id:7},url:"https://study.example/",frameId:0};
    for(const request of [{type:"app:save",state:appFixture()},{type:"activity:action",action:"clear"},{type:"recovery:action",action:"propose",options:{}},{type:"gemini:status"},{type:"guide:get"},{type:"guide:action",action:"enabled",options:{enabled:true}},{type:"ai-policy:get"},{type:"ai-policy:settings",patch:{automaticEnabled:true}},{type:"privacy:local",enabled:true,origins:[]}])assert.equal((await f.request(request,sender)).ok,false);
    const valid=await f.request({type:"recovery:action",action:"get"},{...sender,url:f.api.runtime.getURL("src/sidepanel.html?view=plan")});assert.equal(valid.ok,true);
  }finally{f.cleanup();}
});

test("guide storage preserves explicit progress and serializes concurrent panel updates", async () => {
  const f = await boot();
  try {
    const seeded = await f.request({ type: "guide:get" });
    assert.equal(seeded.ok, true);
    assert.equal(seeded.data.steps["basics.add"], undefined);
    const app = structuredClone(f.local.get(STATE_KEY)), activity = structuredClone(f.local.get(ACTIVITY_KEY));
    const results = await Promise.all([
      f.request({ type: "guide:action", action: "skip", options: { step: "basics.focus" } }),
      f.request({ type: "guide:action", action: "acknowledge", options: { step: "activity.control" } }),
      f.request({ type: "guide:action", action: "pause", options: { topic: "schedule" } })
    ]);
    assert.ok(results.every(result => result.ok));
    const saved = f.local.get(LEARNING_KEY);
    assert.equal(saved.steps["basics.focus"], "skipped");
    assert.equal(saved.steps["activity.control"], "done");
    assert.deepEqual(saved.pausedTopics, ["schedule"]);
    assert.deepEqual(f.local.get(STATE_KEY), app);
    assert.deepEqual(f.local.get(ACTIVITY_KEY), activity);
    await f.request({ type: "guide:action", action: "replay", options: { topic: "basics" } });
    assert.equal((await f.request({ type: "guide:get" })).data.steps["basics.add"], undefined);
  } finally { f.cleanup(); }
});

test("failed guide writes report failure and leave the stored progress recoverable", async () => {
  const f = await boot();
  try {
    const original = (await f.request({ type: "guide:get" })).data;
    f.control.failWrite = true;
    const failed = await f.request({ type: "guide:action", action: "pause", options: { topic: "basics" } });
    assert.equal(failed.ok, false);
    assert.deepEqual(f.local.get(LEARNING_KEY), original);
    f.control.failWrite = false;
    assert.equal((await f.request({ type: "guide:action", action: "pause", options: { topic: "basics" } })).ok, true);
    assert.deepEqual(f.local.get(LEARNING_KEY).pausedTopics, ["basics"]);
    const invalid = await f.request({ type: "guide:action", action: "acknowledge", options: { step: "unknown" } });
    assert.equal(invalid.ok, false);
  } finally { f.cleanup(); }
});

test("backup restore preserves device-local guide progress; full reset erases it", async () => {
  const f = await boot();
  try {
    const saved = (await f.request({ type: "guide:action", action: "enabled", options: { enabled: false } })).data;
    const restored = await f.request({ type: "app:replace", state: createDefaultState(), memory: null, reset: false });
    assert.equal(restored.ok, true);
    assert.deepEqual(f.local.get(LEARNING_KEY), saved);
    const reset = await f.request({ type: "app:replace", state: createDefaultState(), memory: null, reset: true });
    assert.equal(reset.ok, true);
    assert.equal(f.local.has(LEARNING_KEY), false);
    const fresh = await f.request({ type: "guide:get" });
    assert.deepEqual(fresh.data, { version: 2, enabled: true, steps: {}, pausedTopics: [] });
  } finally { f.cleanup(); }
});
test("recovery applies atomically and a stale app form cannot overwrite its schedule",async()=>{
  const f=await boot();try{
    const before=structuredClone(f.local.get(STATE_KEY));
    const proposal=await f.request({type:"recovery:action",action:"propose",options:{choices:[{taskId:"task-a",remainingMinutes:20}]}});assert.equal(proposal.ok,true);
    const id=proposal.data.pending.id;
    const applied=await f.request({type:"recovery:action",action:"apply",options:{id}});assert.equal(applied.ok,true);assert.equal(applied.data.pending,null);
    const schedule=structuredClone(applied.data.state.schedule);before.preferences.theme="paper";
    const saved=await f.request({type:"app:save",state:before});assert.equal(saved.ok,true);assert.deepEqual(saved.data.schedule,schedule);assert.equal(saved.data.preferences.theme,"paper");
    assert.equal(f.local.get(RECOVERY_KEY).history.length,1);
    const duplicate=await f.request({type:"recovery:action",action:"apply",options:{id}});assert.equal(duplicate.ok,false);
    const undo=await f.request({type:"recovery:action",action:"undo",options:{id}});assert.equal(undo.ok,true);assert.equal(undo.data.state.schedule.length,1);assert.equal(undo.data.state.schedule[0].status,"planned");
  }finally{f.cleanup();}
});
test("activity AI excludes browsing text from diagnostics even when debug text is enabled",async()=>{
  const f=await boot(),oldFetch=globalThis.fetch;let payload;
  f.session.set("studioGeminiSessionKey","private-test-key");f.local.set(DIAGNOSTICS_SETTINGS_KEY,{includeText:true,revision:1});
  globalThis.fetch=async(url,options)=>{payload=JSON.parse(options.body);return {ok:true,status:200,async json(){return {steps:[{type:"model_output",content:[{type:"text",text:JSON.stringify({sessions:[{id:"session-a",candidates:[{task_id:"task-a",project_id:"",tag_ids:[],reason:"title match"}]}]})}]}]};}};};
  try{
    const response=await f.request({type:"activity:ai"});assert.equal(response.ok,true);assert.equal(payload.store,false);
    assert.match(JSON.stringify(payload),/Neural networks chapter/);
    const diagnostics=f.local.get(DIAGNOSTICS_KEY);assert.ok(diagnostics.some(x=>x.action==="activity-classify"));
    assert.doesNotMatch(JSON.stringify(diagnostics),/Neural networks chapter|study.example|private-test-key/);
  }finally{globalThis.fetch=oldFetch;f.cleanup();}
});

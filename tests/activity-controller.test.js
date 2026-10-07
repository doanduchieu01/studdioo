import test from "node:test";
import assert from "node:assert/strict";
import { createActivityController } from "../src/activity-controller.js";
import { ACTIVITY_KEY, sessionMilliseconds } from "../src/core/activity.js";
import { NOW, MIN, appFixture, activityFixture, chromeFixture } from "./activity-fixtures.js";

function setup(requestAI=async(request,validate)=>validate({sessions:request.context.sessions.map(s=>({id:s.id,candidates:[{task_id:"task-a",project_id:"",tag_ids:[],reason:"Title match"}]}))})) {
  const f=chromeFixture(),app=appFixture();f.local.set(ACTIVITY_KEY,activityFixture());
  const make=()=>createActivityController(f.api,{readApp:async()=>structuredClone(app),requestAI,clock:()=>f.control.now});
  return {...f,app,make,controller:make()};
}
test("manual-only AI policy prevents automatic claims but permits a user request",async()=>{
  const f=setup();let requests=0;
  const controller=createActivityController(f.api,{readApp:async()=>f.app,clock:()=>NOW,automaticAllowed:async()=>false,requestAI:async()=>{requests++;return [];}});
  await controller.ai(false);assert.equal(requests,0);assert.equal((await controller.read()).quota.attempts,0);
  await controller.ai(true);assert.equal(requests,1);
});
test("losing the shared allowance releases unsent activity fingerprints and the local claim",async()=>{
  const f=setup(async()=>{throw Object.assign(Error("Shared AI paused"),{code:"automatic_ai_paused"});});
  const original=await f.controller.read();await f.controller.ai(false);const after=await f.controller.read();
  assert.equal(after.quota.attempts,original.quota.attempts);assert.equal(after.quota.lastAt,original.quota.lastAt);
  assert.equal(after.sessions[0].aiFingerprint,original.sessions[0].aiFingerprint);
  assert.equal(after.sessions[0].revision,original.sessions[0].revision);
});
test("permissions are required and revocation pauses collection",async()=>{
  const f=setup();f.control.granted=false;
  await assert.rejects(f.controller.act("settings",{enabled:true}),/Allow tab/);
  assert.equal((await f.controller.tick()).settings.enabled,false);
  f.control.granted=true;await f.controller.act("settings",{enabled:true});
  await f.controller.tick();f.control.now+=MIN;
  const data=await f.controller.tick();assert.ok(data.sessions.length>1);
});
test("a service worker restart keeps observed time, but a browser restart skips the cursor",async()=>{
  const f=setup();await f.controller.act("clear");await f.controller.act("settings",{enabled:true});
  await f.controller.tick();f.control.now+=MIN;await f.make().tick();
  f.session.clear();f.control.now+=MIN;
  const data=await f.make().tick();assert.equal(sessionMilliseconds(data.sessions[0]),MIN);assert.equal(data.gaps.at(-1).reason,"browser_restart");
});
test("allowed top-frame media signals store evidence only and reject forged metadata",async()=>{
  const f=setup();await f.controller.act("site",{origin:"https://study.example/"});
  const sender={id:"studio-test",url:f.control.tab.url,tab:{id:7},frameId:0};
  assert.equal((await f.controller.recordSignal({type:"activity:signal",playing:true,visible:true,taskId:"injected",startAt:"forged"},sender)).allowed,true);
  const signal=f.session.get("studioActivitySignals")[7];assert.equal(signal.taskId,undefined);assert.equal(signal.startAt,undefined);
  assert.equal((await f.controller.recordSignal({type:"activity:signal"},{...sender,frameId:2})).allowed,false);
  assert.equal((await f.controller.recordSignal({type:"activity:signal"},{...sender,id:"other"})).allowed,false);
  assert.equal((await f.controller.recordSignal({type:"activity:signal"},{...sender,url:"https://other.example/"})).allowed,false);
  await f.controller.act("settings",{enabled:false});assert.equal(f.scripts.size,0);
  assert.equal((await f.controller.recordSignal({type:"activity:signal"},sender)).allowed,false);
});
test("incognito and a hidden page cannot start a foreground session",async()=>{
  const f=setup();await f.controller.act("clear");await f.controller.act("settings",{enabled:true});
  f.control.tab.incognito=true;assert.equal((await f.controller.tick()).cursor,null);
  f.control.tab.incognito=false;await f.controller.act("site",{origin:"https://study.example/"});
  await f.controller.recordSignal({type:"activity:signal",playing:false,visible:false},{id:"studio-test",url:f.control.tab.url,tab:{id:7},frameId:0});
  assert.equal((await f.controller.tick()).cursor,null);
});
test("AI uses one bounded claim and does not repeat successful automatic suggestions",async()=>{
  let calls=0;const f=setup(async(request,validate)=>{calls++;return validate({sessions:[{id:request.context.sessions[0].id,candidates:[{task_id:"task-a",project_id:"",tag_ids:[],reason:"title"}]}]});});
  await Promise.all([f.controller.ai(),f.controller.ai()]);assert.equal(calls,1);
  f.control.now+=31*MIN;await f.controller.ai();assert.equal(calls,1);
  const data=await f.controller.read();assert.equal(data.quota.attempts,1);assert.equal(data.sessions[0].assignment.source,"unknown");
});
test("failed AI attempts count toward the daily limit and do not automatically retry",async()=>{
  let calls=0;const f=setup(async()=>{calls++;throw new Error("No quota");});
  await f.controller.ai();f.control.now+=31*MIN;await f.controller.ai();assert.equal(calls,1);
  await f.controller.ai(true);await f.controller.ai(true);
  await assert.rejects(f.controller.ai(true),/Daily activity AI limit/);assert.equal(calls,3);
  await f.controller.act("clear");assert.equal((await f.controller.read()).quota.attempts,3);
});
test("late AI responses respect manual corrections",async()=>{
  let resolve,started;const ready=new Promise(r=>started=r);
  const f=setup((request,validate)=>new Promise(r=>{resolve=()=>r(validate({sessions:[{id:"session-a",candidates:[{task_id:"task-a",project_id:"",tag_ids:[],reason:"title"}]}]}));started();}));
  const pending=f.controller.ai();await ready;
  await f.controller.act("assign",{id:"session-a",taskId:"task-b"});resolve();await pending;
  let data=await f.controller.read();assert.equal(data.sessions[0].assignment.taskId,"task-b");assert.equal(data.sessions[0].suggestions.length,0);
});
test("catalog or task changes invalidate an in-flight AI batch",async()=>{
  let resolve,started;const ready=new Promise(r=>started=r);
  const f=setup((request,validate)=>new Promise(r=>{resolve=()=>r(validate({sessions:[{id:"session-a",candidates:[{task_id:"task-a",project_id:"",tag_ids:[],reason:"title"}]}]}));started();}));
  const pending=f.controller.ai();await ready;f.app.tasks[0].status="done";resolve();await pending;
  assert.equal((await f.controller.read()).sessions[0].suggestions.length,0);
});
test("a storage failure does not start AI and the serialized writer recovers",async()=>{
  let calls=0;const f=setup(async()=>{calls++;return [];});f.control.failWrite=true;
  await assert.rejects(f.controller.ai(),/Storage full/);assert.equal(calls,0);
  f.control.failWrite=false;await f.controller.act("settings",{aiEnabled:false});assert.equal((await f.controller.read()).settings.aiEnabled,false);
});
test("activity import validates its version and restores paused without grants or Undo",async()=>{
  const f=setup();await assert.rejects(f.controller.act("restore",{backup:{format:"studio-activity-backup",version:99}}),/not an activity backup/);
  const data=await f.controller.act("restore",{backup:{format:"studio-activity-backup",version:1,activity:activityFixture()}});
  assert.equal(data.settings.enabled,false);assert.equal(data.settings.aiEnabled,false);assert.deepEqual(data.settings.signalOrigins,[]);assert.equal(data.cursor,null);assert.deepEqual(data.undo,[]);
});

 test("disabling AI while a batch is in flight discards its suggestions",async()=>{
  let resolve,started;const ready=new Promise(r=>started=r);
  const f=setup((request,validate)=>new Promise(r=>{resolve=()=>r(validate({sessions:[{id:"session-a",candidates:[{task_id:"task-a",project_id:"",tag_ids:[],reason:"title"}]}]}));started();}));
  const pending=f.controller.ai();await ready;await f.controller.act("settings",{aiEnabled:false});resolve();await pending;
  const data=await f.controller.read();assert.equal(data.settings.aiEnabled,false);assert.equal(data.sessions[0].suggestions.length,0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { AI_POLICY_KEY, normalizeAIPolicy, automaticAIStatus, createAIPolicyController } from "../src/core/ai-policy.js";
import { MEDIA_PRESETS, localExtrasPermission, localExtrasState } from "../src/core/media-sites.js";
import { normalizeState } from "../src/core/state.js";

function fixture(raw, migrate) {
  let value=raw, date=new Date(2026,9,6,15), fail=false;
  const storage={async get(){return {[AI_POLICY_KEY]:structuredClone(value)};},async set(next){if(fail)throw Error("Storage failed");value=structuredClone(next[AI_POLICY_KEY]);}};
  return {controller:createAIPolicyController(storage,{now:()=>date,migrate}),get value(){return value;},tomorrow(){date=new Date(2026,9,7,0,1);},fail(value){fail=value;}};
}
test("new profiles start manual and existing automation migrates only once",async()=>{
  const f=fixture();assert.equal((await f.controller.get()).automaticEnabled,false);
  let migrations=0;const old=fixture(undefined,async()=>{migrations++;return true;});
  assert.equal((await old.controller.get()).automaticEnabled,true);
  await old.controller.settings({automaticEnabled:false});await old.controller.get();
  assert.equal(migrations,1);assert.equal(old.value.automaticEnabled,false);
});
test("concurrent sorting, activity and memory reservations never exceed their shared limit",async()=>{
  const f=fixture();await f.controller.settings({automaticEnabled:true,dailyLimit:3});
  const features=["sorting","activity","memory","sorting","activity","memory"];
  const results=await Promise.allSettled(features.map(feature=>f.controller.reserve(feature)));
  assert.equal(results.filter(x=>x.status==="fulfilled").length,3);
  assert.ok(results.filter(x=>x.status==="rejected").every(x=>x.reason.code==="automatic_ai_paused"));
  assert.equal(f.value.used,3);assert.deepEqual(f.value.byFeature,{sorting:1,activity:1,memory:1});
  assert.equal(automaticAIStatus(f.value),"budget");
});
test("limit changes do not clear attempts; zero pauses; local midnight resets usage only",async()=>{
  const f=fixture();await f.controller.settings({automaticEnabled:true,dailyLimit:1});await f.controller.reserve("memory");
  await f.controller.settings({dailyLimit:0});assert.equal(f.value.used,1);
  await assert.rejects(f.controller.reserve("sorting"),{code:"automatic_ai_paused"});
  f.tomorrow();const next=await f.controller.get();assert.equal(next.used,0);assert.equal(next.dailyLimit,0);assert.equal(next.automaticEnabled,true);
  await f.controller.settings({dailyLimit:2});await f.controller.reserve("activity");assert.equal(f.value.used,1);
});
test("invalid settings and failed persistence never reserve an unsaved request",async()=>{
  const f=fixture();await f.controller.settings({automaticEnabled:true});
  for(const dailyLimit of [-1,101,1.5,"3",NaN])await assert.rejects(f.controller.settings({dailyLimit}));
  await assert.rejects(f.controller.settings({automaticEnabled:"true"}));
  f.fail(true);await assert.rejects(f.controller.reserve("sorting"));assert.equal(f.value.used,0);
  f.fail(false);await f.controller.reserve("sorting");assert.equal(f.value.used,1);
  const epoch=f.value.epoch;await f.controller.settings({automaticEnabled:false});assert.ok(f.value.epoch>epoch);
  await assert.rejects(f.controller.reserve("memory"),{code:"automatic_ai_paused"});
});
test("malformed policy data is bounded; saved model and theme choices survive the new defaults",()=>{
  const now=new Date(2026,9,6);
  const p=normalizeAIPolicy({dailyLimit:Infinity,automaticEnabled:"yes",used:-5,day:"2026-10-06",byFeature:{sorting:Infinity},secret:"drop"},now);
  assert.equal(p.automaticEnabled,false);assert.equal(p.used,0);assert.equal(p.dailyLimit,3);assert.ok(p.byFeature.sorting<=100000);assert.equal(p.secret,undefined);
  assert.equal(normalizeState({preferences:{model:"custom-private-model",theme:"night"}}).preferences.model,"custom-private-model");
  assert.equal(normalizeState({preferences:{model:"gemini-3.1-flash-lite",theme:"night"}}).preferences.theme,"night");
});
test("media presets describe exact opt-in origins and mixed local choices stay mixed",()=>{
  assert.equal(MEDIA_PRESETS.length,10);assert.equal(new Set(MEDIA_PRESETS.map(x=>x.origin)).size,10);
  assert.deepEqual(localExtrasPermission([]),{permissions:["tabs","idle","notifications"]});
  assert.deepEqual(localExtrasPermission([MEDIA_PRESETS[0].origin,MEDIA_PRESETS[0].origin]),{permissions:["tabs","idle","notifications","scripting"],origins:["https://www.youtube.com/*"]});
  assert.throws(()=>localExtrasPermission(["https://*/*"]));assert.throws(()=>localExtrasPermission(["https://unknown.example"]));
  assert.deepEqual(localExtrasState({settings:{enabled:true,details:true}},{settings:{}}),{count:2,all:false,some:true});
});

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeActivity, resourceIdentity, advanceActivity, sessionMilliseconds, sessionRanges, unionMilliseconds, activityAction, classifySession, readingAllowance, buildActivityRequest, validateActivityResponse, applyActivitySuggestions } from "../src/core/activity.js";
import { NOW, MIN, at, appFixture, activityFixture, sessionFixture } from "./activity-fixtures.js";

const snapshot={host:"study.example",resource:"https://study.example/chapter?secret=yes",title:"Neural networks chapter",focused:true,idle:true};
test("twenty-minute passive reading survives the idle threshold and remains estimated",()=>{
  const app=appFixture();let data=activityFixture({sessions:[]});
  for(let m=0;m<=20;m++)data=advanceActivity(data,snapshot,NOW+m*MIN,"browser-1",app);
  assert.equal(data.sessions.length,1);
  assert.equal(sessionMilliseconds(data.sessions[0]),20*MIN);
  assert.equal(data.sessions[0].confirmed,false);
  assert.ok(data.sessions[0].segments.some(s=>s.uncertain));
  assert.equal(app.tasks[0].status,"planned");assert.equal(app.schedule.length,0);
});
test("reading caps stop unattended tabs while explicit reading mode extends the allowance",()=>{
  const app=appFixture();let data=activityFixture({sessions:[],settings:{enabled:true,readingMinutes:5}});
  for(let m=0;m<=8;m++)data=advanceActivity(data,snapshot,NOW+m*MIN,"browser-1",app);
  assert.equal(sessionMilliseconds(data.sessions[0]),5*MIN);assert.equal(data.cursor,null);
  data=activityAction(data,"reading",{},app,NOW+8*MIN);
  for(let m=8;m<=11;m++)data=advanceActivity(data,snapshot,NOW+m*MIN,"browser-1",app);
  assert.equal(unionMilliseconds(data.sessions.flatMap(sessionRanges)),8*MIN);
});
test("sleep and browser restart never fill unobserved time",()=>{
  const app=appFixture();let data=activityFixture({sessions:[]});
  data=advanceActivity(data,snapshot,NOW,"first",app);
  data=advanceActivity(data,snapshot,NOW+MIN,"first",app);
  data=advanceActivity(data,snapshot,NOW+120*MIN,"first",app);
  data=advanceActivity(data,snapshot,NOW+121*MIN,"second",app);
  assert.equal(unionMilliseconds(data.sessions.flatMap(sessionRanges)),MIN);
  assert.deepEqual(data.gaps.map(g=>g.reason),["tracking_gap"]);
  // A new browser process invalidates even a short outstanding cursor.
  data=advanceActivity(data,{...snapshot,idle:false},NOW+122*MIN,"second",app);
  data=advanceActivity(data,{...snapshot,idle:false},NOW+122.5*MIN,"third",app);
  assert.equal(data.gaps.at(-1).reason,"browser_restart");
});
test("lock, background and internal pages do not continue foreground reading",()=>{
  const app=appFixture();let data=activityFixture({sessions:[]});
  data=advanceActivity(data,snapshot,NOW,"browser",app);
  data=advanceActivity(data,{...snapshot,locked:true},NOW+MIN,"browser",app);
  data=advanceActivity(data,{...snapshot,focused:false},NOW+2*MIN,"browser",app);
  assert.equal(data.cursor,null);assert.equal(sessionMilliseconds(data.sessions[0]),MIN);
  assert.equal(resourceIdentity("chrome://settings"),null);
});
test("media evidence supports long lectures and background media requires opt-in",()=>{
  const app=appFixture();let data=activityFixture({sessions:[],settings:{enabled:true,readingMinutes:5}});
  for(let m=0;m<=20;m++)data=advanceActivity(data,{...snapshot,media:true},NOW+m*MIN,"browser",app);
  assert.equal(sessionMilliseconds(data.sessions[0]),20*MIN);assert.equal(data.sessions[0].segments[0].kind,"media");
  data=advanceActivity(data,{...snapshot,media:true,focused:false},NOW+21*MIN,"browser",app);
  assert.equal(data.cursor,null);
  data=activityAction(data,"settings",{backgroundMedia:true},app,NOW+21*MIN);
  data=advanceActivity(data,{...snapshot,media:true,focused:false},NOW+22*MIN,"browser",app);
  assert.equal(data.cursor.sample.kind,"background-media");
});
test("resource identities redact queries and details remain optional",()=>{
  assert.equal(resourceIdentity("https://study.example/chapter?token=secret#password").key,"https://study.example/chapter");
  assert.equal(resourceIdentity("https://www.youtube.com/watch?v=abc123&t=44&token=secret").key,"https://www.youtube.com/watch?v=abc123");
  assert.equal(resourceIdentity("https://user:pass@study.example/"),null);
  let data=activityFixture({sessions:[],settings:{enabled:true}});
  data=advanceActivity(data,snapshot,NOW,"b",appFixture());data=advanceActivity(data,snapshot,NOW+MIN,"b",appFixture());
  assert.equal(data.sessions[0].segments[0].title,"");assert.equal(data.sessions[0].segments[0].resource,"");
});
test("saved exact resources override domain rules; ambiguity only suggests",()=>{
  const app=appFixture();let data=activityFixture();
  data=activityAction(data,"rule-save",{resource:"https://study.example",scope:"host",taskId:"task-b"},app,NOW);
  data=activityAction(data,"rule-save",{resource:"https://study.example/chapter",taskId:"task-a"},app,NOW);
  let s=classifySession(data.sessions[0],data,app);assert.equal(s.assignment.taskId,"task-a");assert.equal(s.assignment.source,"rule");
  data.rules.push({...data.rules[1],id:"conflict",assignment:{...data.rules[0].assignment}});
  s=classifySession(data.sessions[0],data,app);assert.equal(s.assignment.source,"unknown");assert.equal(s.suggestions.length,2);
});
test("resources assigned to the same work join one session and changed work splits",()=>{
  const app=appFixture();let data=activityFixture({sessions:[]});
  for(const path of ["chapter","notes"])data=activityAction(data,"rule-save",{resource:`https://study.example/${path}`,taskId:"task-a"},app,NOW);
  data=advanceActivity(data,snapshot,NOW,"b",app);
  data=advanceActivity(data,{...snapshot,resource:"https://study.example/notes"},NOW+MIN,"b",app);
  data=advanceActivity(data,{...snapshot,resource:"https://other.example/",host:"other.example"},NOW+2*MIN,"b",app);
  data=advanceActivity(data,{...snapshot,resource:"https://other.example/",host:"other.example"},NOW+3*MIN,"b",app);
  assert.equal(data.sessions.length,2);assert.equal(sessionMilliseconds(data.sessions[0]),2*MIN);
});
test("removing an association clears obsolete automatic attribution on reclassification",()=>{
  const app=appFixture();let data=activityAction(activityFixture(),"rule-save",{resource:"https://study.example/chapter",taskId:"task-a"},app,NOW);
  data=activityAction(data,"reclassify",{},app,NOW);assert.equal(data.sessions[0].assignment.source,"rule");
  data=activityAction(data,"rule-delete",{id:data.rules[0].id},app,NOW);
  data=activityAction(data,"reclassify",{},app,NOW);assert.equal(data.sessions[0].assignment.source,"unknown");
  assert.equal(data.sessions[0].suggestions[0].taskId,"task-a");
});
test("assignment, labels and remembered resources do not confirm time unless requested",()=>{
  const app=appFixture();const before=structuredClone(app);
  let data=activityAction(activityFixture(),"assign",{id:"session-a",taskId:"task-b",projectName:"Research",tagNames:"reading, Reading, notes",remember:true},app,NOW);
  const s=data.sessions[0];assert.equal(s.assignment.source,"manual");assert.equal(s.confirmed,false);assert.equal(s.locked,true);
  assert.equal(data.tags.length,2);assert.equal(data.rules.length,1);assert.deepEqual(app,before);
  const undo=data.undo.at(-1).id;data=activityAction(data,"undo",{id:undo},app,NOW);
  assert.equal(data.sessions[0].assignment.source,"unknown");assert.equal(data.rules.length,1);
});
test("trim preserves raw intervals; split, merge and overlap totals preserve time",()=>{
  const app=appFixture(),raw=activityFixture();
  let data=activityAction(raw,"trim",{id:"session-a",startAt:at(-15),endAt:at(-5)},app,NOW);
  assert.deepEqual(data.sessions[0].segments,raw.sessions[0].segments);assert.equal(sessionMilliseconds(data.sessions[0]),10*MIN);
  assert.throws(()=>activityAction(data,"split",{id:"session-a",at:at(-17)},app,NOW),/included time/);
  data=activityAction(raw,"split",{id:"session-a",at:at(-10)},app,NOW);
  assert.equal(data.sessions.length,2);assert.equal(unionMilliseconds(data.sessions.flatMap(sessionRanges)),19*MIN);
  data=activityAction(data,"merge",{ids:data.sessions.map(s=>s.id)},app,NOW);
  assert.equal(data.sessions.length,1);assert.equal(sessionMilliseconds(data.sessions[0]),19*MIN);
  const overlap=activityFixture({sessions:[sessionFixture("a",-20,-5),sessionFixture("b",-10,-1)]});
  data=activityAction(overlap,"merge",{ids:["a","b"]},app,NOW);assert.equal(sessionMilliseconds(data.sessions[0]),19*MIN);
});
test("stale edits and stale Undo fail without overwriting a newer correction",()=>{
  const app=appFixture();let data=activityFixture();
  assert.throws(()=>activityAction(data,"exclude",{id:"session-a",revisions:{"session-a":0}},app,NOW),/session changed/);
  data=activityAction(data,"confirm",{id:"session-a"},app,NOW);const first=data.undo.at(-1).id;
  data=activityAction(data,"exclude",{id:"session-a"},app,NOW);
  assert.throws(()=>activityAction(data,"undo",{id:first},app,NOW),/session changed/);
});
test("only confirmed reading across multiple days adapts the bounded allowance",()=>{
  let data=activityFixture({sessions:[sessionFixture("a",-2890,-2870,{confirmed:true}),sessionFixture("b",-1450,-1430,{confirmed:true}),sessionFixture("c",-21,-1,{confirmed:true})]});
  assert.deepEqual(readingAllowance(data),{minutes:25,examples:3});
  data.sessions[0].confirmed=false;assert.equal(readingAllowance(data).minutes,30);
  data.sessions[0].confirmed=true;data.settings.readingMinutes=10;assert.equal(readingAllowance(data).minutes,10);
});
test("AI payload is minimized, validates IDs and cannot overwrite a late manual correction",()=>{
  const app=appFixture();app.tasks[0].notes="PRIVATE NOTES";const data=activityFixture();
  const request=buildActivityRequest(data,app,data.sessions);
  assert.doesNotMatch(request.input,/https:\/\/|PRIVATE NOTES|dueAt|secret=/);
  assert.throws(()=>validateActivityResponse({sessions:[{id:"session-a",candidates:[{task_id:"invented",project_id:"",tag_ids:[],reason:"guess"}]}]},request),/Unknown activity label/);
  const decisions=validateActivityResponse({sessions:[{id:"session-a",candidates:[{task_id:"task-a",project_id:"",tag_ids:[],reason:"Title match"}]}]},request);
  const suggested=applyActivitySuggestions(data,data.sessions,decisions,app,NOW);
  assert.equal(suggested.sessions[0].assignment.source,"unknown");assert.equal(suggested.sessions[0].suggestions[0].source,"ai");
  const manual=activityAction(data,"assign",{id:"session-a",taskId:"task-b"},app,NOW);
  const late=applyActivitySuggestions(manual,data.sessions,decisions,app,NOW);assert.equal(late.sessions[0].assignment.taskId,"task-b");assert.equal(late.sessions[0].suggestions.length,0);
});
test("normalization prunes expired observations and keeps seven-day backup boundaries",()=>{
  const data=activityFixture({sessions:[sessionFixture("old",-12000,-11999),sessionFixture("new")]});
  assert.deepEqual(data.sessions.map(s=>s.id),["new"]);
  assert.equal(normalizeActivity(null,NOW).settings.enabled,false);
});

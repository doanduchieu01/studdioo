import test from "node:test";
import assert from "node:assert/strict";
import { delayedBlocks, proposeRecovery, applyRecovery, undoRecovery } from "../src/core/recovery.js";
import { schedulableTasks, detectConflicts } from "../src/core/scheduler.js";
import { saveDayPlan } from "../src/core/time-management.js";
import { NOW, at, appFixture } from "./activity-fixtures.js";
const now=new Date(NOW),choice=[{taskId:"task-a",remainingMinutes:30}];
function fixture(){const app=appFixture();app.schedule=[{id:"old",taskId:"task-a",startAt:at(-120),endAt:at(-70),status:"planned"},{id:"fixed",taskId:"task-b",startAt:at(10),endAt:at(35),status:"planned"}];return app;}
test("the previous planner excludes missed work; recovery detects it without changing tasks",()=>{
  const app=fixture();assert.equal(schedulableTasks(app).some(t=>t.id==="task-a"),false);
  assert.deepEqual(delayedBlocks(app,now).map(b=>b.id),["old"]);
  const before=structuredClone(app),proposal=proposeRecovery(app,choice,now);assert.deepEqual(app,before);
  assert.ok(proposal.blocks.length);assert.equal(proposal.blocks.reduce((n,b)=>n+(new Date(b.endAt)-new Date(b.startAt))/60000,0),30);
});
test("recovery keeps future commitments fixed and respects buffers, deadlines and budgets",()=>{
  const app=fixture(),p=proposeRecovery(app,choice,now);
  assert.equal(detectConflicts([...app.schedule.filter(b=>b.id!=="old"),...p.blocks]).length,0);
  assert.ok(p.blocks.every(b=>new Date(b.startAt)>=new Date(at(45))));
  assert.ok(p.blocks.every(b=>new Date(b.endAt)<=new Date(app.tasks[0].dueAt)));
  const result=applyRecovery(app,p,now);
  assert.deepEqual(result.state.schedule.find(b=>b.id==="fixed"),app.schedule[1]);
  assert.equal(result.state.schedule.find(b=>b.id==="old").status,"skipped");assert.equal(result.state.tasks[0].status,"planned");
  assert.equal(result.state.schedulingRevision,1);
});
test("infeasible recovery is all-or-nothing for a task",()=>{
  const app=fixture();app.tasks[0].dueAt=at(50);
  const p=proposeRecovery(app,choice,now);assert.equal(p.blocks.length,0);assert.equal(p.replaced.length,0);assert.equal(p.unscheduled.length,1);
  assert.throws(()=>applyRecovery(app,p,now),/No feasible/);
});
test("a zero manual daily budget stays zero and pushes recovery to a later day",()=>{
  const app=saveDayPlan(fixture(),{availableMinutes:0,mode:"manual"},now);app.tasks[0].dueAt=null;
  const p=proposeRecovery(app,choice,now);assert.ok(p.blocks.length);assert.ok(p.blocks.every(b=>new Date(b.startAt).getDate()!==now.getDate()));
});
test("reviewed remaining minutes are required; completion or an active timer removes delays",()=>{
  const app=fixture();assert.throws(()=>proposeRecovery(app,[{taskId:"task-a",remainingMinutes:0}],now),/Confirm/);
  assert.throws(()=>proposeRecovery(app,[...choice,...choice],now),/once/);
  app.tasks[0].status="done";assert.equal(delayedBlocks(app,now).length,0);
  app.tasks[0].status="planned";app.focus={...app.focus,status:"paused",taskId:"task-a"};assert.equal(delayedBlocks(app,now).length,0);
});
test("Apply rejects stale proposals and Undo rejects newer schedule changes",()=>{
  const app=fixture(),p=proposeRecovery(app,choice,now),changed=structuredClone(app);changed.tasks[0].durationMinutes=65;
  assert.throws(()=>applyRecovery(changed,p,now),/plan changed/);
  assert.throws(()=>applyRecovery(app,p,new Date(new Date(p.blocks[0].startAt).getTime()+1)),/start time passed/);
  const result=applyRecovery(app,p,now),undo=undoRecovery(result.state,result.history);
  assert.deepEqual(undo.schedule,app.schedule);assert.equal(undo.schedulingRevision,2);
  result.state.schedule[0].status="done";assert.throws(()=>undoRecovery(result.state,result.history),/schedule changed/);
});
test("overnight recovery checks the calendar budget after midnight",()=>{
  const late=new Date(2026,8,29,23,50),tomorrow=new Date(2026,8,30,0,0);
  let app=fixture();app.preferences.dayStart="22:00";app.preferences.dayEnd="06:00";app.tasks[0].dueAt=new Date(2026,8,30,1).toISOString();
  app=saveDayPlan(app,{availableMinutes:0},tomorrow);
  const p=proposeRecovery(app,choice,late);assert.equal(p.blocks.length,0);assert.equal(p.unscheduled.length,1);
});
test("recovery leaves Pomodoro breaks between chunks even when the buffer is zero",()=>{
  const app=fixture();app.preferences.bufferMinutes=0;app.preferences.breakMinutes=7;app.schedule=app.schedule.filter(b=>b.id==="old");
  const p=proposeRecovery(app,[{taskId:"task-a",remainingMinutes:50}],now);
  assert.equal(p.blocks.length,2);assert.ok(new Date(p.blocks[1].startAt)-new Date(p.blocks[0].endAt)>=7*60000);
});

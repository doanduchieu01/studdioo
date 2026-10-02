import test from "node:test";
import assert from "node:assert/strict";
import { createReminderController } from "../src/reminder-controller.js";
import { normalizeReminders, reminderEvents, quietNow } from "../src/core/reminders.js";
import { NOW, MIN, at, appFixture, activityFixture, chromeFixture } from "./activity-fixtures.js";
function setup(){const f=chromeFixture(),app=appFixture();app.schedule=[{id:"block",taskId:"task-a",startAt:at(5),endAt:at(30),status:"planned"}];app.tasks[0].dueAt=null;
  const make=()=>createReminderController(f.api,{readApp:async()=>structuredClone(app),readActivity:async()=>activityFixture(),clock:()=>f.control.now});
  return {...f,app,make,controller:make()};}
test("notifications require permission and default to off",async()=>{
  const f=setup();assert.equal((await f.controller.read()).settings.enabled,false);f.control.granted=false;
  await assert.rejects(f.controller.act("settings",{enabled:true}),/Allow notifications/);await f.controller.tick();assert.equal(f.control.created.length,0);
});
test("reminders are deduplicated across worker restarts and can snooze once",async()=>{
  const f=setup();await f.controller.act("settings",{enabled:true});await f.controller.tick();assert.equal(f.control.created.length,1);
  const id=f.control.created[0];await f.make().tick();assert.equal(f.control.created.length,1);
  await f.controller.click(id,1);f.control.now+=9*MIN;await f.controller.tick();assert.equal(f.control.created.length,1);
  f.control.now+=MIN;await f.make().tick();assert.equal(f.control.created.length,2);
  await f.controller.click(id,0);assert.match(f.control.opened[0].url,/sidepanel.html\?view=plan$/);
});
test("quiet hours and running focus postpone eligible reminders",async()=>{
  const f=setup();await f.controller.act("settings",{enabled:true,quietStart:"09:00",quietEnd:"11:00"});await f.controller.tick();assert.equal(f.control.created.length,0);
  await f.controller.act("settings",{quietStart:"00:00",quietEnd:"00:00"});f.app.focus.status="running";f.app.focus.phase="focus";await f.controller.tick();assert.equal(f.control.created.length,0);
  f.app.focus.status="idle";await f.controller.tick();assert.equal(f.control.created.length,1);
  assert.equal(quietNow({quietStart:"22:00",quietEnd:"08:00"},new Date(2026,8,29,23)),true);
});
test("several missed reminders collapse into one notification",async()=>{
  const f=setup();f.app.tasks[0].dueAt=at(10);f.app.tasks[1].dueAt=at(20);
  await f.controller.act("settings",{enabled:true});await f.controller.tick();assert.equal(f.control.created.length,1);assert.match([...f.notifications.values()][0].message,/3 items/);
});
test("finished tasks cancel a snooze and disabling clears visible notifications",async()=>{
  const f=setup();await f.controller.act("settings",{enabled:true});await f.controller.tick();const id=f.control.created[0];await f.controller.click(id,1);
  f.app.tasks[0].status="done";f.control.now+=10*MIN;await f.controller.tick();assert.equal(f.control.created.length,1);
  await f.controller.act("settings",{enabled:false});assert.equal(f.notifications.size,0);assert.equal(f.alarms.size,0);
});
test("old timer phases expire while a recent ending yields a stable event",()=>{
  const app=appFixture();app.focus.status="complete";app.sessions=[{id:"timer",endedAt:at(-3000)}];const settings=normalizeReminders(null).settings;
  let phase=reminderEvents(app,activityFixture(),settings,new Date(NOW)).find(e=>e.id.startsWith("phase:"));assert.ok(phase.expires<NOW);
  app.sessions[0].endedAt=at(-1);phase=reminderEvents(app,activityFixture(),settings,new Date(NOW)).find(e=>e.id.startsWith("phase:"));assert.ok(phase.expires>NOW);
  app.sessions[0].endedAt=at(-3000);app.focus.status="ready";app.focus.phase="focus";app.events=[{id:"break",type:"break_completed",at:at(-1)}];
  phase=reminderEvents(app,activityFixture(),settings,new Date(NOW)).find(e=>e.id.startsWith("phase:"));assert.equal(phase.at,NOW-MIN);
});

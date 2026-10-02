import test from "node:test";
import assert from "node:assert/strict";
import { addTask, createDefaultState, normalizeState } from "../src/core/state.js";
import { nextFocus } from "../src/core/daily-flow.js";
import { normalizeActivity, needsReview } from "../src/core/activity.js";
import { normalizeReminders, reminderEvents } from "../src/core/reminders.js";
import { normalizeLearnedMemory } from "../src/core/learned-memory.js";
import { renderPrivacy } from "../src/privacy-view.js";
import { setLanguage } from "../src/i18n.js";

const now = new Date("2026-09-30T10:00:00");
function sample() {
  let state = createDefaultState(now);
  for (const title of ["Read", "Write"]) state = addTask(state, { title }, now).state;
  return state;
}

test("empty day offers open focus without creating tasks", () => {
  const state = createDefaultState(now), before = structuredClone(state);
  assert.deepEqual(nextFocus(state, now), { task: null, block: null, minutes: 25 });
  assert.deepEqual(state, before);
});
test("picked tasks take precedence over an arbitrary inbox item", () => {
  const state = sample(); state.dayPlans = [{date:"2026-09-30", taskIds:[state.tasks[1].id]}];
  assert.equal(nextFocus(state, now).task.id, state.tasks[1].id);
  state.tasks[1].status = "done";
  assert.equal(nextFocus(state, now).task.id, state.tasks[0].id);
});
test("today's next planned block takes precedence and retains its duration", () => {
  const state = sample();state.schedule = [{id:"next",taskId:state.tasks[1].id,startAt:new Date(+now+60000).toISOString(),endAt:new Date(+now+21*60000).toISOString(),status:"planned"}];
  const choice = nextFocus(state,now);assert.equal(choice.block.id,"next");assert.equal(choice.minutes,20);
  state.schedule[0].startAt = new Date(+now+86400000).toISOString();state.schedule[0].endAt = new Date(+now+86400000+20*60000).toISOString();
  assert.equal(nextFocus(state,now).block,null);
});
test("estimates and missing labels never create a required review", () => {
  const base = {excluded:false,locked:false,confirmed:false,assignment:{source:"unknown"},segments:[{uncertain:true}],suggestions:[]};
  assert.equal(needsReview(base),false);
  base.suggestions = [{reasons:["ai_suggestion"]}];assert.equal(needsReview(base),false);
  base.suggestions = [{reasons:["conflicting_rules"]}];assert.equal(needsReview(base),true);
  base.locked = true;assert.equal(needsReview(base),false);
  base.locked = false;base.excluded = true;assert.equal(needsReview(base),false);
});
test("optional review reminder stays off for new installs and ignores estimates", () => {
  assert.equal(normalizeReminders(null).settings.review,false);
  assert.equal(normalizeReminders({settings:{review:true}}).settings.review,true);
  const activity = {sessions:[{excluded:false,locked:false,assignment:{source:"unknown"},segments:[{uncertain:true}],suggestions:[]}]};
  assert.deepEqual(reminderEvents(createDefaultState(now),activity,{review:true},now),[]);
  activity.sessions[0].suggestions = [{reasons:["conflicting_rules"]}];
  assert.equal(reminderEvents(createDefaultState(now),activity,{review:true},now)[0].title,"Optional activity review");
});
test("schema 12 preserves completed onboarding and all previous privacy choices", () => {
  const old = sample();old.schemaVersion = 11;old.profile.onboardingComplete=true;old.memory.enabled=true;old.preferences.autoSort=true;
  const updated = normalizeState(old,now);
  assert.equal(updated.profile.onboardingComplete,true);assert.equal(updated.profile.privacyReviewVersion,0);
  assert.equal(updated.memory.enabled,true);assert.equal(updated.preferences.autoSort,true);
  assert.equal(normalizeState(null,now).memory.enabled,false);
  assert.equal(normalizeLearnedMemory(null).settings.useWithGemini,false);
  assert.equal(normalizeLearnedMemory({settings:{useWithGemini:true}}).settings.useWithGemini,true);
  assert.equal(normalizeLearnedMemory({settings:{useWithGemini:false}}).settings.useWithGemini,false);
});
for (const language of ["en","vi"]) test(`privacy screen explains all separate switches in ${language}`, () => {
  setLanguage(language);
  const output = renderPrivacy({state:createDefaultState(now),activity:normalizeActivity(null),reminders:normalizeReminders(null),privacyReady:true,gemini:{connected:false},learned:normalizeLearnedMemory(null),diagnostics:{includeText:false},geminiForm:""});
  for(const key of ["tracking","details","media","backgroundMedia","notifications","review","gemini","activityAI","autoSort","instructions","memory","learning","diagnostics"]) {
    assert.match(output,new RegExp(`data-privacy="${key}"`));
    assert.doesNotMatch(output,new RegExp(`data-privacy="${key}"[^>]*checked`));
    assert.match(output,new RegExp(`id="privacy-${key}-help"`));
  }
  for(const permission of ["tabs","idle","notifications","scripting","generativelanguage.googleapis.com","storage","alarms","sidePanel"])assert.ok(output.includes(permission));
  if(language==="vi") {assert.match(output,/Chọn dữ liệu/);assert.doesNotMatch(output,/New installations|Chrome permissions|Uses the existing|Send the context|Queue new task/);}
  setLanguage("en");
});

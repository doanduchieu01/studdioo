import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultState, createBackup, addTask } from "../src/core/state.js";
import { LEARNING_TOPICS, normalizeLearningGuide, initialLearningGuide, learningAction, learningContext, currentLearningStep, learningEvents } from "../src/core/learning-guide.js";
import { renderLearningCard, renderLearningCenter, showLearningTarget, clearLearningTarget, tourPlacement, trapDialogKey } from "../src/learning-view.js";
import { setLanguage } from "../src/i18n.js";

test("guide storage is bounded and drops user text, identifiers and malformed progress", () => {
  const value = normalizeLearningGuide({ enabled: false, steps: { "basics.add": "done", "activity.control": "skipped", "basics.focus": true, secret: "a user's note" }, pausedTopics: ["activity", "activity", "url"], history: ["private"] });
  assert.deepEqual(value, { version: 2, enabled: false, steps: { "basics.add": "done", "activity.control": "skipped" }, pausedTopics: ["activity"] });
  assert.equal(normalizeLearningGuide(null).enabled, true);
  assert.ok(JSON.stringify(normalizeLearningGuide({ steps: Object.fromEntries(Array.from({length:10000},(_,i)=>[i,"done"])) })).length < 100);
});

test("guide identifiers and selectors are unique and both languages cover every lesson", () => {
  const ids = LEARNING_TOPICS.flatMap(topic => topic.steps.map(step => step.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(LEARNING_TOPICS.map(topic => topic.id)).size, LEARNING_TOPICS.length);
  for (const topic of LEARNING_TOPICS) for (const step of topic.steps) {
    assert.ok(step.target && step.title.en && step.title.vi && step.body.en && step.body.vi);
    assert.ok(step.id.startsWith(topic.id + "."));
  }
});

test("existing work does not fabricate tour progress and replay remains explicit", () => {
  const app = addTask(createDefaultState(), { title: "Existing" }).state;
  app.focus.status = "paused";
  const guide = initialLearningGuide(null, app);
  assert.deepEqual(guide.steps, {});
  const replayed = learningAction(guide, "replay", { topic: "basics" });
  assert.deepEqual(initialLearningGuide(replayed, app).steps, {});
  assert.deepEqual(createBackup(app).state?.learningGuide, undefined);
});

test("all explanations can be acknowledged without actions; skipped steps remain skipped", () => {
  const start = normalizeLearningGuide(null);
  assert.equal(learningAction(start, "acknowledge", { step: "basics.add" }).steps["basics.add"], "done");
  const skipped = learningAction(start, "skip", { step: "basics.add" });
  assert.equal(currentLearningStep(skipped, "basics").id, "basics.focus");
  const done = learningAction(skipped, "event", { event: "task-added" });
  assert.equal(done.steps["basics.add"], "skipped");
  assert.deepEqual(start.steps, {});
  assert.throws(() => learningAction(done, "skip", { step: "unknown" }));
});

test("pausing, disabling, resuming and replaying preserve unrelated lessons", () => {
  let guide = learningAction(null, "acknowledge", { step: "activity.control" });
  guide = learningAction(guide, "pause", { topic: "activity" });
  assert.equal(currentLearningStep(guide, "activity"), null);
  guide = learningAction(guide, "enabled", { enabled: false });
  assert.equal(currentLearningStep(guide, "basics"), null);
  assert.equal(currentLearningStep(guide, "basics", false).id, "basics.add");
  guide = learningAction(guide, "resume", { topic: "activity" });
  assert.equal(currentLearningStep(guide, "activity", false).id, "activity.estimates");
  guide = learningAction(guide, "replay", { topic: "basics" });
  assert.equal(guide.enabled, false);
  assert.equal(guide.steps["activity.control"], "done");
});

test("contexts follow opened features without gating any feature", () => {
  assert.equal(learningContext({view:"today"}), "basics");
  assert.equal(learningContext({view:"plan",planView:"schedule"}), "schedule");
  assert.equal(learningContext({view:"plan",planView:"kanban"}), "kanban");
  assert.equal(learningContext({view:"settings"}), "settings");
  assert.equal(learningContext({view:"today",omnibarOpen:true}), "capture");
  assert.equal(learningContext({view:"plan",planView:"matrix",learningTopic:"kanban"}), "kanban");
  assert.equal(learningContext({view:"learn"}), null);
});

test("task and proposal changes never advance an explanation tour", () => {
  const before = createDefaultState(), after = addTask(before,{title:"Private task"}).state;
  assert.deepEqual(learningEvents(before,after), []);
  assert.deepEqual(learningEvents(after,structuredClone(after)), []);
  const proposed = {...after, proposals:[{id:"p",blocks:[]}]};
  assert.deepEqual(learningEvents(after,proposed), []);
  proposed.proposals[0].blocks.push({});
  assert.deepEqual(learningEvents(after,proposed), []);
});

test("guide rendering is bilingual with explicit Next and no completion score", () => {
  const guide=learningAction(null,"skip",{step:"basics.add"});
  setLanguage("vi");
  assert.match(renderLearningCard(guide,"basics",currentLearningStep(guide,"basics")), /Đóng hướng dẫn/);
  assert.match(renderLearningCenter(guide), /2 giải thích ngắn/);
  setLanguage("en");
  assert.match(renderLearningCenter(guide,"<script>bad</script>"), /&lt;script&gt;/);
  assert.match(renderLearningCard(guide,"basics",currentLearningStep(guide,"basics")), /learning-next/);
});

function targetFixture(disabled = false) {
  const attrs = new Map([["aria-describedby","existing-help"]]), calls=[];
  const details={tagName:"DETAILS",open:false,parentElement:null};
  const node={disabled,parentElement:details,classList:{add:x=>calls.push(["add",x]),remove:x=>calls.push(["remove",x])},getAttribute:k=>attrs.get(k)??null,setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),matches:()=>false,scrollIntoView:x=>calls.push(["scroll",x]),focus:x=>calls.push(["focus",x]),click:()=>{throw Error("A guide must never activate a control");}};
  const status={textContent:""}, dialog={focus:()=>calls.push(["dialog-focus"])};
  const shell={inert:false};
  return {node,details,attrs,calls,status,shell,doc:{querySelector:selector=>selector==="#learning-target-status"?status:[".learning-overlay",".learning-card","#learning-title"].includes(selector)?dialog:selector==="#control"?node:null,querySelectorAll:()=>[shell]}};
}
test("tour reveals the target without activating it; dialog gets focus and background becomes inert", () => {
  const f=targetFixture();
  assert.equal(showLearningTarget({target:"#control"},f.doc),true);
  assert.equal(f.details.open,true);
  assert.equal(f.attrs.get("aria-describedby"),"existing-help");
  assert.equal(f.attrs.has("tabindex"),false);
  assert.ok(f.calls.some(([type])=>type==="dialog-focus"));
  assert.ok(!f.calls.some(([type])=>type==="focus"));
  assert.equal(f.shell.inert,true);
  clearLearningTarget();
  assert.equal(f.attrs.get("aria-describedby"),"existing-help");
  assert.equal(f.attrs.has("tabindex"),false);
  assert.equal(f.shell.inert,false);
});
test("missing or disabled controls offer a safe fallback without fabricating progress", () => {
  const f=targetFixture(true);
  assert.equal(showLearningTarget({target:"#control"},f.doc),false);
  assert.match(f.status.textContent,/without adding data/);
  assert.deepEqual(f.calls,[["dialog-focus"]]);
  assert.equal(showLearningTarget({target:"#missing"},{querySelector:()=>null}),false);
});

test("spotlight card placement fits narrow and short viewports", () => {
  for (const [width,height,cardHeight] of [[320,640,300],[300,400,376],[640,480,250]]) {
    for (const rect of [null,{top:10,bottom:60,left:20,right:290},{top:340,bottom:390,left:240,right:420}]) {
      const place=tourPlacement(rect,width,height,cardHeight);
      assert.ok(place.left>=12 && place.left+place.width<=width-12);
      assert.ok(place.top>=12 && place.top+cardHeight<=height-12);
    }
  }
});

test("tour keyboard trap wraps in both directions and handles an empty dialog", () => {
  let focused=null, prevented=0;
  const a={focus(){focused=a;}},b={focus(){focused=b;}};
  const dialog={querySelectorAll:()=>[a,b],contains:x=>[a,b].includes(x),focus(){focused=dialog;}};
  const event=shiftKey=>({key:"Tab",shiftKey,preventDefault(){prevented++;}});
  assert.equal(trapDialogKey(event(false),dialog,{activeElement:b}),true);assert.equal(focused,a);
  assert.equal(trapDialogKey(event(true),dialog,{activeElement:a}),true);assert.equal(focused,b);
  assert.equal(trapDialogKey(event(false),dialog,{activeElement:a}),false);
  dialog.querySelectorAll=()=>[];trapDialogKey(event(false),dialog,{activeElement:a});assert.equal(focused,dialog);assert.equal(prevented,3);
});

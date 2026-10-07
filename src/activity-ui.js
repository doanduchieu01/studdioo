import { html, t, getLocale } from "./i18n.js";
import { renderMediaPresets } from "./features-view.js";
import { guideText } from "./learning-view.js";
import { escapeHtml as e, localDateKey, localDateTimeInput, formatTime } from "./core/utils.js";
import { ACTIVITY_KEY, normalizeActivity, needsReview, sessionRanges, sessionMilliseconds, unionMilliseconds, resourceIdentity, readingAllowance } from "./core/activity.js";
import { REMINDER_KEY, normalizeReminders } from "./core/reminders.js";
import { RECOVERY_KEY, delayedBlocks } from "./core/recovery.js";
import { getActivity, performActivityAction, requestActivityAI, requestTrackingPermission, requestSignalPermission,
  getReminders, performReminderAction, requestNotificationPermission, performRecoveryAction, observeActivityStores, isExtension } from "./platform.js";

const mins=ms=>Math.round(ms/60000);
const localInput=value=>{const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,23);};
const btn=(action,label,attributes="",style="")=>html`<button class="btn compact ${style}" type="button" data-action="${action}" ${attributes}>${t(label)}</button>`;
const field=(label,name,type,value,extra="")=>html`<div class="field"><label for="activity-${name}">${t(label)}</label><input class="input" id="activity-${name}" name="${name}" type="${type}" value="${e(value??"")}" ${extra}></div>`;
const check=(label,name,checked,extra="")=>html`<label class="check-row"><input type="checkbox" name="${name}" ${checked?"checked":""} ${extra}><span>${t(label)}</span></label>`;
const reasons={recent_input:"Recent input was detected.",visible_no_input:"The page remained visible without recent input.",media_playing:"The player was playing; attention is unverified.",background_playback:"Background listening was enabled.",reading_mode:"Reading mode was enabled.",long_no_input:"A long interval had no input; review its duration.",saved_resource:"A saved resource association matched.",user_choice:"Assigned by the user.",title_match:"Words in the page title match this task.",planned_overlap:"The session overlaps a planned block.",conflicting_rules:"Recorded resources match different associations.",ai_suggestion:"AI suggestion; not confirmed.",reading_limit:"The reading allowance ended."};
const kinds={browser:"Browsing",reading:"Reading",media:"Media", "background-media":"Background media"};
function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export function createActivityUI({getState,setState,render,toast}) {
  let data=normalizeActivity(null),reminders=normalizeReminders(null),recovery={pending:null,history:[]};
  let selected=new Set(),date=localDateKey(new Date()),filter="summary",editor=null,draft={},working=false,confirmClear=false,privacyReady=false;
  const formDrafts=new Map();
  const state=()=>getState();
  const projectName=id=>data.projects.find(x=>x.id===id)?.name??"";
  const tags=ids=>ids.map(id=>data.tags.find(x=>x.id===id)?.name).filter(Boolean).join(", ");
  const taskOptions=id=>html`<option value="">${t("Unassigned")}</option>${state().tasks.filter(task=>task.status!=="archived"||task.id===id).map(task=>html`<option value="${e(task.id)}" ${task.id===id?"selected":""}>${e(task.title)}</option>`).join("")}`;
  function assignmentFields(values={},prefix="activity"){const content=html`<div class="field"><label for="activity-taskId">Task</label><select class="select" id="activity-taskId" name="taskId">${taskOptions(values.taskId)}</select></div><div class="field-grid">${field("Project","projectName","text",values.projectName,'maxlength="80" list="activity-projects"')}${field("Tags, separated by commas","tagNames","text",values.tagNames,'maxlength="300"')}</div><datalist id="activity-projects">${data.projects.map(p=>html`<option value="${e(p.name)}"></option>`).join("")}</datalist>`;return content.replaceAll('id="activity-',`id="${prefix}-`).replaceAll('for="activity-',`for="${prefix}-`).replaceAll('list="activity-',`list="${prefix}-`);}
  async function load(){
    const [a,r,p]=await Promise.all([getActivity().catch(()=>null),getReminders().catch(()=>null),performRecoveryAction().catch(()=>null)]);
    privacyReady=Boolean(a&&r);if(a)data=a;if(r)reminders=r;if(p)recovery=p;
  }
  async function run(operation){if(working)return;working=true;try{await operation();}finally{working=false;render();}}
  const save=async(action,options={})=>{data=await performActivityAction(action,options);};
  function edit(ids,assignment=null){
    for(const key of ["activity-assignment-form","activity-trim-form","activity-split-form"])formDrafts.delete(key);
    const sessions=ids.map(id=>data.sessions.find(s=>s.id===id)).filter(Boolean);if(!sessions.length)throw new Error("Choose a session first.");
    const first=sessions[0],a=assignment??first.assignment;
    editor={ids:sessions.map(s=>s.id),revisions:Object.fromEntries(sessions.map(s=>[s.id,s.revision]))};
    draft={taskId:a.taskId??"",projectName:projectName(a.projectId),tagNames:tags(a.tagIds),startAt:localInput(first.reviewStartAt??first.startAt),endAt:localInput(first.reviewEndAt??first.endAt),at:localInput(new Date((new Date(first.startAt).getTime()+new Date(first.endAt).getTime())/2)),remember:false,confirmTime:false};
    render();
    document.querySelector("#activity-editor")?.scrollIntoView?.({block:"nearest"});
  }
  function renderEditor(){
    if(!editor)return "";
    return html`<section class="card accent" id="activity-editor"><div class="card-header"><h2>Review sessions</h2>${btn("activity-close-editor","Close")}</div><p class="subtle">${editor.ids.length} ${t("selected")}</p>
      <form id="activity-assignment-form">${assignmentFields(draft)}${check("Remember these exact resources","remember",draft.remember)}${check("Confirm the recorded duration","confirmTime",draft.confirmTime)}<div class="button-row"><button class="btn primary" type="submit">Save assignment</button>${btn("activity-confirm-editor","Keep duration")}${btn("activity-exclude-editor","Exclude")}</div></form>
      ${editor.ids.length===1?html`<details><summary>Trim or split</summary><form id="activity-trim-form"><div class="field-grid">${field("Start","startAt","datetime-local",draft.startAt,'step="0.001" required')}${field("End","endAt","datetime-local",draft.endAt,'step="0.001" required')}</div><button class="btn" type="submit">Trim and confirm</button></form><form id="activity-split-form">${field("Split at","at","datetime-local",draft.at,'step="0.001" required')}<button class="btn" type="submit">Split session</button></form><p class="field-help">Trimming keeps the original observations. Undo is available until a newer edit.</p></details>`:""}
      <p class="field-help">Assignments do not complete tasks or move planned blocks.</p></section>`;
  }
  function visibleSessions(){const start=new Date(`${date}T00:00:00`),end=new Date(start);end.setDate(end.getDate()+1);return data.sessions.filter(s=>new Date(s.endAt)>start&&new Date(s.startAt)<end&&(filter==="excluded"?s.excluded:!s.excluded)&&(filter!=="review"||needsReview(s))).sort((a,b)=>b.startAt.localeCompare(a.startAt));}
  function explain(s){return html`<details class="mini-disclosure"><summary>Why this record?</summary><ul>${[...new Set([...s.segments.flatMap(x=>x.reasons),...s.assignment.reasons])].filter(r=>reasons[r]).map(r=>html`<li>${t(reasons[r])}</li>`).join("")}</ul>${s.assignment.source==="rule"?s.assignment.reasons.filter(r=>data.rules.some(rule=>rule.id===r)).map(r=>html`<p class="field-help">${e(data.rules.find(rule=>rule.id===r).match)}</p>`).join(""):""}<p class="field-help">A visible page or playing video does not verify attention.</p><ul class="activity-evidence">${s.segments.slice(-12).map(x=>html`<li>${e(formatTime(x.startAt,getLocale()))}–${e(formatTime(x.endAt,getLocale()))} · ${e(x.host)} · ${t(kinds[x.kind])}</li>`).join("")}</ul></details>`;}
  function renderSession(s){
    const a=s.assignment,task=state().tasks.find(x=>x.id===a.taskId),label=task?.title||projectName(a.projectId)||s.segments.find(x=>x.title)?.title||s.segments[0].host;
    return html`<article class="card activity-session ${needsReview(s)?"activity-review":""}"><div class="card-header"><label class="check-row"><input type="checkbox" data-activity-select="${e(s.id)}" ${selected.has(s.id)?"checked":""} aria-label="Select session"><span>${e(formatTime(s.reviewStartAt??s.startAt,getLocale()))}–${e(formatTime(s.reviewEndAt??s.endAt,getLocale()))}</span></label><span class="status-chip">${t(s.excluded?"Excluded":s.confirmed?"Confirmed time":"Estimated")}</span></div><h3>${e(label)}</h3><p class="subtle">${mins(sessionMilliseconds(s))} ${t("min")} · ${t(kinds[s.segments.at(-1).kind])}${projectName(a.projectId)?` · ${e(projectName(a.projectId))}`:""}${tags(a.tagIds)?` · ${e(tags(a.tagIds))}`:""}</p>
      ${task?.dueAt?html`<p class="field-help">Deadline: ${e(new Date(task.dueAt).toLocaleString(getLocale()))}</p>`:""}${a.blockId?html`<p class="field-help">Linked to a planned block.</p>`:""}
      <div class="button-row">${btn("activity-edit","Review",`data-id="${e(s.id)}"`)}${!s.confirmed&&!s.excluded?btn("activity-keep","Keep duration",`data-id="${e(s.id)}" data-revision="${s.revision}"`):""}</div>
      ${s.suggestions.length?html`<details class="mini-disclosure"><summary>Suggestions</summary>${s.suggestions.map((suggestion,index)=>html`<div class="activity-suggestion"><strong>${e(state().tasks.find(x=>x.id===suggestion.taskId)?.title||projectName(suggestion.projectId)||tags(suggestion.tagIds)||t("Unassigned"))}</strong><p class="field-help">${suggestion.note?e(suggestion.note):suggestion.reasons.map(r=>e(t(reasons[r]??r))).join(" ")}</p>${btn("activity-use-suggestion","Use suggestion",`data-id="${e(s.id)}" data-index="${index}"`)}</div>`).join("")}</details>`:""}${explain(s)}</article>`;
  }
  function renderSettings(){return html`<details class="card activity-settings"><summary>Tracking settings</summary><p class="field-help">Records browser sessions locally for 7 days. New tracking pauses the older website-total collector.</p><div class="button-row">${data.settings.enabled?btn("activity-pause","Pause tracking"):btn("activity-enable","Enable session tracking","","primary")}${btn("activity-reading",new Date(data.readingUntil)>new Date()?"End reading mode":"Reading mode")}</div><form id="activity-settings-form">
      ${check("Record titles and exact resource IDs","details",data.settings.details)}<p class="field-help">Optional. URL query strings are removed except supported content IDs. Page content and keystrokes are not collected.</p>
      ${check("AI suggestions for unclear sessions","aiEnabled",data.settings.aiEnabled)}<p class="field-help">Shares session titles, hostnames, minutes, candidate tasks and label names with Gemini. No full URLs, page content or debug prompt text. Up to 3 requests per local day; failed requests count. Saved associations apply locally.</p>
      ${check("Include background listening estimates","backgroundMedia",data.settings.backgroundMedia)}${check("Adapt reading allowance from confirmed reviews","adaptiveReading",data.settings.adaptiveReading)}<p class="field-help">${t("Current reading allowance:")} ${readingAllowance(data).minutes} ${t("min")} · ${readingAllowance(data).examples} ${t("confirmed examples")}</p><div class="field-grid">${field("Maximum reading allowance (min)","readingMinutes","number",data.settings.readingMinutes,'min="5" max="180" required')}${field("Review after no input (min)","reviewAfter","number",data.settings.reviewAfter,'min="2" max="60" required')}</div><p class="field-help">Reading mode extends the allowance from now. Playback without input stops after 120 minutes. These are estimates, not attention scores.</p><button class="btn" type="submit">Save tracking settings</button></form>
      <details><summary>Media signals by site</summary><p class="field-help">Allow one site at a time to read player state. Reload an already-open page after adding it. Embedded players and browser PDF viewers may not expose signals.</p><form id="activity-site-form">${field("Website URL","origin","url","",'placeholder="https://www.youtube.com" required')}<button class="btn" type="submit">Allow this site</button></form>${data.settings.signalOrigins.map(origin=>html`<div class="activity-rule"><span>${e(origin)}</span>${btn("activity-remove-site","Remove",`data-origin="${e(origin)}"`)}</div>`).join("")}</details>
      ${renderMediaPresets(data.settings.signalOrigins,working)}
      <p class="field-help">${guideText("Automatic AI also needs permission in Settings → AI on your terms and shares its daily limit. Ask AI in Activity is a manual request.", "AI tự động còn cần cho phép trong Cài đặt → AI theo lựa chọn riêng và dùng chung giới hạn mỗi ngày. Hỏi AI trong Hoạt động là yêu cầu thủ công.")}</p>
    </details>`;}
  function renderRules(){return html`<details class="card"><summary>Projects, tags and resource associations</summary><form id="activity-rule-form">${assignmentFields({},"rule")}${field("Resource URL","resource","url","",'required placeholder="https://…"')}${check("Apply to the entire domain","domain",false)}<button class="btn" type="submit">Save association</button></form><p class="field-help">Project and tag names create reusable labels. Exact resource rules take priority over domain rules. Conflicting rules produce suggestions.</p>${data.rules.map(rule=>html`<div class="activity-rule"><div><strong>${e(state().tasks.find(x=>x.id===rule.assignment.taskId)?.title||projectName(rule.assignment.projectId)||tags(rule.assignment.tagIds))}</strong><p class="field-help">${e(rule.match)} · ${t(rule.scope==="host"?"Entire domain":"Exact resource")}</p></div>${btn("activity-delete-rule","Remove",`data-id="${e(rule.id)}"`)}</div>`).join("")}${btn("activity-reclassify","Apply saved associations")}</details>`;}
  function renderComparison(){
    const tasks=state().tasks.filter(task=>data.sessions.some(s=>s.assignment.taskId===task.id&&!s.excluded)).slice(0,12);
    if(!tasks.length)return "";
    return html`<details class="card"><summary>Planned and recorded</summary><p class="field-help">Last 7 days of browser sessions. Timer minutes are shown separately and are not added to browser time.</p><div class="activity-table"><table><thead><tr><th>Task</th><th>Planned min</th><th>Browser min</th><th>Timer min</th></tr></thead><tbody>${tasks.map(task=>{const since=Date.now()-7*86400000;return html`<tr><td>${e(task.title)}</td><td>${Math.round(state().schedule.filter(b=>b.taskId===task.id&&b.status!=="skipped"&&new Date(b.startAt).getTime()>=since&&new Date(b.startAt).getTime()<=Date.now()).reduce((n,b)=>n+(new Date(b.endAt)-new Date(b.startAt))/60000,0))}</td><td>${mins(unionMilliseconds(data.sessions.filter(s=>s.assignment.taskId===task.id).flatMap(sessionRanges)))}</td><td>${Math.round(state().sessions.filter(s=>s.taskId===task.id&&new Date(s.endedAt).getTime()>=since).reduce((n,s)=>n+s.focusedSeconds/60,0))}</td></tr>`;}).join("")}</tbody></table></div></details>`;
  }
  function groupedSessions(sessions){
    const groups=new Map();
    for(const session of sessions){const a=session.assignment,key=a.taskId?`task:${a.taskId}`:a.projectId?`project:${a.projectId}`:`host:${session.segments[0].host}`;const group=groups.get(key)??[];group.push(session);groups.set(key,group);}
    return [...groups.values()].map(group=>{const first=group[0],a=first.assignment,label=state().tasks.find(task=>task.id===a.taskId)?.title||projectName(a.projectId)||first.segments[0].host;
      const start=new Date(`${date}T00:00:00`),end=new Date(start);end.setDate(end.getDate()+1);
      const ranges=group.flatMap(sessionRanges).map(([a,b])=>[Math.max(a,+start),Math.min(b,+end)]);
      return html`<section class="card"><div class="card-header"><h3>${e(label)}</h3><span>${mins(unionMilliseconds(ranges))} ${t("min")}</span></div><p class="field-help">${group.length} ${t("sessions")} · ${t(group.every(s=>s.confirmed)?"Confirmed time":"Includes estimates")}</p>${btn("activity-review-group","Adjust this group",`data-ids="${e(JSON.stringify(group.map(s=>s.id)))}"`)}</section>`;
    }).join("");
  }
  function renderDailySummary(){
    const start=new Date();start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);
    const ranges=data.sessions.flatMap(sessionRanges).map(([a,b])=>[Math.max(a,+start),Math.min(b,+end)]);
    const focused=state().sessions.filter(s=>new Date(s.endedAt)>=start&&new Date(s.endedAt)<end).reduce((n,s)=>n+s.focusedSeconds,0);
    return html`<section class="card"><h2>Today, so far</h2><p>${Math.round(focused/60)} ${t("timer min")} · ${mins(unionMilliseconds(ranges))} ${t("browser min (estimated)")}</p><p class="field-help">Timer and browser time are separate, not added together. No review is required.</p>${btn("navigate","View day summary",'data-view="activity"')}</section>`;
  }
  function renderPage(){
    const sessions=visibleSessions(),start=new Date(`${date}T00:00:00`),end=new Date(start);end.setDate(end.getDate()+1);
    const range=data.sessions.flatMap(sessionRanges).map(([a,b])=>[Math.max(a,start.getTime()),Math.min(b,end.getTime())]);
    return html`<div class="header-copy"><p class="eyebrow">Observed time, editable meaning</p><h1 class="page-title">Activity</h1><p class="page-subtitle">Reading and playback estimates stay visible. Review only what needs a correction.</p></div><div class="stack"><section class="card accent"><div class="card-header"><div><p class="eyebrow">Recorded browser time</p><h2>${mins(unionMilliseconds(range))} ${t("min")}</h2></div><span class="status-chip">${t(data.settings.enabled?"Tracking on":"Tracking paused")}</span></div><p class="field-help">Includes estimated passive time. Overlapping intervals count once. This total does not verify attention.</p><div class="field-grid">${field("Date","date","date",date)}<div class="field"><label for="activity-filter">Show</label><select class="select" id="activity-filter"><option value="summary" ${filter==="summary"?"selected":""}>Day summary</option><option value="all" ${filter==="all"?"selected":""}>All sessions</option><option value="review" ${filter==="review"?"selected":""}>Conflicting associations</option><option value="excluded" ${filter==="excluded"?"selected":""}>Excluded</option></select></div></div><details><summary>Optional corrections and AI</summary><div class="button-row">${btn("activity-refresh","Refresh")}${btn("activity-ai","Ask AI",data.settings.aiEnabled?"":"disabled")}${btn("activity-review-selected","Review selected")}${btn("activity-merge","Merge selected")}</div><p class="field-help">${selected.size} ${t("selected")}</p></details>${data.lastError?html`<p role="status" class="field-help">${e(t(data.lastError))}</p>`:""}</section>
      <p class="field-help">Review is optional. Estimates and unlabeled sessions can stay as they are.</p>
      ${renderEditor()}${sessions.length?(filter==="summary"?groupedSessions(sessions):sessions.slice(0,60).map(renderSession).join("")):html`<div class="empty"><h3>${t(filter==="review"?"No conflicting associations":"No sessions here")}</h3><p>${t(filter==="review"?"Nothing needs a decision. Estimates remain available in All sessions.":"Enable tracking or choose another day.")}</p></div>`}${filter!=="summary"&&sessions.length>60?html`<p class="field-help">Showing the latest 60 sessions for this day.</p>`:""}
      ${data.undo.length?html`<details class="card"><summary>Recent edits and Undo</summary><p class="field-help">Undo restores session edits. Remembered associations remain editable in resource associations.</p>${[...data.undo].reverse().slice(0,8).map(change=>html`<div class="activity-rule"><span>${e(new Date(change.at).toLocaleString(getLocale()))}</span>${btn("activity-undo","Undo",`data-id="${e(change.id)}"`)}</div>`).join("")}</details>`:""}
      ${renderComparison()}${renderSettings()}${renderRules()}
      <details class="card"><summary>Gaps and backup</summary><p class="field-help">Browser restarts and gaps over 90 seconds are not filled. Activity data has its own backup, separate from the task backup.</p>${data.gaps.slice(-8).map(g=>html`<p class="field-help">${e(new Date(g.startAt).toLocaleString(getLocale()))}–${e(formatTime(g.endAt,getLocale()))} · ${t(g.reason==="browser_restart"?"Browser restarted":"Tracking gap")}</p>`).join("")}<div class="button-row">${btn("activity-export","Export activity")}${btn("activity-import","Import activity")}${btn("activity-ask-clear","Clear activity")}</div><input class="sr-only" type="file" id="activity-import-file" accept="application/json,.json">${confirmClear?html`<p>Clear all sessions, labels and associations? This cannot be undone.</p><div class="button-row">${btn("activity-clear","Clear permanently","","danger")}${btn("activity-cancel-clear","Cancel")}</div>`:""}</details></div>`;
  }
  function renderReminders(){const s=reminders.settings;return html`<section class="card"><h2>Reminders</h2><form id="activity-reminders-form">${check("Enable desktop reminders","enabled",s.enabled)}${check("Scheduled blocks","blocks",s.blocks)}${check("Approaching deadlines","deadlines",s.deadlines)}${check("Pomodoro phase endings","phases",s.phases)}${check("Daily activity review at 18:00","review",s.review)}<div class="field-grid">${field("Block notice (min)","leadMinutes","number",s.leadMinutes,'min="0" max="60"')}${field("Deadline notice (min)","deadlineMinutes","number",s.deadlineMinutes,'min="5" max="1440"')}${field("Quiet hours start","quietStart","time",s.quietStart)}${field("Quiet hours end","quietEnd","time",s.quietEnd)}</div><button class="btn" type="submit">Save reminders</button></form><p class="field-help">Uses local time. Equal quiet-hour times disable quiet hours. Reminders wait during focus. The browser must be running; device sleep can delay delivery.</p>${reminders.error?html`<p role="status">${e(t(reminders.error))}</p>`:""}</section>`;}
  function renderRecovery(){
    const blocks=delayedBlocks(state()),tasks=[...new Set(blocks.map(b=>b.taskId))].map(id=>state().tasks.find(t=>t.id===id));
    const p=recovery.pending;
    return html`<section class="card"><h2>Recover delayed work</h2><p class="field-help">Past open blocks need review. Browser inactivity does not prove a task was missed. Confirm the remaining work before proposing new times.</p>
      ${tasks.length?html`<form id="activity-recovery-form">${tasks.slice(0,20).map(task=>html`<div class="activity-recovery-task"><label class="check-row"><input type="checkbox" name="recover-${e(task.id)}"><span>${e(task.title)}</span></label><label class="field-help" for="remaining-${e(task.id)}">Remaining minutes</label><input class="input" id="remaining-${e(task.id)}" name="remaining-${e(task.id)}" type="number" min="5" max="480" step="1" value="${Math.min(480,Math.round(blocks.filter(b=>b.taskId===task.id).reduce((n,b)=>n+(new Date(b.endAt)-new Date(b.startAt))/60000,0)))}"></div>`).join("")}<button class="btn" type="submit">Propose recovery</button></form>`:html`<p class="subtle">No delayed blocks to review.</p>`}
      ${p?html`<div class="activity-recovery-proposal"><h3>Recovery proposal</h3><p class="field-help">Fits deadlines, workday hours, breaks and daily budgets. Existing future blocks stay fixed. Nothing moves until Apply.</p>${p.blocks.map(b=>html`<p><strong>${e(state().tasks.find(t=>t.id===b.taskId)?.title??"")}</strong><br>${e(new Date(b.startAt).toLocaleString(getLocale()))}–${e(formatTime(b.endAt,getLocale()))}</p>`).join("")}${p.unscheduled.map(x=>html`<p class="field-help">${e(state().tasks.find(t=>t.id===x.taskId)?.title??"")}: ${t("No space within the deadline, workday and daily budget.")}</p>`).join("")}<div class="button-row">${btn("activity-recovery-apply","Apply recovery",p.blocks.length?`data-id="${e(p.id)}"`:"disabled","primary")}${btn("activity-recovery-dismiss","Dismiss")}</div></div>`:""}
      ${recovery.history?.length?btn("activity-recovery-undo","Undo last recovery",`data-id="${e(recovery.history.at(-1).id)}"`):""}</section>`;
  }
  async function action(button){
    const name=button.dataset.action, id=button.dataset.id;
    if(!name.startsWith("activity-"))return false;
    if(working)return true;
    if(name==="activity-enable") {const allowed=requestTrackingPermission();await run(async()=>{if(!await allowed)throw new Error("Tracking permission was not granted.");await save("settings",{enabled:true});});}
    else if(name==="activity-edit")edit([id]);
    else if(name==="activity-review-group")edit(JSON.parse(button.dataset.ids));
    else if(name==="activity-review-selected")edit([...selected]);
    else if(name==="activity-use-suggestion"){const s=data.sessions.find(x=>x.id===id);edit([id],s.suggestions[Number(button.dataset.index)]);}
    else if(name==="activity-close-editor"){editor=null;draft={};for(const key of ["activity-assignment-form","activity-trim-form","activity-split-form"])formDrafts.delete(key);render();}
    else if(name==="activity-import")document.querySelector("#activity-import-file").click();
    else if(name==="activity-export")download(`studio-activity-${localDateKey(new Date())}.json`,{format:"studio-activity-backup",version:1,exportedAt:new Date().toISOString(),activity:{...data,cursor:null,undo:[],quota:undefined}});
    else if(name==="activity-ask-clear"||name==="activity-cancel-clear"){confirmClear=name==="activity-ask-clear";render();}
    else await run(async()=>{
      if(name==="activity-pause")await save("settings",{enabled:false});
      if(name==="activity-reading")await save("reading",{stop:new Date(data.readingUntil)>new Date()});
      if(name==="activity-refresh"){await load();selected=new Set();editor=null;draft={};for(const key of ["activity-assignment-form","activity-trim-form","activity-split-form"])formDrafts.delete(key);}
      if(name==="activity-ai")data=await requestActivityAI();
      if(name==="activity-keep")await save("confirm",{id,revisions:{[id]:Number(button.dataset.revision)}});
      if(name==="activity-confirm-editor"||name==="activity-exclude-editor"){await save(name==="activity-confirm-editor"?"confirm":"exclude",editor);editor=null;selected=new Set();}
      if(name==="activity-merge"){await save("merge",{ids:[...selected],revisions:Object.fromEntries(data.sessions.filter(s=>selected.has(s.id)).map(s=>[s.id,s.revision]))});selected=new Set();}
      if(name==="activity-undo")await save("undo",{id});
      if(name==="activity-delete-rule")await save("rule-delete",{id});
      if(name==="activity-reclassify")await save("reclassify");
      if(name==="activity-remove-site")await save("site-remove",{origin:button.dataset.origin});
      if(name==="activity-clear"){await save("clear");formDrafts.clear();editor=null;selected=new Set();confirmClear=false;}
      if(name.startsWith("activity-recovery-")){recovery=await performRecoveryAction(name.slice(18),{id});setState(recovery.state);}
    });
    return true;
  }
  async function submit(form){
    if(!form.id.startsWith("activity-"))return false;
    if(working)return true;
    const values=new FormData(form),value=name=>String(values.get(name)??""),on=name=>values.get(name)==="on";
    const assignment=()=>({taskId:value("taskId"),projectName:value("projectName"),tagNames:value("tagNames")});
    let permission;
    if(form.id==="activity-site-form")permission=requestSignalPermission(value("origin"));
    if(form.id==="activity-reminders-form"&&on("enabled"))permission=requestNotificationPermission();
    await run(async()=>{
      if(form.id==="activity-settings-form"){
        // Separate writes keep the AI opt-in dependent on an already saved details setting.
        await save("settings",{details:on("details"),backgroundMedia:on("backgroundMedia"),adaptiveReading:on("adaptiveReading"),readingMinutes:Number(value("readingMinutes")),reviewAfter:Number(value("reviewAfter"))});
        await save("settings",{aiEnabled:on("aiEnabled")});
      }
      if(form.id==="activity-assignment-form"){await save("assign",{...editor,...assignment(),remember:on("remember"),confirmTime:on("confirmTime")});editor=null;selected=new Set();}
      if(form.id==="activity-trim-form"){await save("trim",{...editor,startAt:new Date(value("startAt")).toISOString(),endAt:new Date(value("endAt")).toISOString()});editor=null;}
      if(form.id==="activity-split-form"){await save("split",{...editor,at:new Date(value("at")).toISOString()});editor=null;}
      if(form.id==="activity-rule-form")await save("rule-save",{...assignment(),resource:value("resource"),scope:on("domain")?"host":"resource"});
      if(form.id==="activity-site-form"){if(!await permission)throw new Error("Site access was not granted.");await save("site",{origin:resourceIdentity(value("origin")).origin});toast(t("Site enabled. Reload the page to read media signals."));}
      if(form.id==="activity-reminders-form"){
        if(on("enabled")&&!await permission)throw new Error("Notification permission was not granted.");
        reminders=await performReminderAction("settings",{enabled:on("enabled"),blocks:on("blocks"),deadlines:on("deadlines"),phases:on("phases"),review:on("review"),leadMinutes:Number(value("leadMinutes")),deadlineMinutes:Number(value("deadlineMinutes")),quietStart:value("quietStart"),quietEnd:value("quietEnd")});
      }
      if(form.id==="activity-recovery-form"){
        const ids=[...new Set(delayedBlocks(state()).map(b=>b.taskId))];const choices=ids.filter(id=>on(`recover-${id}`)).map(taskId=>({taskId,remainingMinutes:Number(value(`remaining-${taskId}`))}));
        recovery=await performRecoveryAction("propose",{choices});setState(recovery.state);
      }
      formDrafts.delete(form.id);
    });return true;
  }
  function input(element){
    const form=element.closest?.("form");
    if(form?.id.startsWith("activity-")&&element.name){
      const values=formDrafts.get(form.id)??{};values[element.name]={value:element.value,checked:element.checked,type:element.type};formDrafts.set(form.id,values);
      if(editor&&["activity-assignment-form","activity-trim-form","activity-split-form"].includes(form.id))draft[element.name]=element.type==="checkbox"?element.checked:element.value;
    }
  }
  function restoreDrafts(){for(const [id,values] of formDrafts){const form=document.querySelector(`#${id}`);if(!form)continue;for(const [name,value] of Object.entries(values)){const input=form.elements?.namedItem(name);if(!input)continue;if(value.type==="checkbox")input.checked=value.checked;else input.value=value.value;}let parent=form.closest?.("details");while(parent){parent.open=true;parent=parent.parentElement?.closest?.("details");}}}
  function change(element){
    input(element);
    if(element.dataset?.activitySelect){element.checked?selected.add(element.dataset.activitySelect):selected.delete(element.dataset.activitySelect);render();return true;}
    if(element.id==="activity-date"){date=element.value;selected=new Set();render();return true;}
    if(element.id==="activity-filter"){filter=element.value;selected=new Set();render();return true;}
    if(element.id==="activity-import-file"){
      const file=element.files?.[0];if(file)void run(async()=>{if(file.size>4*1024*1024)throw new Error("Activity backup is too large.");await save("restore",{backup:JSON.parse(await file.text())});}).catch(error=>toast(t(error.message),"error"));return true;
    }return false;
  }
  function observe(){return observeActivityStores(changes=>{
    if(changes[ACTIVITY_KEY])data=normalizeActivity(changes[ACTIVITY_KEY].newValue);
    if(changes[REMINDER_KEY])reminders=normalizeReminders(changes[REMINDER_KEY].newValue);
    if(changes[RECOVERY_KEY])recovery=changes[RECOVERY_KEY].newValue??{pending:null,history:[]};
    if(!working&&!editor&&!formDrafts.size&&!document.activeElement?.matches?.("input,textarea,select"))render();
  });}
  return {load,observe,render:renderPage,renderReminders,renderRecovery,renderDailySummary,
    privacyState:()=>({activity:data,reminders,privacyReady}),hasRecovery:()=>Boolean(recovery.pending||recovery.history?.length),
    action,submit,change,input,restoreDrafts,isEditing:()=>Boolean(editor||formDrafts.size)};
}

import { sortingCandidates, ruleClassification, applySortResults } from "./core/task-sorting.js";
import { DEFAULT_MODEL } from "./core/models.js";
import { AI_POLICY_KEY, normalizeAIPolicy, createAIPolicyController } from "./core/ai-policy.js";
import { localExtrasPermission } from "./core/media-sites.js";
import { LEARNING_KEY, initialLearningGuide, learningAction } from "./core/learning-guide.js";
import { createDemoState, normalizeState, STATE_KEY } from "./core/state.js";
import { createDiagnosticReport, DIAGNOSTICS_SETTINGS_KEY, normalizeDiagnosticSettings } from "./core/diagnostics.js";
import { LEARNED_MEMORY_KEY, normalizeLearnedMemory } from "./core/learned-memory.js";
import { TRACKING_PERMISSIONS, trackingSummary } from "./core/browser-tracking.js";
import { applyTimerAction } from "./core/timer.js";
import { applyKanbanAction, reconcileKanban } from "./core/kanban.js";
import { ACTIVITY_KEY, normalizeActivity, activityAction, resourceIdentity } from "./core/activity.js";
import { REMINDER_KEY, normalizeReminders } from "./core/reminders.js";
import { RECOVERY_KEY, delayedBlocks, proposeRecovery, applyRecovery, undoRecovery } from "./core/recovery.js";

export const isExtension = Boolean(globalThis.chrome?.runtime?.id && globalThis.chrome?.storage?.local);
const previewKey = "studioPreviewState";

export async function getLearningGuide() {
  if (isExtension) return message({ type: "guide:get" });
  const raw = localStorage.getItem(LEARNING_KEY);
  let saved; try { saved = JSON.parse(raw); } catch { saved = {}; }
  const guide = initialLearningGuide(saved, await loadState());
  if (raw === null) localStorage.setItem(LEARNING_KEY, JSON.stringify(guide));
  return guide;
}

export async function learningGuideAction(action, options = {}) {
  if (isExtension) return message({ type: "guide:action", action, options });
  const guide = learningAction(await getLearningGuide(), action, options);
  localStorage.setItem(LEARNING_KEY, JSON.stringify(guide));
  return guide;
}

export async function loadState() {
  if (isExtension) {
    const result = await chrome.storage.local.get(STATE_KEY);
    return normalizeState(result[STATE_KEY]);
  }
  const saved = localStorage.getItem(previewKey);
  if (saved) {
    try {
      return normalizeState(JSON.parse(saved));
    } catch {
      localStorage.removeItem(previewKey);
    }
  }
  const demo = createDemoState(new Date());
  localStorage.setItem(previewKey, JSON.stringify(demo));
  return demo;
}

export async function saveState(state) {
  const normalized = normalizeState(state);
  if (isExtension) return message({ type: "app:save", state: normalized });
  const next = reconcileKanban(normalized, await loadState());
  localStorage.setItem(previewKey, JSON.stringify(next));
  return next;
}

export async function performKanbanAction(action, options = {}) {
  if (isExtension) return message({ type: "kanban:action", action, options });
  return saveState(applyKanbanAction(await loadState(), action, options));
}

export async function performTimerAction(action, options = {}) {
  if (isExtension) return message({ type: "timer:action", action, options });
  return saveState(applyTimerAction(await loadState(), action, options));
}

export function observeState(callback) {
  if (!isExtension) return () => {};
  const listener = changes => {
    if (changes[STATE_KEY]?.newValue) callback(normalizeState(changes[STATE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

async function message(payload) {
  if (!isExtension) throw new Error("Gemini calls are disabled in browser preview mode.");
  const response = await chrome.runtime.sendMessage(payload);
  if (!response?.ok) throw new Error(response?.error || "The extension background service did not respond.");
  return response.data;
}

export async function getGeminiStatus() {
  if (!isExtension) return { connected: false, remembered: false, model: DEFAULT_MODEL, preview: true };
  return message({ type: "gemini:status" });
}

export function requestTrackingPermission() {
  // Called synchronously from the Enable button's user gesture, before any await.
  return isExtension && chrome.permissions?.request ? chrome.permissions.request(TRACKING_PERMISSIONS) : Promise.resolve(false);
}

export function getTracking() {
  return isExtension ? message({ type: "tracking:get" }) : Promise.resolve(trackingSummary(null));
}

export function trackingAction(action) { return message({ type: `tracking:${action}` }); }

export async function connectGemini({ apiKey, remember, model }) {
  return message({ type: "gemini:connect", apiKey, remember, model });
}

export async function disconnectGemini() {
  return message({ type: "gemini:disconnect" });
}

export function getAIPolicy() {
  return isExtension ? message({ type: "ai-policy:get" }) : Promise.resolve(normalizeAIPolicy(previewStore(AI_POLICY_KEY)));
}
export function observeAIPolicy(callback) {
  if (!isExtension) return () => {};
  const listener = changes => { if (changes[AI_POLICY_KEY]?.newValue) callback(normalizeAIPolicy(changes[AI_POLICY_KEY].newValue)); };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
export async function setAIPolicy(patch) {
  if (isExtension) return message({ type: "ai-policy:settings", patch });
  const storage = { async get(key) { return { [key]: previewStore(key) }; }, async set(values) { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value)); } };
  return createAIPolicyController(storage).settings(patch);
}
export function requestLocalExtrasPermission(origins) {
  const request = localExtrasPermission(origins);
  return isExtension && chrome.permissions?.request ? chrome.permissions.request(request) : Promise.resolve(false);
}
export function applyLocalExtras(enabled, origins = []) { return message({ type: "privacy:local", enabled, origins }); }
export function revokeMediaAccess(origin) {
  if (!isExtension || !chrome.permissions?.remove) return Promise.resolve(false);
  return chrome.permissions.remove({ origins: [`${resourceIdentity(origin).origin}/*`] });
}

export async function changeGeminiModel(model) { return message({ type: "gemini:model", model }); }

export async function getLearnedMemory() {
  return isExtension ? message({ type: "memory:get" }) : normalizeLearnedMemory(null);
}

export async function learnedMemoryAction(action, payload = {}) {
  return message({ type: `memory:${action}`, ...payload });
}

export async function replaceAppData(state, memory, reset = false) {
  if (!isExtension) {
    if (reset) { localStorage.removeItem(LEARNING_KEY); await setAIPolicy({ automaticEnabled: false }); }
    if(reset)localStorage.removeItem(ACTIVITY_KEY);
    else {const a=await getActivity();a.settings.enabled=false;a.settings.aiEnabled=false;a.cursor=null;localStorage.setItem(ACTIVITY_KEY,JSON.stringify(a));}
    localStorage.removeItem(REMINDER_KEY);localStorage.removeItem(RECOVERY_KEY);
    return { state: await saveState(state), memory: normalizeLearnedMemory(null) };
  }
  return message({ type: "app:replace", state, memory, reset });
}

function previewStore(key){try{return JSON.parse(localStorage.getItem(key)??"null");}catch{return null;}}
export async function getActivity(){return isExtension?message({type:"activity:get"}):normalizeActivity(previewStore(ACTIVITY_KEY));}
export async function performActivityAction(action,options={}){
  if(isExtension)return message({type:"activity:action",action,options});
  if(action==="site"||action==="settings"&&options.enabled)throw new Error("Tracking is available in the installed extension.");
  let next;
  if(action==="clear")next=normalizeActivity(null);
  else if(action==="restore"){
    if(options.backup?.format!=="studio-activity-backup"||options.backup.version!==1)throw new Error("This is not an activity backup.");
    next=normalizeActivity(options.backup.activity);next.settings.enabled=false;next.settings.aiEnabled=false;next.cursor=null;next.settings.signalOrigins=[];next.undo=[];
  }else next=activityAction(await getActivity(),action,options,await loadState());
  localStorage.setItem(ACTIVITY_KEY,JSON.stringify(next));return next;
}
export async function requestActivityAI(){return message({type:"activity:ai"});}
export function requestSignalPermission(url){
  const identity=resourceIdentity(url);if(!identity)return Promise.reject(new Error("Enter a valid website URL."));
  return isExtension&&chrome.permissions?.request?chrome.permissions.request({permissions:["scripting"],origins:[`${identity.origin}/*`]}):Promise.resolve(false);
}
export function requestNotificationPermission(){return isExtension&&chrome.permissions?.request?chrome.permissions.request({permissions:["notifications"]}):Promise.resolve(false);}
export async function getReminders(){return isExtension?message({type:"reminder:get"}):normalizeReminders(previewStore(REMINDER_KEY));}
export async function performReminderAction(action,options={}){
  if(isExtension)return message({type:"reminder:action",action,options});
  const next=normalizeReminders(action==="clear"?null:{...await getReminders(),settings:{...(await getReminders()).settings,...options}});
  if(next.settings.enabled)throw new Error("Notifications are available in the installed extension.");
  localStorage.setItem(REMINDER_KEY,JSON.stringify(next));return next;
}
export async function performRecoveryAction(action="get",options={}){
  if(isExtension)return message({type:"recovery:action",action,options});
  if(!["get","propose","dismiss","apply","undo"].includes(action))throw new Error("Unknown recovery action.");
  let state=await loadState();const saved=previewStore(RECOVERY_KEY)??{pending:null,history:[]};
  if(action==="propose")saved.pending=proposeRecovery(state,options.choices);
  if(action==="dismiss")saved.pending=null;
  if(action==="apply"){if(saved.pending?.id!==options.id)throw new Error("Recovery proposal no longer exists.");const result=applyRecovery(state,saved.pending);state=await saveState(result.state);saved.history=[...saved.history,result.history].slice(-10);saved.pending=null;}
  if(action==="undo"){state=await saveState(undoRecovery(state,saved.history.find(h=>h.id===options.id)));saved.history=saved.history.filter(h=>h.id!==options.id);saved.pending=null;}
  if(action!=="get")localStorage.setItem(RECOVERY_KEY,JSON.stringify(saved));
  return {state,...saved,delayed:delayedBlocks(state)};
}
export function observeActivityStores(callback){
  if(!isExtension)return()=>{};
  const listener=changes=>{if(changes[ACTIVITY_KEY]||changes[REMINDER_KEY]||changes[RECOVERY_KEY])callback(changes);};
  chrome.storage.onChanged.addListener(listener);return()=>chrome.storage.onChanged.removeListener(listener);
}

export function observeLearnedMemory(callback) {
  if (!isExtension) return () => {};
  const listener = changes => {
    if (changes[LEARNED_MEMORY_KEY]) callback(normalizeLearnedMemory(changes[LEARNED_MEMORY_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export async function runGeminiAction(action, payload) {
  return message({ type: "gemini:run", action, payload });
}

export async function getGeminiDebugReport() {
  if (!isExtension) return createDiagnosticReport([]);
  return message({ type: "gemini:diagnostics" });
}

export async function getGeminiDiagnosticSettings() {
  if (!isExtension) return normalizeDiagnosticSettings(null);
  return message({ type: "gemini:diagnostics-settings" });
}

export async function setGeminiDiagnosticText(includeText) {
  if (!isExtension) return normalizeDiagnosticSettings({ includeText });
  return message({ type: "gemini:diagnostics-text", includeText });
}

export function observeDiagnosticSettings(callback) {
  if (!isExtension) return () => {};
  const listener = changes => {
    if (changes[DIAGNOSTICS_SETTINGS_KEY]) callback(normalizeDiagnosticSettings(changes[DIAGNOSTICS_SETTINGS_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export async function clearGeminiDiagnostics(resetSettings = false) {
  if (!isExtension) return { cleared: true };
  return message({ type: "gemini:diagnostics-clear", resetSettings });
}

export async function syncFocusAlarm() {
  if (!isExtension) return null;
  return message({ type: "timer:sync" });
}

export async function clearFocusAlarm() {
  if (!isExtension) return null;
  return message({ type: "timer:clear" });
}

export function resetPreview() {
  if (!isExtension) localStorage.removeItem(previewKey);
}

export async function sortUnsortedTasks(manual = false) {
  if (isExtension) return message({ type: "sorting:run", manual });
  const state = await loadState();
  const tasks = sortingCandidates(state);
  const results = tasks.map(task => ({ task, rule: ruleClassification(task) })).filter(item => item.rule).map(({ task, rule }) => ({ id: task.id, ...rule }));
  return { state: await saveState(applySortResults(state, tasks, results)), error: "" };
}

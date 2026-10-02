import { recordAiUsage, COUNTED_AI_ACTIONS } from "./core/ai-usage.js";
import { createActivityController } from "./activity-controller.js";
import { createReminderController } from "./reminder-controller.js";
import { ACTIVITY_ALARM, ACTIVITY_KEY } from "./core/activity.js";
import { REMINDER_ALARM } from "./core/reminders.js";
import { RECOVERY_KEY, delayedBlocks, proposeRecovery, applyRecovery, undoRecovery } from "./core/recovery.js";
import { sortingCandidates, sortingFingerprint, ruleClassification, applySortResults, buildSortingRequest, validateSorting } from "./core/task-sorting.js";
import {
  buildCaptureRequest,
  buildMultiCaptureRequest,
  buildConnectionRequest,
  buildExplanationRequest,
  buildReflectionRequest,
  DEFAULT_MODEL,
  GEMINI_ENDPOINT,
  parseStructuredResponse,
  publicGeminiError,
  validateCaptureDraft,
  validateMultiCaptureDraft,
  validateConnection,
  validateExplanation,
  validateReflection
} from "./core/ai-contracts.js";
import { normalizeState, STATE_KEY } from "./core/state.js";
import { applyKanbanAction, reconcileKanban } from "./core/kanban.js";
import { activeCustomInstructions, withCustomInstructions } from "./core/memory.js";
import { buildCaptureContext, multipleFocusBlocksEnabled } from "./core/capture.js";
import { FOCUS_ALARM, applyTimerAction } from "./core/timer.js";
import { APP_VERSION } from "./core/release.js";
import { createBrowserTracker } from "./browser-tracker.js";
import { TRACKING_ALARM } from "./core/browser-tracking.js";
import { createMemoryWorker } from "./memory-worker.js";
import { MEMORY_ALARM, selectMemories } from "./core/learned-memory.js";
import { buildDayAdviceRequest, validateDayAdvice } from "./core/day-advice.js";
import { buildGuidanceRequest, validateGuidance } from "./core/guided-planning.js";
import { appendDiagnostic, createDiagnosticReport, diagnosticRequestText, DIAGNOSTICS_KEY, DIAGNOSTICS_SETTINGS_KEY, extractProviderError, httpFailureDetails, normalizeDiagnostic, normalizeDiagnosticSettings } from "./core/diagnostics.js";

const SESSION_KEY = "studioGeminiSessionKey";
const REMEMBERED_KEY = "studioGeminiRememberedKey";
const MODEL_KEY = "studioGeminiModel";
const LAST_TEST_KEY = "studioGeminiLastTestAt";
let diagnosticWrites = Promise.resolve();
let interactiveRequests = 0;
let appWrites = Promise.resolve();
function queueAppWrite(operation) {
  const result = appWrites.then(operation);
  appWrites = result.catch(() => {});
  return result;
}
const browserTracker = createBrowserTracker(chrome);
const readApp = async () => normalizeState((await chrome.storage.local.get(STATE_KEY))[STATE_KEY]);
const activityController = createActivityController(chrome, {
  readApp, requestAI: (preparedRequest, validator) => runGemini("activity-classify", { preparedRequest, validator })
});
const reminderController = createReminderController(chrome, { readApp, readActivity: () => activityController.read() });
const activityTick = () => { void activityController.tick().catch(() => {}); };
const reminderTick = () => { void reminderController.tick().catch(() => {}); };
chrome.tabs?.onActivated?.addListener(activityTick);
chrome.tabs?.onUpdated?.addListener((_id,changes) => { if(changes.url!==undefined||changes.title!==undefined||changes.audible!==undefined||changes.status==="complete")activityTick(); });
chrome.tabs?.onRemoved?.addListener(activityTick);
chrome.windows?.onFocusChanged?.addListener(activityTick);
let activityIdleWired=false;
function wireActivityIdle(){if(!activityIdleWired&&chrome.idle?.onStateChanged){chrome.idle.onStateChanged.addListener(activityTick);activityIdleWired=true;}}
wireActivityIdle();
chrome.permissions?.onAdded?.addListener(()=>{wireActivityIdle();activityTick();void activityController.syncScripts().catch(()=>{});reminderTick();});
chrome.permissions?.onRemoved?.addListener(()=>{activityTick();void activityController.syncScripts().catch(()=>{});reminderTick();});
let notificationsWired=false;
function wireNotifications(){
  if(notificationsWired||!chrome.notifications?.onButtonClicked)return;
  chrome.notifications.onButtonClicked.addListener((id,index)=>{void reminderController.click(id,index).catch(()=>{});});
  chrome.notifications.onClicked?.addListener(id=>{void reminderController.click(id).catch(()=>{});});notificationsWired=true;
}
wireNotifications();chrome.permissions?.onAdded?.addListener(wireNotifications);
activityTick();reminderTick();void activityController.syncScripts().catch(()=>{});
const trackingTick = (pause = false) => { void browserTracker.tick(pause).catch(() => {}); };
chrome.tabs?.onActivated?.addListener(() => trackingTick());
chrome.tabs?.onUpdated?.addListener((_id, changes, tab) => {
  if (tab?.active && (Object.hasOwn(changes, "url") || changes.status === "complete")) trackingTick();
});
chrome.tabs?.onRemoved?.addListener(() => trackingTick());
chrome.windows?.onFocusChanged?.addListener(id => trackingTick(id === -1));
let trackingIdleListenerAdded = false;
function wireTrackingIdleEvents() {
  if (!trackingIdleListenerAdded && chrome.idle?.onStateChanged) {
    chrome.idle.onStateChanged.addListener(state => trackingTick(state !== "active"));
    trackingIdleListenerAdded = true;
  }
}
wireTrackingIdleEvents();
chrome.permissions?.onAdded?.addListener(() => { wireTrackingIdleEvents(); trackingTick(); });
chrome.permissions?.onRemoved?.addListener(() => trackingTick(true));
// Restore the heartbeat on a cold worker start; session IDs prevent browser-downtime backfill.
trackingTick();
const memoryWorker = createMemoryWorker({
  storage: chrome.storage.local, alarms: chrome.alarms,
  readState: async () => normalizeState((await chrome.storage.local.get(STATE_KEY))[STATE_KEY]),
  readCredential,
  requestUpdate: (preparedRequest, validator) => runGemini("memory-update", { preparedRequest, validator }),
  interactiveBusy: () => interactiveRequests > 0
});

function writeDiagnostic(record) {
  const operation = diagnosticWrites.then(async () => {
    const saved = await chrome.storage.local.get([DIAGNOSTICS_KEY, DIAGNOSTICS_SETTINGS_KEY]);
    const settings = normalizeDiagnosticSettings(saved[DIAGNOSTICS_SETTINGS_KEY]);
    const current = { ...record };
    if (!settings.includeText || record.debugTextRevision !== settings.revision) delete current.requestText;
    await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: appendDiagnostic(saved[DIAGNOSTICS_KEY], current, { includeText: settings.includeText }) });
  });
  diagnosticWrites = operation.catch(() => {});
  return operation;
}

async function readDiagnosticSettings() {
  const saved = await chrome.storage.local.get(DIAGNOSTICS_SETTINGS_KEY);
  return normalizeDiagnosticSettings(saved[DIAGNOSTICS_SETTINGS_KEY]);
}

function setDiagnosticText(includeText) {
  if (typeof includeText !== "boolean") throw new Error("Choose whether to include debug text.");
  const operation = diagnosticWrites.then(async () => {
    const saved = await chrome.storage.local.get([DIAGNOSTICS_KEY, DIAGNOSTICS_SETTINGS_KEY]);
    const previous = normalizeDiagnosticSettings(saved[DIAGNOSTICS_SETTINGS_KEY]);
    const settings = { includeText, revision: Math.max(Date.now(), previous.revision + 1) };
    const records = Array.isArray(saved[DIAGNOSTICS_KEY]) ? saved[DIAGNOSTICS_KEY] : [];
    await chrome.storage.local.set({
      [DIAGNOSTICS_SETTINGS_KEY]: settings,
      [DIAGNOSTICS_KEY]: records.map(record => normalizeDiagnostic(record, { includeText }))
    });
    return settings;
  });
  diagnosticWrites = operation.catch(() => {});
  return operation;
}

function clearDiagnostics(resetSettings = false) {
  const operation = diagnosticWrites.then(async () => {
    const previous = await readDiagnosticSettings();
    await chrome.storage.local.set({
      [DIAGNOSTICS_KEY]: [],
      [DIAGNOSTICS_SETTINGS_KEY]: { includeText: resetSettings ? false : previous.includeText, revision: Math.max(Date.now(), previous.revision + 1) }
    });
  });
  diagnosticWrites = operation.catch(() => {});
  return operation;
}

async function ensureInitialState() {
  const result = await chrome.storage.local.get(STATE_KEY);
  if (!result[STATE_KEY]) await chrome.storage.local.set({ [STATE_KEY]: normalizeState(null) });
}

async function enableActionSidePanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    // Chrome may briefly reject this while restoring a profile; the manifest still exposes the panel.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void queueAppWrite(ensureInitialState).then(() => reconcileStoredFocus()).catch(() => {});
  void enableActionSidePanel();
  void memoryWorker.initialize().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  trackingTick();
  void reconcileStoredFocus().catch(() => {});
  void enableActionSidePanel();
  void memoryWorker.initialize().catch(() => {});
});

chrome.storage.onChanged?.addListener((changes, area) => {
  if (area === "local" && changes[STATE_KEY]?.oldValue && changes[STATE_KEY]?.newValue) {
    void memoryWorker.observe(changes[STATE_KEY].oldValue, changes[STATE_KEY].newValue).catch(() => {});
  }
});

async function readCredential() {
  const [session, local] = await Promise.all([
    chrome.storage.session.get(SESSION_KEY),
    chrome.storage.local.get([REMEMBERED_KEY, MODEL_KEY, LAST_TEST_KEY])
  ]);
  return {
    apiKey: session[SESSION_KEY] || local[REMEMBERED_KEY] || "",
    remembered: Boolean(local[REMEMBERED_KEY]),
    model: validModel(local[MODEL_KEY]) ? local[MODEL_KEY] : DEFAULT_MODEL,
    lastTestAt: local[LAST_TEST_KEY] || null
  };
}

function validModel(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._-]{3,100}$/.test(value);
}

async function storeCredential(apiKey, remember, model) {
  const key = String(apiKey ?? "").trim();
  if (key.length < 20 || key.length > 500) throw new Error("Enter a valid Google AI Studio API key.");
  if (!validModel(model)) throw new Error("Enter a valid Gemini model name.");
  if (remember) {
    await chrome.storage.local.set({ [REMEMBERED_KEY]: key, [MODEL_KEY]: model });
    await chrome.storage.session.remove(SESSION_KEY);
  } else {
    await chrome.storage.session.set({ [SESSION_KEY]: key });
    await chrome.storage.local.remove(REMEMBERED_KEY);
    await chrome.storage.local.set({ [MODEL_KEY]: model });
  }
}

async function clearCredential() {
  await Promise.all([
    chrome.storage.session.remove(SESSION_KEY),
    chrome.storage.local.remove([REMEMBERED_KEY, LAST_TEST_KEY])
  ]);
}

async function callGemini(request, credential, diagnostic) {
  diagnostic.phase = "request";
  diagnostic.requestSent = true;
  diagnostic.inputCharacters = request.input.length;
  diagnostic.schemaCharacters = JSON.stringify(request.schema).length;
  diagnostic.schemaVariant = request.schemaVariant;
  if (diagnostic.debugTextEnabled && !["test", "activity-classify"].includes(diagnostic.action)) {
    // The system wrapper is app-owned; log only the saved instructions actually
    // attached to this request. Never copy the credential or request headers.
    let instructions = "", savedMemoryContext = "";
    if (request.systemInstruction) {
      try {
        const context = JSON.parse(request.systemInstruction.split("\n").at(-1));
        instructions = context.custom_instructions ?? "";
        savedMemoryContext = context.saved_memories ? JSON.stringify(context.saved_memories) : "";
      } catch {}
    } else if (diagnostic.action === "memory-update") {
      try { instructions = JSON.parse(request.input.split("\n").at(-1)).custom_instructions ?? ""; } catch {}
    }
    diagnostic.requestText = diagnosticRequestText(request.input, instructions, [credential.apiKey], undefined, savedMemoryContext);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  let response;
  let body = null;
  try {
    response = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": credential.apiKey
      },
      body: JSON.stringify({
        model: credential.model,
        store: false,
        input: request.input,
        ...(request.systemInstruction ? { system_instruction: request.systemInstruction } : {}),
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: request.schema
        }
      }),
      signal: controller.signal
    });
    diagnostic.phase = "response";
    diagnostic.httpStatus = response.status;
    try { body = await response.json(); }
    catch (error) {
      if (error?.name === "AbortError" || controller.signal.aborted) throw Object.assign(new Error("Timed out"), { name: "AbortError" });
      diagnostic.code = "invalid_response";
    }
  } catch (error) {
    if (error?.name === "AbortError") { diagnostic.code = "timeout"; throw new Error("Gemini took too long to respond. Try again."); }
    diagnostic.code = "network_error";
    throw new Error("Could not reach the Gemini API. Check your connection and try again.");
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    Object.assign(diagnostic, httpFailureDetails(response.status, body));
    if (diagnostic.requestText) {
      const previous = diagnostic.requestText;
      diagnostic.requestText = {
        ...previous,
        ...diagnosticRequestText(previous.prompt, previous.customInstructions, [credential.apiKey], extractProviderError(body).message, previous.savedMemoryContext),
        promptTruncated: previous.promptTruncated,
        customInstructionsTruncated: previous.customInstructionsTruncated
      };
    }
    throw new Error(publicGeminiError(response.status, body));
  }
  if (diagnostic.code === "invalid_response") throw new Error("Gemini returned an unreadable API response. Export a debug report from Settings if it happens again.");
  diagnostic.interactionStatus = body?.status;
  return body;
}

async function runGemini(action, payload = {}) {
  const started = Date.now();
  const diagnostic = { timestamp: new Date(started).toISOString(), appVersion: APP_VERSION, action, phase: "setup", code: "internal_error" };
  if (action !== "memory-update") interactiveRequests += 1;
  try {
    await diagnosticWrites;
    const settings = await readDiagnosticSettings().catch(() => normalizeDiagnosticSettings(null));
    diagnostic.debugTextEnabled = settings.includeText;
    diagnostic.debugTextRevision = settings.revision;
    const data = await runGeminiAttempt(action, payload, diagnostic);
    diagnostic.phase = "complete";
    diagnostic.code = "ok";
    return data;
  } catch (error) {
    if (diagnostic.phase === "context" && diagnostic.code === "internal_error") diagnostic.code = "context_error";
    throw error;
  } finally {
    if (action !== "memory-update") interactiveRequests -= 1;
    diagnostic.durationMs = Date.now() - started;
    if (diagnostic.requestSent && COUNTED_AI_ACTIONS.has(action)) await queueAppWrite(async () => {
      const stored = await chrome.storage.local.get(STATE_KEY);
      const latest = normalizeState(stored[STATE_KEY]);
      latest.aiUsage = recordAiUsage(latest.aiUsage, action);
      await chrome.storage.local.set({ [STATE_KEY]: latest });
    }).catch(() => {});
    // A failed debug write must never turn a successful draft into an error.
    await writeDiagnostic(diagnostic).catch(() => {});
  }
}

async function runGeminiAttempt(action, payload, diagnostic) {
  const credential = await readCredential();
  if (action === "test" && payload.modelOverride && validModel(payload.modelOverride)) credential.model = payload.modelOverride;
  diagnostic.model = credential.model;
  if (!credential.apiKey) { diagnostic.code = "missing_key"; throw new Error("Connect a Gemini API key first."); }
  if (action === "test") {
    const response = await callGemini(buildConnectionRequest(), credential, diagnostic);
    return parseStructuredResponse(response, validateConnection, diagnostic);
  }
  if (action === "activity-classify") {
    // Browsing summaries have their own opt-in and never enter memory/debug text.
    const response = await callGemini(payload.preparedRequest, credential, diagnostic);
    return parseStructuredResponse(response, payload.validator, diagnostic);
  }
  if (action === "memory-update") {
    diagnostic.phase = "context";
    const context = JSON.parse(payload.preparedRequest.input.split("\n").at(-1));
    diagnostic.memoryCharacters = context.custom_instructions.length;
    diagnostic.learnedMemoryCharacters = context.memories.reduce((sum, item) => sum + item.text.length, 0);
    diagnostic.selectedMemoryCount = context.memories.length;
    const response = await callGemini(payload.preparedRequest, credential, diagnostic);
    return parseStructuredResponse(response, payload.validator, diagnostic);
  }
  if (!["capture", "explain", "reflect", "advice", "sort"].includes(action)) throw new Error("Unknown Gemini action.");
  // Read the latest saved preference, never an unsaved or caller-supplied draft.
  const saved = await chrome.storage.local.get(STATE_KEY);
  const memory = saved[STATE_KEY]?.memory;
  diagnostic.phase = "context";
  diagnostic.memoryCharacters = activeCustomInstructions(memory).length;
  const callWithMemory = async request => {
    const learned = await memoryWorker.get().catch(() => null);
    // Scope selection uses actual request data, not app-owned prompt prose.
    const selected = selectMemories(learned, action, action === "capture" ? payload.text : request.input.split("\n").at(-1));
    diagnostic.learnedMemoryCharacters = selected.reduce((sum, item) => sum + item.text.length, 0);
    diagnostic.selectedMemoryCount = selected.length;
    const language = saved[STATE_KEY]?.preferences?.language === "vi" ? "Vietnamese" : "English";
    const localized = { ...request, input: `Write brief, neutral user-facing text in ${language}. No decorative phrasing. Keep JSON keys and enum values unchanged.\n${request.input}` };
    const response = await callGemini(withCustomInstructions(localized, memory, selected), credential, diagnostic);
    await memoryWorker.recordContext(action, selected).catch(() => {});
    return response;
  };
  if (action === "sort") {
    const state = normalizeState(saved[STATE_KEY]);
    const request = buildSortingRequest(payload.tasks, state);
    return parseStructuredResponse(await callWithMemory(request), value => validateSorting(value, payload.tasks), diagnostic);
  }
  if (action === "advice") {
    const state = normalizeState(saved[STATE_KEY]);
    const request = buildDayAdviceRequest(state, new Date(), payload.timezone);
    if (state.preferences.planningAssistance === "guided") {
      const guided = buildGuidanceRequest(request, payload.reflection);
      return parseStructuredResponse(await callWithMemory(guided), validateGuidance, diagnostic);
    }
    return parseStructuredResponse(await callWithMemory(request), value => validateDayAdvice(value, state, request.taskIds), diagnostic);
  }
  if (action === "capture") {
    const state = normalizeState(saved[STATE_KEY]);
    diagnostic.promptCharacters = String(payload.text).slice(0, 2000).length;
    diagnostic.mode = multipleFocusBlocksEnabled(state) ? "multiple-blocks" : "single-task";
    if (multipleFocusBlocksEnabled(state)) {
      const context = buildCaptureContext(state, new Date(), payload.timezone);
      const request = buildMultiCaptureRequest(payload.text, context);
      return parseStructuredResponse(await callWithMemory(request), validateMultiCaptureDraft, diagnostic);
    }
    const request = buildCaptureRequest(payload.text, {
      nowIso: payload.nowIso,
      timezone: payload.timezone,
      defaultDuration: payload.defaultDuration
    });
    return parseStructuredResponse(await callWithMemory(request), validateCaptureDraft, diagnostic);
  }
  if (action === "explain") {
    const request = buildExplanationRequest(payload.proposal, payload.tasks ?? [], payload.timezone);
    return parseStructuredResponse(await callWithMemory(request), validateExplanation, diagnostic);
  }
  if (action === "reflect") {
    const request = buildReflectionRequest(payload.metrics ?? {});
    return parseStructuredResponse(await callWithMemory(request), validateReflection, diagnostic);
  }
  throw new Error("Unknown Gemini action.");
}

let sortingRun = null;
function runSorting() {
  if (sortingRun) return sortingRun;
  sortingRun = (async () => {
    const credential = await readCredential();
    const batch = await queueAppWrite(async () => {
      const saved = await chrome.storage.local.get(STATE_KEY);
      let current = normalizeState(saved[STATE_KEY]);
      if (!current.preferences.autoSort) return [];
      const candidates = sortingCandidates(current);
      const rules = candidates.map(task => ({ task, rule: ruleClassification(task) })).filter(item => item.rule);
      const decisions = rules.map(({ task, rule }) => ({ id: task.id, ...rule }));
      for (const task of current.tasks) if (decisions.some(item => item.id === task.id)) task.sortFingerprint = sortingFingerprint(task);
      current = applySortResults(current, candidates, decisions);
      const pending = credential.apiKey ? sortingCandidates(current).slice(0, 10) : [];
      // Claim the batch before the network call: worker restarts and failed
      // requests cannot repeatedly consume quota for the same task revision.
      for (const task of pending) task.sortFingerprint = sortingFingerprint(task);
      await chrome.storage.local.set({ [STATE_KEY]: current });
      return structuredClone(pending);
    });
    let error = "";
    if (batch.length) {
      try {
        const decisions = await runGemini("sort", { tasks: batch });
        await queueAppWrite(async () => {
          const saved = await chrome.storage.local.get(STATE_KEY);
          const current = normalizeState(saved[STATE_KEY]);
          const next = applySortResults(current, batch, decisions);
          await chrome.storage.local.set({ [STATE_KEY]: next });
        });
      } catch (failure) { error = String(failure.message || "Sorting failed."); }
    }
    const state = normalizeState((await chrome.storage.local.get(STATE_KEY))[STATE_KEY]);
    return { state, error };
  })().finally(() => { sortingRun = null; });
  return sortingRun;
}

async function syncTimerIndicators(state) {
  await chrome.alarms.clear(FOCUS_ALARM);
  const endsAt = state.focus.status === "running" ? new Date(state.focus.endsAt).getTime() : 0;
  if (Number.isFinite(endsAt) && endsAt > Date.now()) {
    await chrome.alarms.create(FOCUS_ALARM, { when: endsAt });
  }
  const text = state.focus.status === "ready" ? (state.focus.phase === "break" ? "REST" : "NEXT") : state.focus.status === "complete" ? "DONE" : "";
  await chrome.action?.setBadgeText?.({ text });
  await chrome.action?.setBadgeBackgroundColor?.({ color: "#243d30" });
}

function runStoredTimer(action = "reconcile", options = {}) {
  return queueAppWrite(async () => {
    const result = await chrome.storage.local.get(STATE_KEY);
    const state = normalizeState(result[STATE_KEY]);
    const next = normalizeState(reconcileKanban(applyTimerAction(state, action, options), state));
    if (JSON.stringify(next) !== JSON.stringify(result[STATE_KEY])) await chrome.storage.local.set({ [STATE_KEY]: next });
    await syncTimerIndicators(next);
    return next;
  });
}
const reconcileStoredFocus = () => runStoredTimer();
const syncAlarmFromState = () => runStoredTimer();

// Chrome can discard alarms on reload/update. Rebuild from the persisted deadline
// whenever this worker starts, without starting a further phase automatically.
void reconcileStoredFocus().catch(() => {});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ACTIVITY_ALARM) void activityController.tick().then(() => activityController.ai(false)).catch(() => {});
  if (alarm.name === REMINDER_ALARM) reminderTick();
  if (alarm.name === TRACKING_ALARM) trackingTick();
  if (alarm.name === FOCUS_ALARM) void reconcileStoredFocus().catch(() => {});
  if (alarm.name === MEMORY_ALARM) void memoryWorker.initialize().then(() => memoryWorker.update(false)).catch(() => {});
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  (async () => {
    if (["activity:signal", "activity:signal-hello"].includes(request?.type)) return activityController.recordSignal(request,_sender);
    const ownPanel = Boolean(_sender.tab && chrome.runtime.getURL && String(_sender.url??"").split(/[?#]/)[0] === chrome.runtime.getURL("src/sidepanel.html"));
    if ((_sender.id && _sender.id !== chrome.runtime.id) || _sender.tab && !ownPanel) throw new Error("Use these controls in the Stuđiô panel.");
    if (request?.type?.startsWith("activity:") || request?.type?.startsWith("reminder:") || request?.type?.startsWith("recovery:")) {
      if (chrome.extension?.inIncognitoContext) throw new Error("Use these controls in the regular Stuđiô panel.");
      if (request.type === "activity:get") return activityController.tick();
      if (request.type === "activity:ai") return activityController.ai(true);
      if (request.type === "activity:action") {
        if(request.action === "settings" && request.options?.enabled === true) await browserTracker.setEnabled(false);
        const result=await activityController.act(request.action,request.options);
        activityTick();return result;
      }
      if(request.type === "reminder:get") return reminderController.read();
      if(request.type === "reminder:action") { const result=await reminderController.act(request.action,request.options);reminderTick();return result; }
      if(request.type === "recovery:action") return queueAppWrite(async()=>{
        const state=await readApp();
        const saved=(await chrome.storage.local.get(RECOVERY_KEY))[RECOVERY_KEY]??{pending:null,history:[]};
        if(request.action === "propose") saved.pending=proposeRecovery(state,request.options?.choices);
        if(request.action === "dismiss") saved.pending=null;
        let next=state;
        if(request.action === "apply") {
          if(saved.pending?.id!==request.options?.id)throw new Error("Recovery proposal no longer exists.");
          const result=applyRecovery(state,saved.pending);next=result.state;saved.history=[...(saved.history??[]),result.history].slice(-10);saved.pending=null;
        }
        if(request.action === "undo") {
          next=undoRecovery(state,saved.history.find(h=>h.id===request.options?.id));saved.history=saved.history.filter(h=>h.id!==request.options.id);saved.pending=null;
        }
        if(!["get","propose","dismiss","apply","undo"].includes(request.action))throw new Error("Unknown recovery action.");
        if(request.action!=="get")await chrome.storage.local.set({[STATE_KEY]:next,[RECOVERY_KEY]:saved});
        return {state:next,...saved,delayed:delayedBlocks(next)};
      });
      throw new Error("Unknown activity request.");
    }
    if (request?.type === "app:save" || request?.type === "timer:action" || request?.type === "kanban:action") {
      if ((_sender.id && _sender.id !== chrome.runtime.id) || _sender.tab && !ownPanel) throw new Error("Use these controls in the Stuđiô panel.");
      if (request.type === "timer:action") return runStoredTimer(request.action, request.options);
      if (request.type === "kanban:action") return queueAppWrite(async () => {
        const stored = await chrome.storage.local.get(STATE_KEY);
        const next = normalizeState(applyKanbanAction(normalizeState(stored[STATE_KEY]), request.action, request.options));
        await chrome.storage.local.set({ [STATE_KEY]: next });
        return next;
      });
      return queueAppWrite(async () => {
        const result = await chrome.storage.local.get(STATE_KEY);
        const current = normalizeState(result[STATE_KEY]);
        const next = normalizeState(request.state);
        // Timer history belongs to the serialized background writer. A form
        // open during an alarm must not restore an earlier interval or drop it.
        next.focus = current.focus;
        next.sessions = current.sessions;
        // A form opened before a recovery must not restore the previous schedule.
        if (next.schedulingRevision < current.schedulingRevision) next.schedule = current.schedule.map(block => {
          const task=next.tasks.find(t=>t.id===block.taskId);
          return block.status==="planned"&&(!task||["done","archived"].includes(task.status))?{...block,status:"skipped"}:block;
        });
        next.schedulingRevision = current.schedulingRevision;
        // Kanban has its own serialized actions. Stale task/settings forms must
        // not undo a timer-driven move, opt-out, blocker or automation setting.
        next.kanban = current.kanban;
        next.aiUsage = { ...current.aiUsage, promptSeenAt: current.aiUsage.promptSeenAt || next.aiUsage.promptSeenAt };
        next.tasks = next.tasks.map(task => {
          const latest = current.tasks.find(item => item.id === task.id);
          return latest?.sortFingerprint && latest.sortFingerprint === sortingFingerprint(task) ? latest : task;
        });
        next.events = [...new Map([...current.events, ...next.events].map(event => [event.id, event])).values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-5000);
        const done = new Set(current.schedule.filter(block => block.status === "done").map(block => block.id));
        next.schedule = next.schedule.map(block => done.has(block.id) ? { ...block, status: "done" } : block);
        const reconciled = reconcileKanban(next, current);
        await chrome.storage.local.set({ [STATE_KEY]: reconciled });
        return reconciled;
      });
    }
    if (request?.type === "sorting:run") {
      if ((_sender.id && _sender.id !== chrome.runtime.id) || _sender.tab && !ownPanel) throw new Error("Use these controls in the Stuđiô panel.");
      return runSorting();
    }
    if (request?.type?.startsWith("tracking:")) {
      if ((_sender.id && _sender.id !== chrome.runtime.id) || _sender.tab && !ownPanel || chrome.extension?.inIncognitoContext) throw new Error("Tracking controls are available only in the regular Stuđiô panel.");
      if (request.type === "tracking:get") return browserTracker.tick();
      if (request.type === "tracking:enable") { await activityController.act("settings",{enabled:false});return browserTracker.setEnabled(true); }
      if (request.type === "tracking:pause") return browserTracker.setEnabled(false);
      if (request.type === "tracking:clear") return browserTracker.clear();
      throw new Error("Unknown tracking action.");
    }
    if (request?.type === "gemini:status") {
      const credential = await readCredential();
      return {
        connected: Boolean(credential.apiKey),
        remembered: credential.remembered,
        model: credential.model,
        lastTestAt: credential.lastTestAt
      };
    }
    if (request?.type === "gemini:connect") {
      await storeCredential(request.apiKey, Boolean(request.remember), request.model || DEFAULT_MODEL);
      try {
        const data = await runGemini("test");
        const lastTestAt = new Date().toISOString();
        await chrome.storage.local.set({ [LAST_TEST_KEY]: lastTestAt });
        const credential = await readCredential();
        return { ...data, connected: true, remembered: credential.remembered, model: credential.model, lastTestAt };
      } catch (error) {
        await clearCredential();
        throw error;
      }
    }
    if (request?.type === "gemini:disconnect") {
      await clearCredential();
      return { connected: false, remembered: false, model: (await readCredential()).model };
    }
    if (request?.type === "gemini:model") {
      if (!validModel(request.model)) throw new Error("Choose a valid Gemini model.");
      const result = await runGemini("test", { modelOverride: request.model });
      const lastTestAt = new Date().toISOString();
      await chrome.storage.local.set({ [MODEL_KEY]: request.model, [LAST_TEST_KEY]: lastTestAt });
      const credential = await readCredential();
      return { ...result, connected: true, remembered: credential.remembered, model: request.model, lastTestAt };
    }
    if (request?.type === "gemini:run") {
      if (!["test", "capture", "explain", "reflect", "advice"].includes(request.action)) throw new Error("Unknown Gemini action.");
      return runGemini(request.action, request.payload);
    }
    if (request?.type === "app:replace") {
      return queueAppWrite(async () => {
      await activityController.act(request.reset === true ? "clear" : "settings", { enabled:false, aiEnabled:false });
      await reminderController.act("clear");
      await chrome.storage.local.set({ [RECOVERY_KEY]:{pending:null,history:[]} });
      if (request.reset === true) await browserTracker.clear();
      else await browserTracker.setEnabled(false);
      const state = normalizeState(request.state);
      const memory = request.reset === true ? await memoryWorker.clear(state) : await memoryWorker.restore(request.memory, state);
      await syncTimerIndicators(state);
      return { state, memory };
      });
    }
    if (request?.type === "memory:get") { await memoryWorker.initialize(); return memoryWorker.get(); }
    if (request?.type === "memory:settings") return memoryWorker.settings(request.patch);
    if (request?.type === "memory:save") return memoryWorker.save(request.draft);
    if (request?.type === "memory:note") return memoryWorker.note(request.text, request.scope);
    if (request?.type === "memory:confirm") return memoryWorker.confirm(request.id);
    if (request?.type === "memory:forget") return memoryWorker.forget(request.id);
    if (request?.type === "memory:undo") return memoryWorker.undo(request.id);
    if (request?.type === "memory:update") return memoryWorker.update(true);
    if (request?.type === "memory:clear") return memoryWorker.clear();
    if (request?.type === "memory:export") return memoryWorker.export();
    if (request?.type === "memory:restore") return memoryWorker.restore(request.backup);
    if (request?.type === "gemini:diagnostics") {
      await diagnosticWrites;
      const [saved, credential] = await Promise.all([
        chrome.storage.local.get([DIAGNOSTICS_KEY, DIAGNOSTICS_SETTINGS_KEY]), readCredential()
      ]);
      const settings = normalizeDiagnosticSettings(saved[DIAGNOSTICS_SETTINGS_KEY]);
      return createDiagnosticReport(saved[DIAGNOSTICS_KEY], new Date(), { includeText: settings.includeText, secrets: [credential.apiKey] });
    }
    if (request?.type === "gemini:diagnostics-settings") { await diagnosticWrites; return readDiagnosticSettings(); }
    if (request?.type === "gemini:diagnostics-text") return setDiagnosticText(request.includeText);
    if (request?.type === "gemini:diagnostics-clear") { await clearDiagnostics(request.resetSettings === true); return { cleared: true }; }
    if (request?.type === "timer:sync") return syncAlarmFromState();
    if (request?.type === "timer:clear") {
      await chrome.alarms.clear(FOCUS_ALARM);
      return { cleared: true };
    }
    throw new Error("Unknown background request.");
  })()
    .then(data => sendResponse({ ok: true, data }))
    .catch(error => sendResponse({ ok: false, error: String(error?.message || "Request failed.").slice(0, 300) }));
  return true;
});

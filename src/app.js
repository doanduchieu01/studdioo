import { createActivityUI } from "./activity-ui.js";
import { renderPrivacy } from "./privacy-view.js";
import { learningTopic, learningContext, currentLearningStep, normalizeLearningGuide } from "./core/learning-guide.js";
import { renderLearningOffer, renderLearningCard, renderLearningCenter, showLearningTarget, clearLearningTarget, guideText, trapDialogKey } from "./learning-view.js";
import { renderLocalExtrasDialog, renderAIWarning, renderAIPolicy, renderAbout } from "./features-view.js";
import { MEDIA_PRESETS, localExtrasState } from "./core/media-sites.js";
import { getAIPolicy, setAIPolicy, requestLocalExtrasPermission, applyLocalExtras, revokeMediaAccess, observeAIPolicy } from "./platform.js";
import { getLearningGuide, learningGuideAction } from "./platform.js";
import { nextFocus } from "./core/daily-flow.js";
import { delayedBlocks } from "./core/recovery.js";
import { resourceIdentity } from "./core/activity.js";
import { performActivityAction, performReminderAction, requestSignalPermission, requestNotificationPermission } from "./platform.js";
import { t, html, msg, markup, setLanguage, getLocale } from "./i18n.js";
import { planningPromptEligible } from "./core/ai-usage.js";
import { sortingCandidates, sortingFingerprint, ruleClassification } from "./core/task-sorting.js";
import {
  addTask,
  applyProposal,
  archiveTask,
  completeTask,
  createBackup,
  createDefaultState,
  dismissProposal,
  normalizeState,
  pendingProposal,
  restoreBackup,
  saveProposal,
  updateMemory,
  updateTask
} from "./core/state.js";
import {
  attachExplanation,
  blocksForDay,
  deriveTodayRoute,
  nextBlock,
  proposeSchedule,
  schedulableTasks
} from "./core/scheduler.js";
import {
  reconcileFocus,
  timerSnapshot
} from "./core/timer.js";
import { computeAnalytics, privacyReducedReflectionPayload } from "./core/analytics.js";
import { DEFAULT_MODEL } from "./core/ai-contracts.js";
import { FREE_TIER_MODELS, MODEL_CATALOG_CHECKED_AT, MODEL_PRICING_URL } from "./core/models.js";
import { normalizeLearnedMemory } from "./core/learned-memory.js";
import { renderLearnedEditor, renderLearnedSettings } from "./memory-view.js";
import { renderPlanningAssistant } from "./planning-view.js";
import { renderTrackingCard } from "./tracking-view.js";
import { renderBudget, renderEisenhower, renderTimeTools } from "./time-management-view.js";
import { renderKanban, renderKanbanOffer, renderKanbanSettings, renderKanbanModal } from "./kanban-view.js";
import { kanbanItem, kanbanWip } from "./core/kanban.js";
import { performKanbanAction } from "./platform.js";
import { moveToQuadrant, saveDayPlan, toggleTodayTask, useAutomaticDailyBudget } from "./core/time-management.js";
import { applyGuidedPlan } from "./core/guided-planning.js";
import { activeCustomInstructions, MAX_CUSTOM_INSTRUCTIONS_LENGTH } from "./core/memory.js";
import { APP_VERSION } from "./core/release.js";
import { applyCaptureDraft, captureIssues, multipleFocusBlocksEnabled } from "./core/capture.js";
import {
  clearFocusAlarm,
  clearGeminiDiagnostics,
  connectGemini,
  changeGeminiModel,
  disconnectGemini,
  getGeminiDebugReport,
  getGeminiDiagnosticSettings,
  getGeminiStatus,
  getTracking,
  requestTrackingPermission,
  trackingAction,
  getLearnedMemory,
  learnedMemoryAction,
  isExtension,
  performTimerAction,
  loadState,
  observeDiagnosticSettings,
  observeState,
  observeLearnedMemory,
  runGeminiAction,
  sortUnsortedTasks,
  replaceAppData,
  saveState,
  setGeminiDiagnosticText,
  syncFocusAlarm
} from "./platform.js";
import {
  escapeHtml,
  formatDay,
  formatTime,
  localDateKey,
  localDateTimeInput,
  minutesLabel,
  safeDate,
  titleCase,
  uid
} from "./core/utils.js";

const app = document.querySelector("#app");
const toastRegion = document.querySelector("#toast-region");
let locale = "en-US";
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";

let state;
let gemini = { connected: false, remembered: false, model: DEFAULT_MODEL, lastTestAt: null };
let diagnosticSettings = null;
let learnedMemory = null;
let tracking = null;
let learningGuide = null;
let aiPolicy = null;
let guideReturnFocus = null;
let learningError = "";
let toastTimer;
let saveInFlight = false;
const ui = {
  view: "today",
  planView: "matrix",
  focusMinimized: false,
  modal: null,
  omnibarOpen: false,
  captureText: "",
  showGeminiForm: false,
  modelDrafts: {},
  zenMenu: false,
  busy: new Set(),
  reflection: null,
  pendingImport: null,
  memoryDraft: null,
  learnedDraft: null,
  learningNote: "",
  learningNoteScope: "general",
  pendingLearningImport: null,
  advice: null,
  guidance: null,
  guideReflection: "",
  sortError: "",
  lastSortKey: "",
  guideDraft: {},
  quickText: "", privacyMediaSetup: false, privacyAdvanced: false, learningTopic: null,
  learningTour: false, learningIndex: 0, nextTaskId: null, modalReturnSelector: null
};

const activityUI = createActivityUI({ getState: () => state, setState: next => { state = next; }, render, toast: showToast });

function icon(name, className = "") {
  return html`<svg class="icon ${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function busy(name) {
  return ui.busy.has(name);
}

function busyLabel(name, label) {
  return busy(name) ? html`<span class="loading-inline"><span class="spinner"></span>${escapeHtml(label)}</span>` : escapeHtml(label);
}

async function setBusy(name, operation) {
  ui.busy.add(name);
  render();
  try {
    return await operation();
  } finally {
    ui.busy.delete(name);
    render();
  }
}

function showToast(message, type = "success") {
  message = t(message);
  clearTimeout(toastTimer);
  toastRegion.innerHTML = html`<div class="toast ${type === "error" ? "error" : ""}">${escapeHtml(message)}</div>`;
  toastTimer = setTimeout(() => { toastRegion.innerHTML = ""; }, type === "error" ? 5200 : 3200);
}

async function commit(next, options = {}) {
  saveInFlight = true;
  try {
    state = await saveState(next);
  } finally {
    saveInFlight = false;
  }
  render();
  if (options.syncTimer) await syncFocusAlarm().catch(() => {});
  if (options.clearTimer) await clearFocusAlarm().catch(() => {});
  return state;
}

async function timerAction(action, options = {}) {
  if (busy("timer")) return;
  const previousMoves = new Set(state.kanban.changes.map(change => change.id));
  ui.busy.add("timer");
  try {
    state = await performTimerAction(action, options);
  }
  finally { ui.busy.delete("timer"); render(); }
  const move = state.kanban.changes.find(change => !previousMoves.has(change.id) && change.reason === "timer_started");
  if (move) showToast(t("Moved to Doing: task timer started.") + (kanbanWip(state).length > state.kanban.wipLimit ? t(" WIP limit exceeded.") : ""));
}

async function kanbanAction(action, options = {}) {
  if (busy("kanban")) return false;
  ui.busy.add("kanban"); saveInFlight = true;
  try { state = await performKanbanAction(action, options); return true; }
  finally { ui.busy.delete("kanban"); saveInFlight = false; render(); }
}

function taskById(id) {
  return state.tasks.find(task => task.id === id) ?? null;
}

function selectedFocus() {
  const task = activeTasks().find(item => item.id === ui.nextTaskId);
  return task ? { task, block: null, minutes: Math.min(task.durationMinutes || state.preferences.focusMinutes, state.preferences.focusMinutes) } : nextFocus(state);
}

function proposalTaskIds(proposal) {
  return new Set(proposal?.blocks?.map(block => block.taskId) ?? []);
}

function activeTasks() {
  return state.tasks.filter(task => !["done", "archived"].includes(task.status));
}

function greeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return t("Good morning");
  if (hour < 18) return t("Good afternoon");
  return t("Good evening");
}

function routeText(route) {
  return {
    capture: "A calm place to begin",
    proposal: "A proposal is waiting",
    "next-block": t("Your next block is ready"),
    review: "A quiet review day",
    focus: t("Focus in progress"),
    "post-session": t("Session complete")
  }[route] ?? t("Today");
}

function renderTopbar() {
  return html`<header class="topbar">
    <div class="brand">${icon("logo")}<span class="brand-word">Stuđiô</span></div>
    <div class="button-row">${learningContext(ui) ? `<button class="btn ghost compact" type="button" data-action="learning-start">${guideText("Explain this screen", "Giải thích màn hình")}</button>` : ""}<button class="icon-button ghost" type="button" data-action="learning-open" aria-label="${guideText("Help & tours", "Trợ giúp & hướng dẫn")}">?</button><button class="icon-button ghost" type="button" data-action="go-settings" aria-label="Open settings">${icon("settings")}</button></div>
  </header>`;
}

function renderNav() {
  const items = [
    ["today", "today", t("Today")],
    ["plan", "plan", t("Plan")],
    ["activity", "insights", t("Activity")],
    ["insights", "insights", t("Insights")],
    ["settings", "settings", t("Settings")]
  ];
  return html`<nav class="bottom-nav" aria-label="Primary navigation">${items.map(([view, symbol, label]) => html`
    <button class="nav-button ${ui.view === view ? "active" : ""}" type="button" data-action="navigate" data-view="${view}" ${ui.view === view ? 'aria-current="page"' : ""}>
      ${icon(symbol)}<span>${t(label)}</span>
    </button>`).join("")}</nav>`;
}

function renderOnboarding() {
  const step = state.profile.onboardingStep;
  const progress = html`<div class="field"><label for="welcome-language">Language / Ngôn ngữ</label><select id="welcome-language" class="select" data-preference="language"><option value="en" ${state.preferences.language === "en" ? "selected" : ""}>English</option><option value="vi" ${state.preferences.language === "vi" ? "selected" : ""}>Tiếng Việt</option></select></div><div class="onboarding-progress" aria-label="Onboarding step ${step + 1} of 4">${[0, 1, 2, 3].map(index => html`<span class="${index <= step ? "active" : ""}"></span>`).join("")}</div>`;
  if (step === 0) {
    return html`<main class="onboarding">
      ${progress}
      <section class="onboarding-body">
        <div class="breath-mark" aria-hidden="true"></div>
        <h1>Make time feel workable.</h1>
        <p class="onboarding-lead">Stuđiô helps you turn an intention into a small plan, then gives the plan enough quiet to happen.</p>
      </section>
      <footer class="onboarding-footer"><button class="btn primary wide" type="button" data-action="onboarding-defaults">Start with simple defaults ${icon("arrow")}</button><button class="btn ghost wide" type="button" data-action="onboarding-advance">Personalize first</button></footer>
    </main>`;
  }
  if (step === 1) {
    const canContinue = ["beginner", "system"].includes(state.profile.experience);
    return html`<main class="onboarding">
      ${progress}
      <section class="onboarding-body">
        <div><p class="eyebrow">Your starting point</p><h1>How do you manage time now?</h1></div>
        <div class="choice-list">
          <button class="choice ${state.profile.experience === "beginner" ? "selected" : ""}" type="button" data-action="choose-experience" data-value="beginner" aria-pressed="${state.profile.experience === "beginner"}">
            <span><strong>I’m just starting out</strong><span>Keep the surface simple. Gemini can suggest several focus blocks for review.</span></span>${state.profile.experience === "beginner" ? icon("check") : ""}
          </button>
          <button class="choice ${state.profile.experience === "system" ? "selected" : ""}" type="button" data-action="choose-experience" data-value="system" aria-pressed="${state.profile.experience === "system"}">
            <span><strong>I have my own system</strong><span>Show precise controls when I ask for them.</span></span>${state.profile.experience === "system" ? icon("check") : ""}
          </button>
        </div>
      </section>
      <footer class="onboarding-footer">
        <button class="btn primary wide" type="button" data-action="onboarding-advance" ${canContinue ? "" : "disabled"}>Continue ${icon("arrow")}</button>
        <button class="btn ghost wide" type="button" data-action="onboarding-back">Back</button>
      </footer>
    </main>`;
  }
  if (step === 2) {
    const aims = [
      ["study", t("Studying"), t("Coursework, reading, and practice")],
      ["deep-work", t("Deep work"), t("Research, coding, and complex projects")],
      ["creative", t("Creative flow"), t("Writing, designing, and making")],
      ["general", t("General productivity"), "A flexible mix of everyday work"]
    ];
    const canContinue = aims.some(([value]) => value === state.profile.aim);
    return html`<main class="onboarding">
      ${progress}
      <section class="onboarding-body">
        <div><p class="eyebrow">Your first direction</p><h1>What deserves more room?</h1></div>
        <div class="choice-list">${aims.map(([value, label, detail]) => html`
          <button class="choice ${state.profile.aim === value ? "selected" : ""}" type="button" data-action="choose-aim" data-value="${value}" aria-pressed="${state.profile.aim === value}">
            <span><strong>${label}</strong><span>${detail}</span></span>${state.profile.aim === value ? icon("check") : ""}
          </button>`).join("")}</div>
      </section>
      <footer class="onboarding-footer">
        <button class="btn primary wide" type="button" data-action="onboarding-advance" ${canContinue ? "" : "disabled"}>Continue ${icon("arrow")}</button>
        <button class="btn ghost wide" type="button" data-action="onboarding-back">Back</button>
      </footer>
    </main>`;
  }
  return html`<main class="onboarding">
    ${progress}
    ${renderPrivacyScreen()}
    <footer class="onboarding-footer">
      <button class="btn primary wide" type="button" data-action="finish-onboarding" ${busy("privacy") || busy("connect") ? "disabled" : ""}>Continue with these choices ${icon("arrow")}</button>
      <p class="field-help">Leaving optional features off is fine. Nothing else is required.</p>
      <button class="btn ghost wide" type="button" data-action="onboarding-back">Back</button>
    </footer>
  </main>`;
}

function renderPrivacyScreen() {
  const snapshot = activityUI.privacyState();
  return renderPrivacy({ state, ...snapshot, privacyReady: snapshot.privacyReady && tracking !== null && gemini.available !== false, gemini, learned: learnedMemory,
    diagnostics: diagnosticSettings, legacy: tracking, aiPolicy, advancedOpen: ui.privacyAdvanced, working: busy("privacy") || busy("connect"),
    mediaSetup: ui.privacyMediaSetup, geminiForm: ui.showGeminiForm ? renderGeminiCard() : "" });
}

async function changePrivacy(key, enabled) {
  if (busy("privacy") || busy("connect")) return;
  if (!activityUI.privacyState().privacyReady || tracking === null || gemini.available === false) throw new Error("Privacy settings are unavailable. Reopen this screen to retry.");
  if (key === "localAll") {
    if (enabled) { ui.modalReturnSelector = "#privacy-local-all"; ui.modal = { type: "local-extras", origins: MEDIA_PRESETS.map(site => site.origin) }; render(); }
    else await saveLocalExtras(false, []);
    return;
  }
  if (key === "gemini" && enabled) { ui.showGeminiForm = true; render(); return; }
  if (key === "media" && enabled) { ui.privacyMediaSetup = true; render(); return; }
  // Request optional permissions inside this original change gesture, before awaiting.
  const permission = enabled && key === "tracking" ? requestTrackingPermission()
    : enabled && key === "notifications" ? requestNotificationPermission() : Promise.resolve(true);
  await setBusy("privacy", async () => {
    if (!await permission) throw new Error(key === "tracking" ? "Tracking permission was not granted." : "Notification permission was not granted.");
    if (key === "gemini") { gemini = await disconnectGemini(); aiPolicy = await getAIPolicy(); ui.showGeminiForm = false; }
    else if (key === "legacy") tracking = await trackingAction("pause");
    else if (key === "media") {
      for (const origin of activityUI.privacyState().activity.settings.signalOrigins) await performActivityAction("site-remove", { origin });
      await performActivityAction("settings", { backgroundMedia: false }); ui.privacyMediaSetup = false;
    } else if (["tracking", "details", "backgroundMedia", "activityAI"].includes(key)) {
      if (key === "activityAI" && enabled && !gemini.connected) throw new Error("Connect Gemini before enabling activity AI.");
      await performActivityAction("settings", { [{ tracking: "enabled", activityAI: "aiEnabled" }[key] ?? key]: enabled });
    } else if (["notifications", "review"].includes(key)) await performReminderAction("settings", { [key === "notifications" ? "enabled" : "review"]: enabled });
    else if (key === "autoSort") await commit({ ...state, preferences: { ...state.preferences, autoSort: enabled } });
    else if (key === "instructions") await commit(updateMemory(state, { ...state.memory, enabled }));
    else if (["learning", "memory"].includes(key)) learnedMemory = await learnedMemoryAction("settings", { patch: { [key === "learning" ? "learningEnabled" : "useWithGemini"]: enabled } });
    else if (key === "diagnostics") diagnosticSettings = await setGeminiDiagnosticText(enabled);
    await activityUI.load();
    tracking = await getTracking().catch(() => tracking);
  });
}

async function saveLocalExtras(enabled, origins, permission = Promise.resolve(true)) {
  await setBusy("privacy", async () => {
    try {
      if (!await permission) throw new Error(guideText("Permission was not granted. Your feature choices are unchanged.", "Chưa cấp quyền. Lựa chọn tính năng không thay đổi."));
      await applyLocalExtras(enabled, origins);
      ui.modal = null;
      showToast(guideText(enabled ? "Local choices enabled. AI choices are unchanged." : "Local extras paused. Recorded history kept.", enabled ? "Đã bật lựa chọn trên máy. Lựa chọn AI không đổi." : "Đã dừng tính năng trên máy. Giữ lịch sử đã ghi."));
    } finally {
      // Independent stores can partially succeed. Always show their actual saved state.
      await activityUI.load();
      tracking = await getTracking().catch(() => null);
    }
  });
}

const CUSTOM_MODEL_CHOICE = "__custom__";

function modelPickerDraft(id) {
  const active = gemini.model || state.preferences.model || DEFAULT_MODEL;
  const listed = FREE_TIER_MODELS.some(model => model.id === active);
  return ui.modelDrafts[id] ?? { choice: listed ? active : CUSTOM_MODEL_CHOICE, custom: listed ? "" : active };
}

function renderModelPicker(id) {
  const draft = modelPickerDraft(id);
  const custom = draft.choice === CUSTOM_MODEL_CHOICE;
  const disabled = busy("connect") || !isExtension;
  return html`<div class="field">
    <label for="${id}">Gemini model</label>
    <select id="${id}" class="select" name="model" data-model-picker="${id}" ${disabled ? "disabled" : ""} required>
      ${FREE_TIER_MODELS.map(model => html`<option value="${model.id}" ${model.id === draft.choice ? "selected" : ""}>${escapeHtml(model.label)} · ${escapeHtml(t(model.detail))}</option>`).join("")}
      <option value="${CUSTOM_MODEL_CHOICE}" ${custom ? "selected" : ""}>Custom model ID…</option>
    </select>
  </div>
  <div id="${id}-custom-field" class="field model-custom" ${custom ? "" : "hidden"}>
    <label for="${id}-custom">Custom model ID</label>
    <input id="${id}-custom" class="input" name="customModel" data-model-custom="${id}" value="${escapeHtml(draft.custom)}" placeholder="gemini-model-id" spellcheck="false" autocomplete="off" ${custom ? "required" : ""} ${disabled || !custom ? "disabled" : ""}>
  </div>`;
}

function updateModelPickerDom(id) {
  const custom = modelPickerDraft(id).choice === CUSTOM_MODEL_CHOICE;
  const field = document.querySelector(`#${id}-custom-field`);
  const input = document.querySelector(`#${id}-custom`);
  if (field) field.hidden = !custom;
  if (input) {
    input.disabled = !custom || busy("connect") || !isExtension;
    input.required = custom;
  }
}

function submittedModel(data) {
  const choice = String(data.get("model") ?? "").trim();
  const model = choice === CUSTOM_MODEL_CHOICE ? String(data.get("customModel") ?? "").trim() : choice;
  if (!model) throw new Error(t("Choose a Gemini model or enter a custom model ID."));
  return model;
}

function renderGeminiCard() {
  const connected = gemini.connected && !ui.showGeminiForm;
  if (connected) {
    return html`<section class="card" aria-labelledby="gemini-title">
      <div class="card-header">
        <div><p class="eyebrow">Optional AI</p><h2 id="gemini-title">Gemini connection</h2></div>
        <span class="status-chip connected"><span class="status-dot"></span>Connected</span>
      </div>
      <p class="subtle">Active model: ${escapeHtml(gemini.model)}</p>
      <form id="model-choice-form" class="gemini-form">
        ${renderModelPicker("connected-model")}
        <button class="btn compact" type="submit" ${busy("connect") ? "disabled" : ""}>${busyLabel("connect", t("Use & test model"))}</button>
      </form>
      <p class="field-help">Choosing an option makes no request. Use &amp; test model sends one test using your current key; only a successful test switches the active model. No key re-entry needed.</p>
      <p class="field-help">Listed standard-text free-tier options checked ${MODEL_CATALOG_CHECKED_AT}. Availability and quota depend on your project; billing-enabled projects may charge. Custom IDs may require billing. <a href="${MODEL_PRICING_URL}" target="_blank" rel="noopener noreferrer">Google pricing</a></p>
      <div class="button-row">
        <button class="btn compact" type="button" data-action="show-gemini-form">Change key</button>
        <button class="btn compact ghost" type="button" data-action="disconnect-gemini">Disconnect</button>
      </div>
      <details class="mini-disclosure"><summary>What Gemini can do here</summary><p>Draft tasks or blocks, coach your planning, suggest a next step, explain a proposal, or narrate timer totals when you ask. Background memory updates require a separate opt-in, off by default. You control anything saved to your plan.</p></details>
    </section>`;
  }
  if (!ui.showGeminiForm) {
    return html`<section class="card" aria-labelledby="gemini-title">
      <div class="card-header">
        <div><p class="eyebrow">Optional AI</p><h2 id="gemini-title">Gemini connection</h2></div>
        <span class="status-chip"><span class="status-dot"></span>${isExtension ? t("Not connected") : t("Preview")}</span>
      </div>
      <p class="subtle">Stuđiô works locally without Gemini. Set it up only when you want an explicit AI action.</p>
      <div class="button-row"><button class="btn compact" type="button" data-action="show-gemini-form">Set up Gemini</button></div>
    </section>`;
  }
  return html`<section class="card" aria-labelledby="gemini-title">
    <div class="card-header">
      <div><p class="eyebrow">Optional AI</p><h2 id="gemini-title">Gemini connection</h2></div>
      <span class="status-chip"><span class="status-dot"></span>${isExtension ? t("Not connected") : t("Preview")}</span>
    </div>
    <p class="subtle">Enter your own Google AI Studio key. Stuđiô will test it without saving any task.</p>
    <form id="gemini-form" class="gemini-form">
      <div class="field">
        <label for="api-key">API key</label>
        <div class="secret-wrap">
          <input id="api-key" class="input" name="apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="Paste key" ${isExtension ? "" : "disabled"} required>
          <button class="secret-toggle" type="button" data-action="toggle-secret" aria-label="Show or hide API key">${icon("eye")}</button>
        </div>
      </div>
      ${renderModelPicker("model")}
      <p class="field-help">Choose a listed model or Custom model ID. Selection makes no request; Connect &amp; test sends one test. Listed standard-text free-tier options were checked ${MODEL_CATALOG_CHECKED_AT}; availability and quotas depend on your project. Billing-enabled projects and custom IDs may charge.</p>
      <label class="check-row"><input type="checkbox" name="remember" ${gemini.remembered ? "checked" : ""} ${isExtension ? "" : "disabled"}><span><strong>Remember on this device</strong><br>Otherwise, the key lasts only for this browser session.</span></label>
      <button class="btn primary wide" type="submit" ${busy("connect") || !isExtension ? "disabled" : ""}>${busyLabel("connect", t("Connect & test"))}</button>
    </form>
    <div class="privacy-note"><strong>Before connecting:</strong> the key is never added to backups. Every request sets <code>store: false</code>. Free-tier content may still be used by Google to improve its products.</div>
  </section>`;
}

function renderTask(task, options = {}) {
  const due = safeDate(task.dueAt);
  // Selection does not need a fresh history estimate for every task card.
  const picked = state.dayPlans?.find(plan => plan.date === localDateKey(new Date()))?.taskIds.includes(task.id) ?? false;
  return html`<article class="task">
    <div>
      <p class="task-title">${escapeHtml(task.title)}</p>
      <div class="task-meta"><span>${minutesLabel(task.durationMinutes)}</span><span>Energy: ${titleCase(task.energy)}</span>${due ? html`<span>Due ${escapeHtml(formatDay(due, locale))}, ${escapeHtml(formatTime(due, locale))}</span>` : ""}</div>
      ${!["done", "archived"].includes(task.status) ? html`<button class="btn compact ghost pick-today" type="button" data-action="toggle-today-task" data-task-id="${escapeHtml(task.id)}" aria-pressed="${picked}">${picked ? t("Picked for today") : t("Pick for today")}</button>` : ""}
    </div>
    <div class="task-actions">
      ${options.hideFocus ? "" : html`<button class="icon-button ghost" type="button" data-action="open-focus" data-task-id="${escapeHtml(task.id)}" aria-label="Focus on ${escapeHtml(task.title)}">${icon("play")}</button>`}
      <button class="icon-button ghost" type="button" data-action="edit-task" data-task-id="${escapeHtml(task.id)}" aria-label="Edit ${escapeHtml(task.title)}">${icon("edit")}</button>
      ${task.status !== "done" ? html`<button class="icon-button ghost" type="button" data-action="complete-task" data-task-id="${escapeHtml(task.id)}" aria-label="Complete ${escapeHtml(task.title)}">${icon("check")}</button>` : ""}
    </div>
  </article>`;
}

function renderTodaySchedule() {
  const blocks = blocksForDay(state, new Date());
  if (!blocks.length) return html`<div class="empty">${icon("plan")}<h3>No fixed blocks today</h3><p>Your day can stay open, or you can build a reversible proposal from Plan.</p><button class="btn compact" type="button" data-action="navigate" data-view="plan">Open Plan</button></div>`;
  return html`<div class="timeline">${blocks.map(block => {
    const task = taskById(block.taskId);
    return html`<article class="block"><span class="block-time">${escapeHtml(formatTime(block.startAt, locale))}</span><div><div class="block-title">${escapeHtml(block.label || task?.title || t("Unknown task"))}</div><div class="block-detail">${minutesLabel((new Date(block.endAt) - new Date(block.startAt)) / 60_000)} · ${titleCase(block.status)}</div></div><button class="icon-button ghost" type="button" data-action="open-focus" data-task-id="${escapeHtml(block.taskId)}" data-block-id="${escapeHtml(block.id)}" aria-label="Start this block">${icon("play")}</button></article>`;
  }).join("")}</div>`;
}

function renderAdaptiveHero(route) {
  if (route === "proposal") {
    const proposal = pendingProposal(state);
    return html`<section class="card accent"><p class="eyebrow">Review before changing anything</p><h2>A plan is waiting for you.</h2><p class="subtle">${proposal.blocks.length} proposed block${proposal.blocks.length === 1 ? "" : t("s")}. It remains separate from your schedule until you apply it.</p><div class="button-row"><button class="btn primary" type="button" data-action="navigate" data-view="plan" data-plan-view="schedule">Review proposal ${icon("arrow")}</button></div></section>`;
  }
  if (route === "next-block") {
    const block = nextBlock(state, new Date());
    const task = taskById(block?.taskId);
    return html`<section class="card accent"><p class="eyebrow">Next block · ${escapeHtml(formatTime(block.startAt, locale))}</p><h2>${escapeHtml(block.label || task?.title || t("Your next task"))}</h2><p class="subtle">${minutesLabel((new Date(block.endAt) - new Date(block.startAt)) / 60_000)} planned. Starting focus is always your choice.</p><div class="button-row"><button class="btn primary" type="button" data-action="open-focus" data-task-id="${escapeHtml(block.taskId)}" data-block-id="${escapeHtml(block.id)}">${icon("play")} Start focus</button></div></section>`;
  }
  if (route === "review") {
    const analytics = computeAnalytics(state);
    return html`<section class="card accent"><p class="eyebrow">Room to notice</p><h2>${analytics.totalFocusedMinutes} focused minutes this week.</h2><p class="subtle">There is no immediate block pulling at you. This may be a good moment to review the pattern—or simply leave the day open.</p><div class="button-row"><button class="btn primary" type="button" data-action="navigate" data-view="insights">View insights ${icon("arrow")}</button></div></section>`;
  }
  return html`<section class="card accent"><p class="eyebrow">Calm entry</p><h2>What would make today feel complete?</h2><p class="subtle">Capture one thing. You can shape it before it enters your plan.</p><div class="button-row"><button class="btn primary" type="button" data-action="open-omnibar">${icon("plus")} Capture something</button><button class="btn ghost" type="button" data-action="new-task">Add manually</button></div></section>`;
}

function renderToday() {
  const { task, block, minutes } = selectedFocus();
  const tasks = activeTasks().slice(0, 4);
  const active = ["running", "paused", "ready", "complete"].includes(state.focus.status);
  const delayed = delayedBlocks(state).length;
  return html`<div class="header-copy"><p class="eyebrow">${escapeHtml(formatDay(new Date(), locale, { weekday: "long" }))}</p><h1 class="page-title">${greeting()}.</h1><p class="page-subtitle">One thing to do. A little room to begin.</p></div><div class="stack today-flow">
    <form id="quick-task-form" class="card quick-entry"><label for="quick-task">What needs doing?</label><div class="quick-entry-row"><input id="quick-task" class="input" name="title" maxlength="160" value="${escapeHtml(ui.quickText)}" placeholder="Add one thing…" required><button class="btn" type="submit" ${busy("quick-add") ? "disabled" : ""}>Add task</button></div><p class="field-help">Saved locally. Details can wait.</p></form>
    <section class="card accent focus-hero"><div class="focus-emblem" aria-hidden="true"><span></span></div><p class="eyebrow">A place to begin</p><h2>${escapeHtml(block?.label || task?.title || t("Start with a little focus"))}</h2>
      ${active ? html`<button class="btn primary" type="button" data-action="return-focus">Return to timer</button>` : html`<form id="quick-focus-form" data-task-id="${escapeHtml(task?.id ?? "")}" data-block-id="${escapeHtml(block?.id ?? "")}"><div class="quick-focus-row"><div class="field"><label for="quick-minutes">Minutes for now</label><input id="quick-minutes" class="input" name="durationMinutes" type="number" min="1" max="480" step="1" value="${minutes}" required></div><button class="btn primary" type="submit" ${busy("timer") ? "disabled" : ""}>${icon("play")} Start focus</button></div></form>`}
      ${block ? html`<p class="field-help">${t("Planned start:")} ${escapeHtml(formatTime(block.startAt, locale))}. ${t("Starting early is your choice; the plan does not move.")}</p>` : ""}
      ${!active && activeTasks().length ? `<button class="btn ghost compact" type="button" data-action="choose-focus">${guideText("Choose another", "Chọn việc khác")}</button>` : ""}
      <button class="btn ghost compact" type="button" data-action="open-focus" data-task-id="${escapeHtml(task?.id ?? "")}" data-block-id="${escapeHtml(block?.id ?? "")}">Timer options</button>
    </section>
    ${delayed || activityUI.hasRecovery() ? html`<details class="card today-recovery"><summary>Day changed? Adjust the remaining work</summary><p class="field-help">Past blocks may still be open. Nothing is marked missed or moved automatically.</p>${activityUI.renderRecovery()}</details>` : ""}
    ${pendingProposal(state) ? html`<section class="card"><p>A schedule proposal is waiting. Nothing has moved.</p><button class="btn" type="button" data-action="navigate" data-view="plan" data-plan-view="schedule">Review proposal</button></section>` : ""}
    ${tasks.length ? html`<details class="card today-other-tasks"><summary>Open tasks</summary><div class="section-heading"><span>${activeTasks().length}</span><button class="btn compact ghost" type="button" data-action="navigate" data-view="plan">All tasks</button></div><div class="task-list">${tasks.map(task => renderTask(task)).join("")}</div></details>` : ""}
    ${activityUI.renderDailySummary()}
    <details class="card"><summary>Plan and time tools</summary><div class="stack">${renderTimeTools(state)}${renderBudget(state)}<section><h2>Today’s blocks</h2>${renderTodaySchedule()}</section><button class="btn" type="button" data-action="open-omnibar">Smart Capture · optional AI</button></div></details>
    ${state.profile.privacyReviewVersion < 1 ? html`<p class="field-help">Your existing privacy choices are unchanged. <button class="btn ghost compact" type="button" data-action="open-privacy">Review privacy choices</button></p>` : ""}
  </div>`;
}

function groupBlocks(blocks) {
  const groups = new Map();
  for (const block of blocks) {
    const key = localDateKey(block.startAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(block);
  }
  return groups;
}

function renderProposal(proposal) {
  const taskIds = proposalTaskIds(proposal);
  const scheduledMinutes = proposal.blocks.reduce((sum, block) => sum + (new Date(block.endAt) - new Date(block.startAt)) / 60_000, 0);
  const groups = groupBlocks(proposal.blocks);
  return html`<section class="card raised">
    <div class="card-header"><div><p class="eyebrow">Reversible proposal</p><h2>Nothing has moved yet.</h2></div><span class="status-chip">Draft</span></div>
    <div class="proposal-summary"><div class="metric"><strong>${taskIds.size}</strong><span>tasks</span></div><div class="metric"><strong>${proposal.blocks.length}</strong><span>blocks</span></div><div class="metric"><strong>${minutesLabel(scheduledMinutes)}</strong><span>planned</span></div></div>
    ${groups.size ? [...groups.entries()].map(([key, blocks]) => html`<div class="day-group"><p class="day-label">${escapeHtml(formatDay(`${key}T12:00:00`, locale, { weekday: "long" }))}</p><div class="timeline">${blocks.map(block => { const task = taskById(block.taskId); return html`<article class="block"><span class="block-time">${escapeHtml(formatTime(block.startAt, locale))}</span><div><div class="block-title">${escapeHtml(task?.title ?? t("Unknown task"))}</div><div class="block-detail">${minutesLabel((new Date(block.endAt) - new Date(block.startAt)) / 60_000)}</div></div><span class="pill">${titleCase(task?.energy ?? "medium")}</span></article>`; }).join("")}</div></div>`).join("") : html`<div class="empty">${icon("plan")}<h3>No feasible slots</h3><p>Adjust a deadline, duration, or workday boundary and propose again.</p></div>`}
    ${proposal.unscheduledTaskIds.length ? html`<p class="privacy-note"><strong>${proposal.unscheduledTaskIds.length} task${proposal.unscheduledTaskIds.length === 1 ? "" : t("s")} could not fit.</strong> Stuđiô kept partial blocks out of the proposal.</p>` : ""}
    ${proposal.explanation ? renderExplanation(proposal.explanation) : ""}
    <div class="button-row">
      <button class="btn primary" type="button" data-action="apply-proposal" data-proposal-id="${escapeHtml(proposal.id)}" ${proposal.blocks.length ? "" : "disabled"}>${icon("check")} Apply proposal</button>
      <button class="btn soft" type="button" data-action="explain-proposal" data-proposal-id="${escapeHtml(proposal.id)}" ${!gemini.connected || busy("explain") || !proposal.blocks.length ? "disabled" : ""}>${busy("explain") ? markup('<span class="spinner"></span>') : icon("spark")} Ask Gemini to explain the fit</button>
      <button class="btn ghost" type="button" data-action="dismiss-proposal" data-proposal-id="${escapeHtml(proposal.id)}">Dismiss</button>
    </div>
    <div class="privacy-note"><strong>Gemini explanation sends:</strong> task titles, durations, energy, priorities, deadlines, and proposed times. ${memoryDisclosure()} It cannot apply changes.</div>
  </section>`;
}

function renderExplanation(explanation) {
  const bullets = [
    ...explanation.reasons.map(item => html`<li>${escapeHtml(item)}</li>`),
    ...explanation.tradeoffs.map(item => html`<li><strong>Tradeoff:</strong> ${escapeHtml(item)}</li>`),
    ...explanation.suggestedAdjustments.map(item => html`<li><strong>Optional:</strong> ${escapeHtml(item)}</li>`)
  ];
  return html`<div class="explanation"><p class="eyebrow">Gemini explanation</p><h3>${escapeHtml(explanation.headline)}</h3><p class="subtle">${escapeHtml(explanation.summary)}</p>${bullets.length ? html`<ul>${bullets.join("")}</ul>` : ""}</div>`;
}

function renderAppliedSchedule() {
  const blocks = state.schedule.filter(block => !["done", "skipped"].includes(block.status)).sort((a, b) => a.startAt.localeCompare(b.startAt));
  const groups = groupBlocks(blocks);
  if (!blocks.length) return html`<div class="empty">${icon("plan")}<h3>No schedule yet</h3><p>Proposals remain reversible until you apply one.</p></div>`;
  return [...groups.entries()].map(([key, items]) => html`<div class="day-group"><p class="day-label">${escapeHtml(formatDay(`${key}T12:00:00`, locale, { weekday: "long" }))}</p><div class="timeline">${items.map(block => { const task = taskById(block.taskId); return html`<article class="block"><span class="block-time">${escapeHtml(formatTime(block.startAt, locale))}</span><div><div class="block-title">${escapeHtml(block.label || task?.title || t("Unknown task"))}</div><div class="block-detail">${minutesLabel((new Date(block.endAt) - new Date(block.startAt)) / 60_000)} · ${titleCase(block.status)}</div></div><button class="icon-button ghost" type="button" data-action="open-focus" data-task-id="${escapeHtml(block.taskId)}" data-block-id="${escapeHtml(block.id)}" aria-label="Start this block">${icon("play")}</button></article>`; }).join("")}</div></div>`).join("");
}

function renderPlan() {
  if (ui.planView === "kanban" && !state.kanban.enabled) ui.planView = "matrix";
  const proposal = pendingProposal(state);
  const open = activeTasks();
  const eligible = schedulableTasks(state);
  const tabs = html`<div class="segmented plan-tabs" role="group" aria-label="Plan view">${[["matrix", "Eisenhower"], ["schedule", "Schedule"], ...(state.kanban.enabled ? [["kanban", "Kanban"]] : [])].map(([view, label]) => html`<button class="segment ${ui.planView === view ? "active" : ""}" type="button" data-action="plan-view" data-value="${view}" aria-pressed="${ui.planView === view}">${t(label)}</button>`).join("")}</div>`;
  if (ui.planView === "kanban") return html`<div class="header-copy"><h1 class="page-title">Plan</h1></div>${tabs}<div class="stack">${renderBudget(state, { compact: true })}${renderKanban(state)}</div>`;
  if (ui.planView === "matrix") return html`<div class="header-copy"><p class="eyebrow">Choose what matters</p><h1 class="page-title">Plan</h1><p class="page-subtitle">Separate what matters from what feels urgent.</p></div>${tabs}<div class="stack">${renderKanbanOffer(state)}${renderBudget(state, { compact: true })}${state.preferences.autoSort ? `<p class="field-help">${guideText("Automatic AI also needs permission in Settings → AI on your terms and shares its daily limit. Local rules still run. Allow AI sorting / Retry sorting makes an explicit manual request for eligible tasks.", "AI tự động còn cần cho phép trong Cài đặt → AI theo lựa chọn riêng và dùng chung giới hạn mỗi ngày. Quy tắc trên máy vẫn chạy. Cho phép AI phân loại / Thử phân loại lại là yêu cầu thủ công cho các việc đủ điều kiện.")}</p>` : ""}${renderEisenhower(state, { working: busy("sort"), connected: gemini.connected, error: ui.sortError })}</div>`;
  return html`<div class="header-copy"><p class="eyebrow">Shape, then commit</p><h1 class="page-title">Plan</h1><p class="page-subtitle">The local scheduler finds open time, respects existing blocks, and keeps its proposal separate until you approve it.</p></div>
    ${tabs}<div class="stack">
      ${renderBudget(state, { compact: true })}
      ${activityUI.renderRecovery()}
      ${proposal ? renderProposal(proposal) : html`<section class="card accent"><div class="card-header"><div><p class="eyebrow">Local scheduling</p><h2>Build a proposal.</h2></div><span class="status-chip">Deterministic</span></div><p class="subtle">Stuđiô sorts by deadline and priority, splits long tasks into focus-sized blocks, and avoids overlaps with your current schedule.</p><div class="button-row"><button class="btn primary" type="button" data-action="propose-schedule" ${!eligible.length || busy("propose") ? "disabled" : ""}>${icon("plan")} Propose schedule</button><button class="btn ghost" type="button" data-action="new-task">Add task</button></div></section>`}
      <section class="section"><div class="section-heading"><h2>Committed schedule</h2><span>${state.schedule.filter(block => block.status === "planned").length} upcoming</span></div>${renderAppliedSchedule()}</section>
      <section class="section"><div class="section-heading"><h2>Task inbox</h2><span>${open.length} open</span></div>${open.length ? html`<div class="task-list">${open.map(task => renderTask(task, { hideFocus: false })).join("")}</div>` : html`<div class="empty">${icon("inbox")}<h3>No open tasks</h3><p>Capture a task before asking the local scheduler for a proposal.</p></div>`}</section>
    </div>`;
}

function renderInsights() {
  const analytics = computeAnalytics(state);
  const maximum = Math.max(1, ...analytics.days.map(day => day.focusedSeconds));
  const chart = analytics.days.map(day => {
    const date = safeDate(day.date);
    const height = Math.max(day.focusedSeconds ? 8 : 2, Math.round((day.focusedSeconds / maximum) * 100));
    return html`<div class="bar-column" title="${Math.round(day.focusedSeconds / 60)} minutes"><div class="bar-track"><div class="bar-fill" style="height:${height}%"></div></div><span class="bar-label">${new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(date)}</span></div>`;
  }).join("");
  return html`<div class="header-copy"><p class="eyebrow">Evidence, gently</p><h1 class="page-title">Insights</h1><p class="page-subtitle">A small window into what happened—not a score for who you are.</p></div>
    <div class="stack">
      <section class="card"><div class="card-header"><div><p class="eyebrow">Last seven days</p><h2>${analytics.totalFocusedMinutes} focused minutes</h2></div><span class="status-chip">${analytics.completedSessions + analytics.stoppedSessions} sessions</span></div><div class="chart" role="img" aria-label="Focused minutes for each of the last seven days">${chart}</div></section>
      <div class="metric-grid"><div class="metric-card"><strong>${analytics.completedSessions}</strong><span>completed sessions</span></div><div class="metric-card"><strong>${Math.round(analytics.sessionCompletionRate * 100)}%</strong><span>session completion</span></div><div class="metric-card"><strong>${analytics.completedTasks}</strong><span>completed tasks</span></div><div class="metric-card"><strong>${analytics.streakDays}</strong><span>day focus streak</span></div></div>
      ${ui.reflection ? html`<section class="card reflection"><p class="eyebrow">Gemini reflection</p><h2>${escapeHtml(ui.reflection.headline)}</h2><p>${escapeHtml(ui.reflection.narrative)}</p>${ui.reflection.wins.length ? html`<ul>${ui.reflection.wins.map(item => html`<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}<p><strong>Optional experiment:</strong> ${escapeHtml(ui.reflection.gentleExperiment)}</p></section>` : ""}
      <section class="card"><div class="callout">${icon("shield")}<div><h3>Privacy-reduced reflection</h3><p>Gemini receives daily minute totals and counts. Task records are not sent automatically. ${memoryDisclosure()}</p></div></div><div class="button-row"><button class="btn soft" type="button" data-action="reflect" ${!gemini.connected || busy("reflect") || !state.sessions.length ? "disabled" : ""}>${busy("reflect") ? markup('<span class="spinner"></span>') : icon("spark")} Let Gemini narrate this pattern</button></div>${!gemini.connected ? markup('<p class="field-help">Connect Gemini from Settings to enable narration.</p>') : !state.sessions.length ? markup('<p class="field-help">Complete a focus session first.</p>') : ""}</section>
    </div>`;
}

function memoryDisclosure() {
  const manual = activeCustomInstructions(state.memory)
    ? t("Saved custom instructions are also sent.")
    : t("Custom instructions are not sent.");
  return manual + (learnedMemory?.settings.useWithGemini ? t(" Relevant active saved memories may also be included.") : t(" Saved memories are excluded."));
}

function memoryDraftStatus() {
  if (!ui.memoryDraft) return t("No unsaved changes.");
  const changed = ui.memoryDraft.customInstructions !== state.memory.customInstructions || ui.memoryDraft.enabled !== state.memory.enabled;
  return changed ? t("Unsaved changes · select Save to apply.") : t("No unsaved changes.");
}

function updateMemoryEditorDom() {
  const draft = ui.memoryDraft ?? state.memory;
  const count = document.querySelector("#memory-count");
  const status = document.querySelector("#memory-draft-status");
  const discard = document.querySelector("#memory-discard");
  if (count) count.textContent = `${draft.customInstructions.length} / ${MAX_CUSTOM_INSTRUCTIONS_LENGTH}`;
  if (status) status.textContent = memoryDraftStatus();
  if (discard) discard.disabled = !ui.memoryDraft || busy("memory");
}

function renderMemorySettings() {
  const draft = ui.memoryDraft ?? state.memory;
  const active = Boolean(activeCustomInstructions(state.memory));
  const status = active ? t("On") : state.memory.customInstructions ? t("Off · text kept") : t("Empty");
  return html`<section class="card" aria-labelledby="memory-title">
    <div class="card-header"><div><h2 id="memory-title">Custom instructions</h2></div><span class="status-chip ${active ? "connected" : ""}">${status}</span></div>
    <p class="subtle" id="memory-help">Tell Gemini what to keep in mind: your goals, preferences, or preferred response style. The learning updater cannot rewrite this text.</p>
    <form id="memory-form" class="memory-editor">
      <div class="field"><label for="memory-instructions">What should Gemini know?</label><textarea id="memory-instructions" name="customInstructions" class="textarea" rows="6" maxlength="${MAX_CUSTOM_INSTRUCTIONS_LENGTH}" aria-describedby="memory-help memory-count memory-privacy" placeholder="For example: Keep explanations brief. Suggest one small next step at a time." autocomplete="off" spellcheck="false" ${busy("memory") ? "disabled" : ""}>${escapeHtml(draft.customInstructions)}</textarea></div>
      <div class="memory-meta field-help"><span id="memory-draft-status" role="status">${memoryDraftStatus()}</span><span id="memory-count">${draft.customInstructions.length} / ${MAX_CUSTOM_INSTRUCTIONS_LENGTH}</span></div>
      <label class="check-row"><input id="memory-enabled" type="checkbox" name="memoryEnabled" ${draft.enabled ? "checked" : ""} ${busy("memory") ? "disabled" : ""}><span><strong>Use with Gemini</strong><br>Off for new installations. Turning this off keeps the text but excludes it from new requests. Select Save to apply.</span></label>
      <div class="button-row"><button class="btn primary" type="submit" ${busy("memory") ? "disabled" : ""}>${busyLabel("memory", t("Save instructions"))}</button><button id="memory-discard" class="btn ghost" type="button" data-action="discard-memory-draft" ${!ui.memoryDraft || busy("memory") ? "disabled" : ""}>Discard edits</button><button class="btn danger ghost" type="button" data-action="ask-clear-memory" ${!state.memory.customInstructions || busy("memory") ? "disabled" : ""}>Clear saved text</button></div>
    </form>
    <div id="memory-privacy" class="privacy-note"><strong>You control what is shared.</strong> Saving makes no API call. When enabled, these instructions go to Google with task drafts, planning help, explanations, and reflections—not connection tests. Background memory updates also include them if you separately enable learning. They are included in backups, even when off. Do not put API keys here.</div>
    <p class="field-help">Local schedule rules and timer settings still come from Settings. Custom instructions do not change them.</p>
  </section>`;
}

function renderSettings() {
  return html`<div class="header-copy"><p class="eyebrow">Stuđiô · v${APP_VERSION}</p><h1 class="page-title">Settings</h1><p class="page-subtitle">Start simple. More precise controls stay one layer down.</p></div>
    <div class="stack">
      <section class="card"><div class="field"><label for="language">Language / Ngôn ngữ</label><select id="language" class="select" data-preference="language"><option value="en" ${state.preferences.language === "en" ? "selected" : ""}>English</option><option value="vi" ${state.preferences.language === "vi" ? "selected" : ""}>Tiếng Việt</option></select></div></section>
      <section class="card"><h2>Privacy choices</h2><p>Review each feature, its purpose, data use and permissions.</p><button class="btn" type="button" data-action="open-privacy">Review privacy choices</button></section>
      <section class="card about-shortcut"><h2>${guideText("About Stuđiô", "Về Stuđiô")}</h2><p>${guideText("Our approach and the MD Studio design inspiration.", "Định hướng và cảm hứng thiết kế từ MD Studio.")}</p><button class="btn ghost" type="button" data-action="open-about">${guideText("About & credits", "Giới thiệu & ghi nhận")}</button></section>
      ${renderKanbanSettings(state)}
      ${activityUI.renderReminders()}
      <section class="card"><h2>Planning assistance</h2><label class="check-row"><input id="planning-enabled" type="checkbox" ${state.preferences.planningEnabled ? "checked" : ""}><span>Enable planning assistance</span></label><p class="field-help">Guided planning and optional Gemini suggestions. Available here in Settings.</p><details class="mini-disclosure"><summary>When the reminder appears</summary><p>Once, after seven days, if the previous seven full days average at least three AI requests per day. Counts Capture, explanations, reflections and planning help. Connection tests and automatic actions are excluded.</p></details></section>
      ${state.preferences.planningEnabled ? renderPlanningAssistant({ mode: state.preferences.planningAssistance, connected: gemini.connected, working: busy("advice"), saving: busy("guide-save"), advice: ui.advice, guidance: ui.guidance, reflection: ui.guideReflection, draft: ui.guideDraft, tasks: activeTasks() }) : ""}
      <section class="card"><h2>Automatic daily budget</h2><label class="check-row"><input id="auto-daily-budget" type="checkbox" ${state.preferences.autoDailyBudget ? "checked" : ""}><span>Estimate each new day</span></label><p class="field-help">Blends recent budgets and recorded focus, with the default for limited history. Capped by workday hours. Today's tasks and blocks check whether the plan fits.</p><p class="field-help">Local calculation, no AI call. Manual values stay until you choose Use estimate. Outside commitments are not included.</p></section>
      ${renderTrackingCard(tracking, busy("tracking"))}<button class="btn" type="button" data-action="navigate" data-view="activity">Activity timeline</button>
      ${renderGeminiCard()}
      ${renderAIPolicy(aiPolicy, gemini.connected, busy("privacy"))}
      <section class="card"><p class="eyebrow">Gemini capture</p><h2>From an idea to focus blocks</h2><p class="subtle">Allow Gemini to choose several blocks and suggest their times from one note. Review, edit, and add them together directly from capture.</p>${renderCaptureToggle("settings-capture-multiple")}<p class="field-help">Starts on for “I’m just starting out” and off for “I have my own system.” Your later choice is kept. When off, capture returns one task draft.</p></section>
      ${renderMemorySettings()}
      ${renderLearnedSettings(learnedMemory, { busy: busy("learned"), installed: isExtension, connected: gemini.connected, dayEnd: state.preferences.dayEnd, noteText: ui.learningNote, noteScope: ui.learningNoteScope })}
      <section class="card settings-list">
        <div class="setting-row"><div><h3>Appearance</h3><p>Solid color, no decorative imagery</p></div><div class="segmented"><button class="segment ${state.preferences.theme === "night" ? "active" : ""}" type="button" data-action="set-theme" data-value="night">Night</button><button class="segment ${state.preferences.theme === "paper" ? "active" : ""}" type="button" data-action="set-theme" data-value="paper">Paper</button></div></div>
        <div class="setting-row"><div><h3>Focus interval</h3><p>Default session length</p></div><input class="input" type="number" min="5" max="180" step="5" value="${state.preferences.focusMinutes}" data-preference="focusMinutes" aria-label="Focus interval in minutes"></div>
        <div class="setting-row"><div><h3>Rest interval</h3><p>Short Pomodoro break</p></div><input class="input" type="number" min="1" max="60" step="1" value="${state.preferences.breakMinutes}" data-preference="breakMinutes" aria-label="Rest interval in minutes"></div>
        <div class="setting-row"><div><h3>Pomodoro rounds</h3><p>Default number of focus rounds</p></div><input class="input" type="number" min="1" max="8" step="1" value="${state.preferences.cycles}" data-preference="cycles" aria-label="Number of intervals"></div>
        <div class="setting-row"><div><h3>Long break</h3><p>Pomodoro rest in minutes</p></div><input class="input" type="number" min="1" max="60" step="1" value="${state.preferences.longBreakMinutes}" data-preference="longBreakMinutes" aria-label="Long break minutes"></div>
        <div class="setting-row"><div><h3>Long break every</h3><p>Completed focus rounds</p></div><input class="input" type="number" min="1" max="8" step="1" value="${state.preferences.longBreakEvery}" data-preference="longBreakEvery" aria-label="Rounds between long breaks"></div>
        <div class="setting-row"><div><h3>Default daily budget</h3><p>Minutes available on new days</p></div><input class="input" type="number" min="0" max="1440" step="1" value="${state.preferences.dailyBudgetMinutes}" data-preference="dailyBudgetMinutes" aria-label="Default daily time budget"></div>
        <div class="setting-row"><div><h3>Workday starts</h3><p>Local scheduler boundary</p></div><input class="input" type="time" value="${escapeHtml(state.preferences.dayStart)}" data-preference="dayStart" aria-label="Workday start"></div>
        <div class="setting-row"><div><h3>Workday ends</h3><p>Local scheduler boundary</p></div><input class="input" type="time" value="${escapeHtml(state.preferences.dayEnd)}" data-preference="dayEnd" aria-label="Workday end"></div>
        <div class="setting-row"><div><h3>Buffer</h3><p>Minutes between planned blocks</p></div><input class="input" type="number" min="0" max="60" step="5" value="${state.preferences.bufferMinutes}" data-preference="bufferMinutes" aria-label="Buffer minutes"></div>
      </section>
      <section class="card"><div class="card-header"><div><p class="eyebrow">Gemini</p><h2>${gemini.connected ? t("Connected") : t("Not connected")}</h2></div><span class="status-chip ${gemini.connected ? "connected" : ""}"><span class="status-dot"></span>${gemini.connected ? escapeHtml(gemini.model) : t("Optional")}</span></div><p class="subtle">Gemini setup stays in Settings and Privacy choices.</p><div class="button-row"><button class="btn" type="button" data-action="go-gemini">${gemini.connected ? t("Review connection") : t("Connect in Settings")}</button>${gemini.connected ? markup('<button class="btn ghost" type="button" data-action="disconnect-gemini">Disconnect</button>') : ""}</div></section>
      <section class="card"><p class="eyebrow">Troubleshooting</p><h2>Gemini diagnostics</h2><p class="subtle">The last 20 Gemini attempts are kept on this device. The report includes the app version, model, capture mode, failure stage, HTTP status, error category, and character counts.</p><label class="check-row"><input id="diagnostics-include-text" type="checkbox" ${diagnosticSettings?.includeText ? "checked" : ""} ${!diagnosticSettings || busy("diagnostics") ? "disabled" : ""}><span><strong>Include prompt and custom instructions in debug reports</strong><br>Off by default. When on, future attempts also keep the text sent to Gemini and any specific API error message. These may include personal details, selected memories, and activity evidence from memory updates. Turning it off removes saved debug text.</span></label>${!diagnosticSettings ? markup('<p class="field-help">The debug-text setting could not be read. Reopen the panel to retry.</p>') : ""}<p class="field-help">API keys are always redacted. Complete response bodies, generated output, and request headers are excluded. Exporting makes no API call. Earlier attempts cannot gain text that was not recorded.</p><div class="button-row"><button class="btn" type="button" data-action="export-gemini-debug" ${busy("diagnostics") ? "disabled" : ""}>${icon("download")} Export debug report</button><button class="btn ghost" type="button" data-action="clear-gemini-debug" ${busy("diagnostics") ? "disabled" : ""}>Clear debug history</button></div><p class="field-help">After a failure, export the JSON file and attach it to the chat where you are reporting the issue.</p></section>
      <section class="card"><p class="eyebrow">Portable local data</p><h2>Backup & restore</h2><p class="subtle">Exports include tasks, schedules, settings, Custom Instructions (even when off), saved memories, learning evidence, and task/timer history. Credentials and debug reports are excluded. Restoring replaces these stores together and pauses learning.</p><div class="button-row"><button class="btn" type="button" data-action="export-backup">${icon("download")} Export backup</button><button class="btn" type="button" data-action="choose-import">${icon("upload")} Import backup</button><input id="backup-input" class="sr-only" type="file" accept="application/json,.json"></div></section>
      <section class="card"><p class="eyebrow">Local data</p><h2>Stored on this device</h2><p class="subtle">${state.tasks.length} tasks, ${state.schedule.length} schedule blocks, ${state.sessions.length} focus sessions, and ${state.events.length} history events.</p><div class="button-row"><button class="btn ghost" type="button" data-action="replay-onboarding">Replay onboarding</button><button class="btn danger ghost" type="button" data-action="ask-reset">${icon("trash")} Erase local data</button></div><p class="field-help">Replaying onboarding keeps your tasks, history, and Gemini connection.</p></section>
    </div>`;
}

function renderCaptureToggle(id) {
  return html`<label class="check-row capture-toggle"><input id="${id}" type="checkbox" data-capture-multiple="true" ${multipleFocusBlocksEnabled(state) ? "checked" : ""} ${busy("capture") || busy("capture-preference") ? "disabled" : ""}><span><strong>Allow multiple focus blocks</strong></span></label>`;
}

function captureDisclosure() {
  return multipleFocusBlocksEnabled(state)
    ? msg`Gemini receives this note, focus/workday settings, and busy times for the next seven days (no existing task text). ${memoryDisclosure()}`
    : msg`Gemini receives this note. ${memoryDisclosure()}`;
}

function renderOmnibar() {
  if (!ui.omnibarOpen) return html`<div class="fab-wrap"><button class="fab" type="button" data-action="open-omnibar" aria-label="Open Smart Capture">${icon("plus")}</button></div>`;
  return html`<div class="fab-wrap"><form id="omnibar-form" class="omnibar"><label class="sr-only" for="capture-input">What is the plan?</label><input id="capture-input" class="input" name="capture" maxlength="2000" value="${escapeHtml(ui.captureText)}" placeholder="What’s the plan?" autocomplete="off" autofocus>${renderCaptureToggle("capture-multiple")}<div class="omnibar-actions"><button class="icon-button ghost" type="button" data-action="manual-from-omnibar" aria-label="Add manually">${icon("edit")}</button><button class="btn soft compact" type="submit" ${busy("capture") || busy("capture-preference") ? "disabled" : ""}>${busy("capture") ? markup('<span class="spinner"></span>') : icon("spark")} <span>Interpret & review</span></button><button class="icon-button ghost" type="button" data-action="close-omnibar" aria-label="Close Smart Capture">${icon("close")}</button></div><span class="omnibar-caption">${gemini.connected ? captureDisclosure() : t("Gemini is off · creates a manual draft")}<br>Review before saving · pencil adds manually</span></form></div>`;
}

function captureBlockCount(draft) {
  return draft.tasks.reduce((sum, task) => sum + task.focusBlocks.filter(block => block.selected !== false).length, 0);
}

function captureIssueMarkup(draft) {
  const issues = captureIssues(state, draft);
  return issues.length ? html`<strong>Check before adding</strong><ul>${issues.map(issue => html`<li>${escapeHtml(issue)}</li>`).join("")}</ul>` : t("Selected blocks fit the current schedule. Times will be checked again when you add them.");
}

function captureBlockEnd(block) {
  const start = safeDate(block.startAt);
  if (!start || !Number.isFinite(block.durationMinutes)) return t("Choose a start time to see the end.");
  const end = new Date(start.getTime() + block.durationMinutes * 60_000);
  return msg`Ends ${formatDay(end, locale)}, ${formatTime(end, locale)}`;
}

function updateCaptureReviewDom() {
  if (ui.modal?.type !== "capture-blocks") return;
  const draft = ui.modal.draft;
  const status = document.querySelector("#capture-review-status");
  const button = document.querySelector("#capture-add-blocks");
  if (status) status.innerHTML = captureIssueMarkup(draft);
  if (button) button.textContent = msg`Add ${captureBlockCount(draft)} selected blocks`;
  draft.tasks.forEach((task, taskIndex) => task.focusBlocks.forEach((block, blockIndex) => {
    const end = document.querySelector(`#capture-end-${taskIndex}-${blockIndex}`);
    if (end) end.textContent = captureBlockEnd(block);
  }));
}

function renderCaptureReview(draft) {
  const saving = busy("capture-save");
  const fields = (taskIndex, field, blockIndex = null) => `data-capture-task="${taskIndex}" data-capture-field="${field}"${blockIndex === null ? "" : ` data-capture-block="${blockIndex}"`}`;
  return html`<div class="modal-backdrop" data-action="backdrop-close"><section class="modal capture-review" role="dialog" aria-modal="true" aria-labelledby="capture-review-title">
    <div class="modal-head"><div><h2 id="capture-review-title">Review Gemini’s focus blocks</h2><p>Nothing has been added. Edit the drafts and choose the blocks you want.</p></div><button class="icon-button ghost" type="button" data-action="close-modal" aria-label="Discard focus-block draft" ${saving ? "disabled" : ""}>${icon("close")}</button></div>
    ${draft.rationale ? html`<p class="subtle">${escapeHtml(draft.rationale)}</p>` : ""}
    <form id="capture-blocks-form">
      ${draft.tasks.map((task, taskIndex) => {
        const anySelected = task.focusBlocks.some(block => block.selected !== false);
        const disabled = saving || !anySelected ? "disabled" : "";
        return html`<section class="capture-task" aria-label="Task ${taskIndex + 1}">
          <div class="field"><label for="capture-task-${taskIndex}">Task ${taskIndex + 1}</label><input id="capture-task-${taskIndex}" class="input" ${fields(taskIndex, "title")} maxlength="160" value="${escapeHtml(task.title)}" required ${disabled}></div>
          <details class="capture-details"><summary>Task details and assumptions</summary>
            <div class="field"><label for="capture-notes-${taskIndex}">Notes</label><textarea id="capture-notes-${taskIndex}" class="textarea" ${fields(taskIndex, "notes")} maxlength="1000" ${disabled}>${escapeHtml(task.notes)}</textarea></div>
            <div class="field"><label for="capture-due-${taskIndex}">Deadline</label><input id="capture-due-${taskIndex}" class="input" type="datetime-local" ${fields(taskIndex, "dueAt")} value="${escapeHtml(localDateTimeInput(task.dueAt))}" ${disabled}></div>
            <div class="field-grid"><div class="field"><label for="capture-energy-${taskIndex}">Energy</label><select id="capture-energy-${taskIndex}" class="select" ${fields(taskIndex, "energy")} ${disabled}>${["low", "medium", "high"].map(value => html`<option value="${value}" ${value === task.energy ? "selected" : ""}>${titleCase(value)}</option>`).join("")}</select></div><div class="field"><label for="capture-priority-${taskIndex}">Priority</label><select id="capture-priority-${taskIndex}" class="select" ${fields(taskIndex, "priority")} ${disabled}>${["low", "normal", "high"].map(value => html`<option value="${value}" ${value === task.priority ? "selected" : ""}>${titleCase(value)}</option>`).join("")}</select></div></div>
            ${task.assumptions?.length ? html`<ul class="assumption-list">${task.assumptions.map(item => html`<li>${escapeHtml(item)}</li>`).join("")}</ul>` : html`<p class="subtle">No assumptions were provided for this task.</p>`}
          </details>
          ${task.focusBlocks.map((block, blockIndex) => {
            const selected = block.selected !== false;
            const blockDisabled = saving || !selected ? "disabled" : "";
            return html`<div class="capture-block ${selected ? "" : "excluded"}">
              <label class="check-row"><input type="checkbox" ${fields(taskIndex, "selected", blockIndex)} ${selected ? "checked" : ""} ${saving ? "disabled" : ""}><strong>Include block ${blockIndex + 1}</strong></label>
              <div class="field"><label for="capture-label-${taskIndex}-${blockIndex}">Focus on</label><input id="capture-label-${taskIndex}-${blockIndex}" class="input" ${fields(taskIndex, "label", blockIndex)} maxlength="160" value="${escapeHtml(block.label)}" required ${blockDisabled}></div>
              <div class="field"><label for="capture-start-${taskIndex}-${blockIndex}">Start (your local time)</label><input id="capture-start-${taskIndex}-${blockIndex}" class="input" type="datetime-local" ${fields(taskIndex, "startAt", blockIndex)} value="${escapeHtml(localDateTimeInput(block.startAt))}" required ${blockDisabled}></div>
              <div class="field"><label for="capture-minutes-${taskIndex}-${blockIndex}">Minutes</label><input id="capture-minutes-${taskIndex}-${blockIndex}" class="input" type="number" min="5" max="180" step="1" ${fields(taskIndex, "durationMinutes", blockIndex)} value="${escapeHtml(block.durationMinutes)}" required ${blockDisabled}><span id="capture-end-${taskIndex}-${blockIndex}" class="field-help">${escapeHtml(captureBlockEnd(block))}</span></div>
            </div>`;
          }).join("")}
        </section>`;
      }).join("")}
      <div id="capture-review-status" class="privacy-note" role="status">${captureIssueMarkup(draft)}</div>
      <p class="field-help">Unchecked blocks are discarded. Task totals use the selected blocks. Adding saves them directly to your schedule; timers start only when you choose Start focus.</p>
      <div class="button-row"><button id="capture-add-blocks" class="btn primary" type="submit" ${saving ? "disabled" : ""}>${saving ? t("Adding blocks…") : msg`Add ${captureBlockCount(draft)} selected blocks`}</button><button class="btn ghost" type="button" data-action="close-modal" ${saving ? "disabled" : ""}>Discard draft</button></div>
    </form>
  </section></div>`;
}

function updateCaptureDraft(input, refresh = true) {
  if (ui.modal?.type !== "capture-blocks" || busy("capture-save") || input.dataset.captureTask === undefined) return false;
  const task = ui.modal.draft.tasks[Number(input.dataset.captureTask)];
  const blockIndex = input.dataset.captureBlock;
  const target = blockIndex === undefined ? task : task?.focusBlocks[Number(blockIndex)];
  const field = input.dataset.captureField;
  const allowed = blockIndex === undefined ? ["title", "notes", "dueAt", "energy", "priority"] : ["label", "startAt", "durationMinutes", "selected"];
  if (!target || !allowed.includes(field)) return false;
  target[field] = field === "selected" ? input.checked
    : field === "durationMinutes" ? Number(input.value)
    : ["startAt", "dueAt"].includes(field) ? (input.value ? safeDate(input.value)?.toISOString() ?? input.value : null)
    : input.value;
  if (refresh && field === "selected") render();
  else if (refresh) updateCaptureReviewDom();
  return true;
}

function renderZen() {
  const focus = state.focus;
  const task = taskById(focus.taskId);
  const block = state.schedule.find(item => item.id === focus.blockId);
  const snap = timerSnapshot(focus, new Date());
  const value = `${String(snap.minutesPart).padStart(2, "0")}:${String(snap.secondsPart).padStart(2, "0")}`;
  const rest = focus.phase === "break";
  const ready = focus.status === "ready";
  const label = rest ? (focus.breakKind === "long" ? t("Long break") : t("Short break")) : t("Focus");
  const round = rest ? focus.completedCycles : Math.min(focus.targetCycles, focus.completedCycles + 1);
  return html`<main class="zen ${rest ? "zen-break" : ""}">
    <div class="zen-top"><span class="zen-label">${focus.mode === "pomodoro" ? msg`Pomodoro · ${round} / ${focus.targetCycles}` : t("Focus session")}</span><button class="btn compact ghost" type="button" data-action="minimize-timer">Back to today</button></div>
    <section class="zen-center">
      <p class="eyebrow">${label}${ready ? t(" ready") : focus.status === "paused" ? t(" paused") : ""}</p>
      <div id="timer-ring" class="timer-ring" style="--progress:${snap.progress}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="46"></circle><circle class="progress" cx="50" cy="50" r="46"></circle></svg><div class="timer-copy"><div id="timer-value" class="timer-value">${value}</div><div class="timer-phase">${ready || focus.status === "paused" ? t("Ready when you are") : rest ? t("Room to rest") : t("One thing at a time")}</div></div></div>
      <p class="zen-task">${escapeHtml(block?.label || task?.title || t("Open focus"))}</p>
      ${focus.mode === "pomodoro" ? html`<p class="field-help">${focus.completedCycles} / ${focus.targetCycles} focus rounds completed · ${minutesLabel(focus.totalFocusedSeconds / 60)} recorded</p><p class="field-help">${ready ? t("The next phase waits for you. No time is being recorded.") : rest ? t("Breaks do not count as focus time.") : t("A break follows this round. You choose when to start it.")}</p>` : ""}
    </section>
    <div class="zen-actions">${ready ? html`<button class="btn primary" type="button" data-action="next-phase">${icon("play")} Start ${rest ? t("break") : t("next focus")}</button>` : focus.status === "running" ? html`<button class="btn primary" type="button" data-action="pause-focus">${icon("pause")} Pause</button>` : html`<button class="btn primary" type="button" data-action="resume-focus">${icon("play")} Resume</button>`}${rest ? html`<button class="btn ghost" type="button" data-action="skip-break">${focus.completedCycles >= focus.targetCycles ? t("Finish Pomodoro") : t("Skip break")}</button>` : ""}<button class="btn ghost" type="button" data-action="ask-stop">End</button></div>
  </main>`;
}

function renderPostSession() {
  const summary = state.focus.lastSummary;
  const minutes = Math.max(0, Math.round((summary?.focusedSeconds ?? 0) / 60));
  const quotePool = [
    t("That block is real progress. Let the next one stay small."),
    "A finished session is evidence that the plan can work.",
    t("Keep the accomplishment; release the pressure to optimize everything."),
    t("One protected block can change the shape of a day.")
  ];
  const seed = String(summary?.sessionId ?? "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const quote = quotePool[seed % quotePool.length];
  const task = taskById(summary?.taskId);
  const completionCheck = task && !["done", "archived"].includes(task.status) ? html`<div><p>Session ended. The task is still open.</p><div class="button-row"><button class="btn compact" type="button" data-action="complete-task" data-task-id="${escapeHtml(task.id)}">Mark task done</button><button class="btn compact ghost" type="button" data-action="close-post-session">Keep task open</button></div></div>` : "";
  return html`<main class="post-session"><div class="success-mark">${icon("check")}</div><div><p class="eyebrow">Session ${summary?.outcome === "completed" ? t("complete") : t("closed")}</p><h1>You made room.</h1></div><div class="summary-number">${minutes}<small> focused minutes</small></div>${summary?.mode === "pomodoro" ? html`<p>${summary.completedCycles} / ${summary.targetCycles} Pomodoro rounds completed. Break time is excluded.</p>` : ""}<p>${escapeHtml(quote)}</p>${completionCheck}<div class="button-row"><button class="btn primary" type="button" data-action="close-post-session">Return to today</button><button class="btn ghost" type="button" data-action="feedback">Leave feedback</button></div></main>`;
}

function renderTaskModal(data = {}) {
  const task = data.taskId ? taskById(data.taskId) : null;
  const draft = data.draft ?? task ?? {};
  const assumptions = data.assumptions ?? draft.assumptions ?? [];
  return html`<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title">
    <div class="modal-head"><div><h2 id="task-modal-title">${task ? t("Edit task") : data.source === "gemini" ? t("Review Gemini’s draft") : t("Add a task")}</h2><p>${data.source === "gemini" ? t("Nothing has been saved. Check every field first.") : t("Keep only the detail that will help you begin.")}</p></div><button class="icon-button ghost" type="button" data-action="close-modal" aria-label="Close">${icon("close")}</button></div>
    <form id="task-form" data-task-id="${escapeHtml(task?.id ?? "")}" data-source="${escapeHtml(data.source ?? task?.source ?? "manual")}">
      <div class="field"><label for="task-title">Task</label><input id="task-title" class="input" name="title" maxlength="160" value="${escapeHtml(draft.title ?? "")}" placeholder="What needs doing?" required autofocus></div>
      <details class="task-details" ${task || data.source === "gemini" ? "open" : ""}><summary>Details, if useful</summary>
      <div class="field"><label for="task-notes">Notes</label><textarea id="task-notes" class="textarea" name="notes" maxlength="4000" placeholder="Optional context">${escapeHtml(draft.notes ?? "")}</textarea></div>
      <div class="field-grid"><div class="field"><label for="task-duration">Minutes</label><input id="task-duration" class="input" name="durationMinutes" type="number" min="5" max="480" step="5" value="${Number(draft.durationMinutes) || state.preferences.focusMinutes}" required></div><div class="field"><label for="task-due">Deadline</label><input id="task-due" class="input" name="dueAt" type="datetime-local" value="${escapeHtml(localDateTimeInput(draft.dueAt))}"></div></div>
      <div class="field-grid"><div class="field"><label for="task-energy">Energy</label><select id="task-energy" class="select" name="energy">${["low", "medium", "high"].map(value => html`<option value="${value}" ${(draft.energy ?? "medium") === value ? "selected" : ""}>${titleCase(value)}</option>`).join("")}</select></div><div class="field"><label for="task-priority">Priority</label><select id="task-priority" class="select" name="priority">${["low", "normal", "high"].map(value => html`<option value="${value}" ${(draft.priority ?? "normal") === value ? "selected" : ""}>${titleCase(value)}</option>`).join("")}</select></div></div>
      ${assumptions.length ? html`<div class="privacy-note"><strong>Assumptions to review</strong><ul class="assumption-list">${assumptions.map(item => html`<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
      <div class="field-grid"><div class="field"><label for="task-important">Important to my goals?</label><select id="task-important" class="select" name="important"><option value="unset" ${draft.important == null ? "selected" : ""}>Not decided yet</option><option value="yes" ${draft.important === true ? "selected" : ""}>Yes · important</option><option value="no" ${draft.important === false ? "selected" : ""}>No · less important</option></select></div><div class="field"><label for="task-urgency">Urgency</label><select id="task-urgency" class="select" name="urgency"><option value="auto" ${!draft.urgency || draft.urgency === "auto" ? "selected" : ""}>Auto · due within 24h</option><option value="urgent" ${draft.urgency === "urgent" ? "selected" : ""}>Urgent</option><option value="not-urgent" ${draft.urgency === "not-urgent" ? "selected" : ""}>Not urgent</option></select></div></div><p class="field-help">These choices place the task in the Eisenhower view. Importance is separate from the priority used by the scheduler.</p>
      ${data.source === "gemini" ? html`<p class="field-help">Gemini confidence: ${Math.round((Number(draft.confidence) || 0) * 100)}%. Saving this draft is a separate local action.</p>` : ""}
      </details><div class="button-row"><button class="btn primary" type="submit">${task ? t("Save changes") : t("Add task")}</button>${task ? html`<button class="btn danger ghost" type="button" data-action="archive-task" data-task-id="${escapeHtml(task.id)}">Archive</button>` : ""}</div>
    </form>
  </section></div>`;
}

function renderFocusModal(data = {}) {
  const block = state.schedule.find(item => item.id === data.blockId);
  const parentTask = taskById(data.taskId);
  const task = block?.label ? { ...parentTask, title: block.label } : parentTask;
  const blockMinutes = data.durationMinutes ?? (block ? Math.round((new Date(block.endAt) - new Date(block.startAt)) / 60_000) : null);
  const pomodoro = !block && data.mode === "pomodoro";
  return html`<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="focus-modal-title"><div class="modal-head"><div><h2 id="focus-modal-title">Prepare focus</h2><p>${escapeHtml(task?.title ?? t("Choose a rhythm that fits"))}</p></div><button class="icon-button ghost" type="button" data-action="close-modal" aria-label="Close">${icon("close")}</button></div>
    <form id="focus-form" data-task-id="${escapeHtml(data.taskId ?? "")}" data-block-id="${escapeHtml(data.blockId ?? "")}">
      ${state.kanban.enabled ? html`<p class="field-help">Kanban WIP: ${kanbanWip(state).length} / ${state.kanban.wipLimit}. If timer sync is on, starting a task timer moves it to Doing unless that task has a manual hold or blocker. A full limit warns but never blocks a timer.</p>` : ""}
      <div class="field"><label for="timer-mode">Timer mode</label><select id="timer-mode" class="select" name="mode"><option value="single" ${!pomodoro ? "selected" : ""}>Single focus interval</option>${block ? "" : html`<option value="pomodoro" ${pomodoro ? "selected" : ""}>Pomodoro · focus and breaks</option>`}</select>${block ? markup('<p class="field-help">Scheduled blocks use one interval to match their reserved time. Start Pomodoro from the task to work through several rounds.</p>') : ""}</div>
      ${!task ? html`<div class="field"><label for="focus-task">Task (optional)</label><select id="focus-task" name="taskId" class="select"><option value="">Open focus</option>${activeTasks().map(item => html`<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join("")}</select></div>` : ""}
      <div class="field"><label for="focus-minutes">Focus interval (minutes)</label><input id="focus-minutes" class="input" type="number" name="durationMinutes" min="1" max="480" step="1" value="${blockMinutes ?? state.preferences.focusMinutes}" required autofocus></div>
      <fieldset id="pomodoro-fields" ${pomodoro ? "" : "hidden disabled"}><legend>Pomodoro rhythm</legend><div class="field-grid"><div class="field"><label for="break-minutes">Short break (minutes)</label><input id="break-minutes" class="input" type="number" name="breakMinutes" min="1" max="60" value="${state.preferences.breakMinutes}" required></div><div class="field"><label for="long-break-minutes">Long break (minutes)</label><input id="long-break-minutes" class="input" type="number" name="longBreakMinutes" min="1" max="60" value="${state.preferences.longBreakMinutes}" required></div></div>
      <div class="field-grid"><div class="field"><label for="cycles">Focus rounds</label><input id="cycles" class="input" type="number" name="cycles" min="1" max="8" step="1" value="${state.preferences.cycles}" required></div><div class="field"><label for="long-break-every">Long break every (rounds)</label><input id="long-break-every" class="input" type="number" name="longBreakEvery" min="1" max="8" step="1" value="${state.preferences.longBreakEvery}" required></div></div><p class="field-help">Each focus round is followed by a break, including the last round. Start each next phase when ready, or skip a break. Only focus intervals enter your history.</p></fieldset>
      <div class="button-row"><button id="start-timer" class="btn primary" type="submit">${pomodoro ? t("Start Pomodoro") : t("Start focus")}</button></div>
    </form></section></div>`;
}

function renderFeedbackModal() {
  return html`<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title"><div class="modal-head"><div><h2 id="feedback-title">What felt off?</h2><p>This note stays on your device and will be included in backups.</p></div><button class="icon-button ghost" type="button" data-action="close-modal" aria-label="Close">${icon("close")}</button></div><form id="feedback-form"><div class="field"><label for="feedback-text">Observation</label><textarea id="feedback-text" class="textarea" name="text" maxlength="2000" placeholder="A moment of friction, confusion, or delight…" required autofocus></textarea></div><div class="button-row"><button class="btn primary" type="submit">Save observation</button></div></form></section></div>`;
}

function renderConfirmModal(data) {
  return html`<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><div class="modal-head"><div><h2 id="confirm-title">${escapeHtml(data.title)}</h2><p>${escapeHtml(data.message)}</p></div><button class="icon-button ghost" type="button" data-action="close-modal" aria-label="Close">${icon("close")}</button></div><div class="button-row"><button class="btn ${data.danger ? "danger" : "primary"}" type="button" data-action="${escapeHtml(data.confirmAction)}">${escapeHtml(data.confirmLabel)}</button><button class="btn ghost" type="button" data-action="close-modal">Cancel</button></div></section></div>`;
}

function renderModal() {
  if (!ui.modal) return "";
  if (ui.modal.type === "local-extras") return renderLocalExtrasDialog(ui.modal.origins, busy("privacy"));
  if (ui.modal.type === "automatic-ai") return renderAIWarning();
  if (ui.modal.type === "choose-focus") return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="choose-focus-title"><h2 id="choose-focus-title" tabindex="-1">${guideText("What fits right now?", "Việc nào phù hợp lúc này?")}</h2><p>${guideText("Choosing a task does not start a timer or move your plan.", "Chọn việc không chạy bộ đếm hay đổi kế hoạch.")}</p><div class="choice-list">${activeTasks().map(task => `<button type="button" class="choice" data-action="select-focus" data-task-id="${escapeHtml(task.id)}"><span><strong>${escapeHtml(task.title)}</strong><small>${task.durationMinutes} ${guideText("min estimated", "phút ước tính")}</small></span></button>`).join("")}</div><div class="button-row"><button class="btn ghost" type="button" data-action="close-modal">${guideText("Cancel", "Hủy")}</button></div></section></div>`;
  if (ui.modal.type.startsWith("kanban-")) return renderKanbanModal(state, ui.modal);
  if (ui.modal.type === "planning-prompt") return html`<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="planning-prompt-title"><h2 id="planning-prompt-title">Enable planning assistance?</h2><p>AI use averaged at least 3 requests a day over the last week. Planning help is available in Settings.</p><div class="button-row"><button class="btn primary" type="button" data-action="enable-planning">Enable</button><button class="btn ghost" type="button" data-action="close-modal">Not now</button></div></section></div>`;
  if (ui.modal.type === "manual-plan") return html`<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="manual-plan-title"><div class="modal-head"><h2 id="manual-plan-title">Schedule task</h2><button class="icon-button ghost" type="button" data-action="close-modal" aria-label="Close">${icon("close")}</button></div>${renderPlanningAssistant({ manualOnly: true, draft: ui.guideDraft, tasks: activeTasks(), saving: busy("guide-save") })}</section></div>`;
  if (ui.modal.type === "learned-memory") return renderLearnedEditor(ui.learnedDraft, busy("learned"));
  if (ui.modal.type === "capture-blocks") return renderCaptureReview(ui.modal.draft);
  if (ui.modal.type === "task") return renderTaskModal(ui.modal);
  if (ui.modal.type === "focus") return renderFocusModal(ui.modal);
  if (ui.modal.type === "feedback") return renderFeedbackModal();
  if (ui.modal.type === "confirm") return renderConfirmModal(ui.modal);
  return "";
}

function renderShell() {
  const content = ui.view === "about" ? renderAbout() : ui.view === "learn" ? renderLearningCenter(learningGuide ?? normalizeLearningGuide({ enabled: false }), learningError, busy("learning")) : ui.view === "privacy" ? html`${renderPrivacyScreen()}<button class="btn primary" type="button" data-action="close-privacy" ${busy("privacy") || busy("connect") ? "disabled" : ""}>Done</button>` : ui.view === "activity" ? activityUI.render() : ui.view === "plan" ? renderPlan() : ui.view === "insights" ? renderInsights() : ui.view === "settings" ? renderSettings() : renderToday();
  return html`<div class="shell">${renderTopbar()}<main><div id="learning-slot">${renderInteractiveGuide()}</div><!-- learning-slot-end -->${content}</main></div>${renderNav()}${["today", "plan"].includes(ui.view) ? renderOmnibar() : ""}${renderModal()}<div id="learning-overlay-host">${renderTour()}</div><!-- learning-overlay-end -->`;
}

function activeLearningStep() {
  if (ui.learningTour) return learningTopic(learningContext(ui))?.steps[ui.learningIndex] ?? null;
  if (!state?.profile.onboardingComplete || ui.view === "learn" || ui.modal || ui.busy.size) return null;
  if (["running", "paused", "ready", "complete"].includes(state.focus.status)) return null;
  return currentLearningStep(learningGuide, learningContext(ui));
}

function renderInteractiveGuide() {
  const step = activeLearningStep();
  return !ui.learningTour && step ? renderLearningOffer(learningContext(ui)) : "";
}

function renderTour() { return ui.learningTour ? renderLearningCard(learningGuide, learningContext(ui), activeLearningStep(), busy("learning")) : ""; }

async function saveLearning(action, options = {}) {
  try {
    learningGuide = await learningGuideAction(action, options);
    learningError = "";
    return true;
  } catch {
    learningError = guideText("Guide progress could not be saved. Your tasks and timer are unaffected. Try again from Help & tours.", "Chưa lưu được tiến độ hướng dẫn. Việc và bộ đếm không bị ảnh hưởng. Thử lại trong Trợ giúp & hướng dẫn.");
    return false;
  }
}

async function handleLearningAction(action, button) {
  if (busy("learning")) return;
  if (action === "learning-open") {
    ui.learningTopic = null; ui.learningTour = false; ui.view = "learn"; ui.omnibarOpen = false;
    render();
    document.querySelector("#learning-center-title")?.focus?.({ preventScroll: true });
    return;
  }
  const topicId = learningContext(ui), step = activeLearningStep();
  const topic = learningTopic(button.dataset.topic);
  if (["learning-resume", "learning-replay"].includes(action) && !topic) return;
  ui.busy.add("learning");
  let saved = true, routeChanged = false;
  try {
    if (action === "learning-enabled") {
      saved = await saveLearning("enabled", { enabled: !learningGuide?.enabled });
      routeChanged = true;
    } else if (topic || action === "learning-start") {
      const selected = topic ?? learningTopic(topicId);
      if (!selected) return;
      saved = await saveLearning(action === "learning-replay" ? "replay" : "resume", { topic: selected.id });
      if (saved) {
        guideReturnFocus = document.activeElement;
        ui.learningTopic = selected.id;
        const firstUnread = selected.steps.findIndex(item => !learningGuide.steps[item.id]);
        ui.learningIndex = action === "learning-replay" || firstUnread < 0 ? 0 : firstUnread;
        ui.learningTour = true;
        if (topic) {
          routeChanged = true; ui.view = topic.view;
          if (topic.id === "kanban" && !state.kanban.enabled) ui.view = "settings";
          ui.planView = topic.planView === "kanban" && !state.kanban.enabled ? "matrix" : topic.planView ?? ui.planView;
          ui.omnibarOpen = topic.id === "capture";
        }
        ui.focusMinimized = true;
      }
    } else if (action === "learning-pause") {
      saved = await saveLearning("pause", { topic: topicId });
      // Closing always works, even if the preference store is unavailable.
      ui.learningTour = false;
    } else if (action === "learning-back" && ui.learningTour) ui.learningIndex = Math.max(0, ui.learningIndex - 1);
    else if (["learning-next", "learning-skip"].includes(action) && step && ui.learningTour) {
      saved = await saveLearning(action === "learning-next" ? "acknowledge" : "skip", { step: step.id });
      if (saved) {
        ui.learningIndex++;
        if (ui.learningIndex >= learningTopic(topicId).steps.length) ui.learningTour = false;
      }
    }
  } finally { ui.busy.delete("learning"); }
  const slot = document.querySelector("#learning-slot"), host = document.querySelector("#learning-overlay-host");
  if (slot && host && !routeChanged) {
    // Tour actions preserve the surrounding form and its unsaved inputs.
    clearLearningTarget();
    slot.innerHTML = renderInteractiveGuide();
    host.innerHTML = renderTour();
    if (ui.learningTour) showLearningTarget(activeLearningStep());
  } else render(true);
  if (!saved && learningError) showToast(learningError, "error");
  if (!ui.learningTour) {
    (guideReturnFocus?.isConnected ? guideReturnFocus : document.querySelector('[data-action="learning-start"]') ?? document.querySelector('[data-action="learning-open"]'))?.focus?.({ preventScroll: true });
    guideReturnFocus = null;
  }
}

let promptOpening = false;
async function maybePlanningPrompt() {
  if (ui.view === "learn" || activeLearningStep() || promptOpening || !state.profile.onboardingComplete || ui.modal || ui.omnibarOpen || ui.busy.size || ["running", "paused", "ready"].includes(state.focus.status) || !planningPromptEligible(state)) return;
  promptOpening = true;
  try {
    await commit({ ...state, aiUsage: { ...state.aiUsage, promptSeenAt: new Date().toISOString() } });
    if (!ui.modal && !ui.omnibarOpen && !["running", "paused", "ready"].includes(state.focus.status)) { ui.modal = { type: "planning-prompt" }; render(); }
  } finally { promptOpening = false; }
}

let sortTimeout;
function scheduleAutoSort() {
  clearTimeout(sortTimeout);
  if (ui.view === "learn" || ui.learningTour || !state.profile.onboardingComplete || ui.view === "privacy" || !state.preferences.autoSort || busy("sort") || ui.modal || ui.omnibarOpen) return;
  const candidates = sortingCandidates(state);
  if (!candidates.length || (!gemini.connected && !candidates.some(ruleClassification))) return;
  const key = JSON.stringify(candidates.map(task => [task.id, sortingFingerprint(task)]));
  if (ui.lastSortKey === key) return;
  sortTimeout = setTimeout(async () => {
    ui.lastSortKey = key;
    ui.busy.add("sort");
    render();
    try {
      const result = await sortUnsortedTasks();
      state = result.state; ui.sortError = result.error;
    } catch (error) { ui.sortError = error.message; }
    finally {
      ui.busy.delete("sort");
      if (!ui.modal && !ui.omnibarOpen && !document.activeElement?.matches?.("input, textarea, select") && !activityUI.isEditing()) render();
    }
  }, 700);
}

function render(force = false) {
  if (!state) return;
  if (ui.learningTour && !force && document.querySelector(".learning-overlay")) return;
  clearLearningTarget();
  setLanguage(state.preferences.language);
  locale = getLocale();
  document.documentElement.lang = state.preferences.language;
  document.documentElement.dataset.theme = state.preferences.theme;
  if (!state.profile.onboardingComplete) app.innerHTML = renderOnboarding() + renderModal();
  else if (ui.view === "today" && !ui.focusMinimized && ["running", "paused", "ready"].includes(state.focus.status)) app.innerHTML = renderZen() + renderModal();
  else if (ui.view === "today" && !ui.focusMinimized && state.focus.status === "complete") app.innerHTML = renderPostSession() + renderModal();
  else app.innerHTML = renderShell();
  app.className = "";
  scheduleAutoSort();
  void maybePlanningPrompt().catch(() => {});
  requestAnimationFrame(() => {
    const autofocus = app.querySelector("[autofocus]");
    autofocus?.focus({ preventScroll: true });
    updateTimerDom();
    activityUI.restoreDrafts();
    for (const node of document.querySelectorAll?.(".shell, .onboarding, .bottom-nav, .fab-wrap") ?? []) node.inert = Boolean(ui.modal);
    const localToggle = document.querySelector("#privacy-local-all");
    if (localToggle) { const snapshot = activityUI.privacyState(); localToggle.indeterminate = localExtrasState(snapshot.activity, snapshot.reminders).some; }
    if (ui.learningTour) showLearningTarget(activeLearningStep());
    if (ui.modal && ["local-extras", "automatic-ai", "choose-focus"].includes(ui.modal.type)) document.querySelector('.modal h2')?.focus?.({ preventScroll: true });
    if (!ui.modal && ui.modalReturnSelector) { document.querySelector(ui.modalReturnSelector)?.focus?.({ preventScroll: true }); ui.modalReturnSelector = null; }
  });
}

function updateTimerDom() {
  if (!state || state.focus.status !== "running") return;
  const value = document.querySelector("#timer-value");
  const ring = document.querySelector("#timer-ring");
  if (!value || !ring) return;
  const snapshot = timerSnapshot(state.focus, new Date());
  value.textContent = `${String(snapshot.minutesPart).padStart(2, "0")}:${String(snapshot.secondsPart).padStart(2, "0")}`;
  ring.style.setProperty("--progress", snapshot.progress);
}

async function handleAction(button, event) {
  if (busy("capture-save") || busy("data") || busy("guide-save") || busy("kanban") || busy("privacy")) return;
  const action = button.dataset.action;
  if (action.startsWith("learning-")) return handleLearningAction(action, button);
  if (["navigate", "plan-view", "open-matrix", "go-settings", "go-gemini", "open-privacy", "close-privacy", "open-omnibar", "close-omnibar", "kanban-open", "open-about"].includes(action)) { ui.learningTopic = null; ui.learningTour = false; }
  if (action === "open-about") { ui.view = "about"; render(); return; }
  if (action === "choose-focus") { ui.modalReturnSelector = '[data-action="choose-focus"]'; ui.modal = { type: "choose-focus" }; render(); return; }
  if (action === "select-focus") { if (activeTasks().some(task => task.id === button.dataset.taskId)) ui.nextTaskId = button.dataset.taskId; ui.modal = null; render(); return; }
  if (action === "confirm-local-extras" && ui.modal?.type === "local-extras") {
    const origins = [...ui.modal.origins];
    const permission = requestLocalExtrasPermission(origins); // Keep Chrome's original user gesture.
    await saveLocalExtras(true, origins, permission); return;
  }
  if (action === "confirm-automatic-ai" && ui.modal?.type === "automatic-ai") {
    await setBusy("privacy", async () => { aiPolicy = await setAIPolicy({ automaticEnabled: true }); ui.lastSortKey = ""; ui.modal = null; }); return;
  }
  if (action === "privacy-add-preset") {
    const site = MEDIA_PRESETS.find(item => item.origin === button.dataset.origin);
    if (!site) return;
    const permission = requestSignalPermission(site.origin);
    await setBusy("privacy", async () => {
      if (!await permission) throw new Error(guideText("Site access was not granted.", "Chưa cấp quyền truy cập trang."));
      try { await performActivityAction("site", { origin: site.origin }); } finally { await activityUI.load(); }
    }); return;
  }
  if (action === "privacy-revoke-site") {
    const origin = button.dataset.origin;
    if (!activityUI.privacyState().activity.settings.signalOrigins.includes(origin)) return;
    await setBusy("privacy", async () => {
      try { await revokeMediaAccess(origin); await performActivityAction("site-remove", { origin }); }
      finally { await activityUI.load(); }
    }); return;
  }
  if (action.startsWith("activity-")) return activityUI.action(button);
  if (action.startsWith("kanban-")) {
    if (action === "kanban-preview" || action === "kanban-ask-enable") { ui.modal = { type: action === "kanban-preview" ? "kanban-preview" : "kanban-intro" }; render(); return; }
    if (action === "kanban-open") { ui.view = "plan"; ui.planView = state.kanban.enabled ? "kanban" : "matrix"; ui.modal = null; render(); return; }
    if (["kanban-enable", "kanban-disable", "kanban-dismiss"].includes(action)) {
      if (!await kanbanAction(action.slice(7))) return;
      ui.modal = null;
      if (action === "kanban-enable") { ui.view = "plan"; ui.planView = "kanban"; }
      else ui.planView = "matrix";
      render(); return;
    }
    if (action === "kanban-review" || action === "kanban-undo") {
      await kanbanAction(action.slice(7), { changeId: button.dataset.changeId }); return;
    }
    if (action === "kanban-confirm-start" && ui.modal?.type === "kanban-wip") {
      if (await kanbanAction("move", { taskId: ui.modal.taskId, expectedRevision: ui.modal.expectedRevision, stage: "doing", confirmOverLimit: true })) { ui.modal = null; render(); }
      return;
    }
    const taskId = button.dataset.taskId, item = kanbanItem(state, taskId);
    const options = { taskId, expectedRevision: item.revision };
    if (action === "kanban-block") { ui.modal = { type: "kanban-block", ...options, reason: item.blockedReason }; render(); return; }
    if (action === "kanban-move") {
      if (button.dataset.stage === "doing" && item.stage !== "doing" && kanbanWip(state).length >= state.kanban.wipLimit) { ui.modal = { type: "kanban-wip", ...options }; render(); return; }
      await kanbanAction("move", { ...options, stage: button.dataset.stage }); return;
    }
    if (action === "kanban-unblock" || action === "kanban-allow-auto") { await kanbanAction(action.slice(7), options); return; }
    return;
  }
  if (action.startsWith("tracking-")) {
    if (busy("tracking")) return;
    if (action === "tracking-ask-clear") {
      ui.modal = { type: "confirm", title: t("Clear website tracking?"), message: t("Delete all locally recorded website totals and pause tracking. This cannot be undone. Tasks, timers, and saved memory are kept."), confirmAction: "tracking-clear", confirmLabel: t("Clear and pause"), danger: true };
      render(); return;
    }
    const permission = action === "tracking-enable" ? requestTrackingPermission() : null;
    await setBusy("tracking", async () => {
      if (permission && !await permission) { showToast(t("Permission was not granted. Website tracking stays off.")); return; }
      tracking = action === "tracking-refresh" ? await getTracking() : await trackingAction(action.slice("tracking-".length));
      if (action === "tracking-clear") { ui.modal = null; showToast(t("Website totals deleted and tracking paused. This cannot be undone.")); }
      else if (action === "tracking-enable") showToast(t("Website tracking enabled locally. No data is sent to Gemini."));
      else if (action === "tracking-pause") showToast(t("Website tracking paused; saved totals kept."));
    });
    return;
  }
  if (action.startsWith("learned-")) { await handleLearnedAction(action, button); return; }
  if (action === "enable-planning") {
    ui.modal = null; ui.view = "settings";
    await commit({ ...state, preferences: { ...state.preferences, planningEnabled: true } });
    return;
  }
  if (action === "retry-sort") {
    if (!state.preferences.autoSort || busy("sort") || ui.modal || ui.omnibarOpen) return;
    ui.lastSortKey = "";
    await commit(updateTask(state, button.dataset.taskId, { sortLocked: false, sortFingerprint: "" }));
    await setBusy("sort", async () => {
      const result = await sortUnsortedTasks(true);
      state = result.state; ui.sortError = result.error;
    });
    return;
  }
  if (action === "day-advice") {
    if (busy("advice")) return;
    await setBusy("advice", async () => {
      const result = await runGeminiAction("advice", { timezone });
      if (state.preferences.planningAssistance === "suggest") ui.advice = result;
    });
    return;
  }
  if (action === "advice-use") {
    const suggestion = ui.advice?.suggestions[Number(button.dataset.suggestionIndex)];
    if (!suggestion) return;
    state = await loadState();
    if (suggestion.taskId) {
      const task = taskById(suggestion.taskId);
      if (!task || ["done", "archived"].includes(task.status)) throw new Error(t("That task changed. Request fresh suggestions."));
      ui.modal = { type: "focus", taskId: task.id, durationMinutes: suggestion.durationMinutes };
    } else {
      ui.modal = { type: "task", source: "manual", draft: {} };
    }
    render(); return;
  }
  if (action === "navigate") {
    ui.view = button.dataset.view;
    if (ui.view === "settings") aiPolicy = await getAIPolicy().catch(() => null);
    if (ui.view === "plan" && ["matrix", "schedule", ...(state.kanban.enabled ? ["kanban"] : [])].includes(button.dataset.planView)) ui.planView = button.dataset.planView;
    ui.omnibarOpen = false;
    render();
    return;
  }
  if (action === "plan-view") { ui.planView = ["matrix", "schedule", ...(state.kanban.enabled ? ["kanban"] : [])].includes(button.dataset.value) ? button.dataset.value : "matrix"; render(); return; }
  if (action === "open-matrix") { ui.view = "plan"; ui.planView = "matrix"; render(); return; }
  if (action === "toggle-today-task") { await commit(toggleTodayTask(state, button.dataset.taskId)); return; }
  if (action === "use-automatic-budget") { await commit(useAutomaticDailyBudget(state)); showToast(t("Automatic budget restored.")); return; }
  if (action === "schedule-task") {
    const task = taskById(button.dataset.taskId);
    if (!task) return;
    ui.guideDraft = { output: "block", taskId: task.id, durationMinutes: Math.min(180, task.durationMinutes), editing: true };
    ui.modal = { type: "manual-plan" };
    render();
    document.querySelector("#guided-plan-form")?.scrollIntoView?.({ block: "center" });
    return;
  }
  if (action === "return-timer") { ui.view = "today"; ui.focusMinimized = false; render(); return; }
  if (action === "minimize-timer") { ui.focusMinimized = true; render(); return; }
  if (action === "go-settings") { ui.view = "settings"; aiPolicy = await getAIPolicy().catch(() => null); render(); return; }
  if (action === "go-gemini") { ui.view = "settings"; aiPolicy = await getAIPolicy().catch(() => null); ui.showGeminiForm = !gemini.connected; render(); return; }
  if (action === "return-focus") { ui.view = "today"; ui.focusMinimized = false; render(); return; }
  if (action === "open-privacy") {
    ui.view = "privacy"; ui.showGeminiForm = false;
    await activityUI.load();
    [gemini, tracking, aiPolicy] = await Promise.all([getGeminiStatus().catch(() => ({ ...gemini, available: false })), getTracking().catch(() => null), getAIPolicy().catch(() => null)]);
    render(); return;
  }
  if (action === "close-privacy") { if (busy("privacy") || busy("connect")) return; ui.view = "settings"; await commit({ ...state, profile: { ...state.profile, privacyReviewVersion: 1 } }); return; }
  if (action === "privacy-remove-site") { if (busy("privacy")) return; await setBusy("privacy", async () => { await performActivityAction("site-remove", { origin: button.dataset.origin }); await activityUI.load(); }); return; }
  if (action === "onboarding-defaults") { await commit({ ...state, profile: { ...state.profile, experience: "beginner", aim: "general", onboardingStep: 3 } }); return; }
  if (action === "discard-memory-draft") { ui.memoryDraft = null; render(); return; }
  if (action === "ask-clear-memory") {
    if (busy("memory")) return;
    ui.modal = { type: "confirm", title: t("Clear saved custom instructions?"), message: t("This removes the saved text and any unsaved edits, and turns memory off for new requests. It does not delete previous Gemini responses, data already sent to Google, or copies in older backups. To remove copies from opted-in debug history, turn debug text off or clear debug history."), confirmAction: "confirm-clear-memory", confirmLabel: t("Clear instructions"), danger: true };
    render();
    return;
  }
  if (action === "confirm-clear-memory") {
    if (busy("memory")) return;
    await setBusy("memory", async () => {
      await commit(updateMemory(state, { customInstructions: "", enabled: false }));
      ui.memoryDraft = null;
      ui.modal = null;
      showToast(t("Custom instructions cleared on this device."));
    });
    return;
  }
  if (action === "onboarding-advance") {
    if (state.profile.onboardingStep === 1 && !["beginner", "system"].includes(state.profile.experience)) {
      showToast(t("Choose the starting point that fits best."), "error");
      return;
    }
    if (state.profile.onboardingStep === 2 && !["study", "deep-work", "creative", "general"].includes(state.profile.aim)) {
      showToast(t("Choose one direction before continuing."), "error");
      return;
    }
    state.profile.onboardingStep = Math.min(3, state.profile.onboardingStep + 1);
    await commit(state);
    return;
  }
  if (action === "onboarding-back") {
    state.profile.onboardingStep = Math.max(0, state.profile.onboardingStep - 1);
    await commit(state);
    return;
  }
  if (action === "choose-experience") {
    state.profile.experience = button.dataset.value === "system" ? "system" : "beginner";
    await commit(state);
    return;
  }
  if (action === "choose-aim") {
    const aim = button.dataset.value;
    if (!["study", "deep-work", "creative", "general"].includes(aim)) return;
    state.profile.aim = aim;
    await commit(state);
    return;
  }
  if (action === "choose-gemini-setup") {
    state.profile.geminiSetup = button.dataset.value === "now" ? "now" : "later";
    await commit(state);
    return;
  }
  if (action === "finish-onboarding") {
    if (busy("privacy") || busy("connect")) return;
    if (!["beginner", "system"].includes(state.profile.experience)) {
      state.profile.onboardingStep = 1;
      await commit(state);
      showToast(t("Choose your starting point before finishing."), "error");
      return;
    }
    if (!["study", "deep-work", "creative", "general"].includes(state.profile.aim)) {
      state.profile.onboardingStep = 2;
      await commit(state);
      showToast(t("Choose one direction before finishing."), "error");
      return;
    }
    if (state.profile.onboardingStep !== 3) return;
    await commit({ ...state, profile: { ...state.profile, onboardingComplete: true, privacyReviewVersion: 1, geminiSetup: gemini.connected ? "now" : "later" } });
    ui.showGeminiForm = false; ui.view = "today"; render();
    showToast(t("Your local Stuđiô space is ready."));
    return;
  }
  if (action === "replay-onboarding") {
    state.profile = {
      ...state.profile,
      onboardingComplete: false,
      onboardingStep: 0,
      experience: null,
      aim: null,
      geminiSetup: null
    };
    ui.view = "today";
    ui.showGeminiForm = false;
    await commit(state);
    showToast(t("Onboarding restarted without changing your data."));
    return;
  }
  if (action === "open-omnibar") { ui.omnibarOpen = true; render(); return; }
  if (action === "close-omnibar") { ui.omnibarOpen = false; ui.captureText = ""; render(); return; }
  if (action === "new-task") { ui.modal = { type: "task", source: "manual" }; render(); return; }
  if (action === "manual-from-omnibar") {
    const input = document.querySelector("#capture-input");
    ui.captureText = input?.value.trim() ?? ui.captureText;
    ui.modal = { type: "task", source: "manual", draft: { title: ui.captureText, durationMinutes: state.preferences.focusMinutes } };
    render();
    return;
  }
  if (action === "edit-task") { ui.modal = { type: "task", taskId: button.dataset.taskId }; render(); return; }
  if (action === "archive-task") {
    await commit(archiveTask(state, button.dataset.taskId));
    ui.modal = null;
    render();
    showToast(t("Task archived."));
    return;
  }
  if (action === "complete-task") { await commit(completeTask(state, button.dataset.taskId)); showToast(t("Task completed.")); return; }
  if (action === "open-focus") {
    if (["running", "paused", "ready"].includes(state.focus.status)) { ui.view = "today"; ui.focusMinimized = false; render(); showToast(t("Finish or end the current timer before starting another.")); return; }
    ui.modal = { type: "focus", mode: button.dataset.mode || "single", taskId: button.dataset.taskId || null, blockId: button.dataset.blockId || null }; render(); return;
  }
  if (action === "pause-focus") { await timerAction("pause"); return; }
  if (action === "resume-focus") { await timerAction("resume"); return; }
  if (action === "next-phase") { await timerAction("next"); return; }
  if (action === "skip-break") { await timerAction("skip-break"); return; }
  if (action === "ask-stop") {
    ui.zenMenu = false;
    ui.modal = { type: "confirm", title: t("End this session?"), message: t("Elapsed focus time will be kept in your history."), confirmAction: "confirm-stop", confirmLabel: t("End session") };
    render();
    return;
  }
  if (action === "confirm-stop") { ui.modal = null; await timerAction("stop"); return; }
  if (action === "close-post-session") { await timerAction("clear"); return; }
  if (action === "toggle-zen-menu") { ui.zenMenu = !ui.zenMenu; render(); return; }
  if (action === "feedback") { ui.zenMenu = false; ui.modal = { type: "feedback" }; render(); return; }
  if (action === "close-modal") { ui.modal = null; render(); return; }
  if (action === "backdrop-close" && event.target === button) { ui.modal = null; render(); return; }
  if (action === "toggle-secret") {
    const input = document.querySelector("#api-key");
    if (input) input.type = input.type === "password" ? "text" : "password";
    return;
  }
  if (action === "show-gemini-form") { if (state.profile.onboardingComplete && ui.view !== "privacy") ui.view = "settings"; ui.showGeminiForm = true; render(); return; }
  if (action === "disconnect-gemini") {
    await setBusy("disconnect", async () => {
      gemini = await disconnectGemini();
      aiPolicy = await getAIPolicy();
      ui.showGeminiForm = true;
      showToast(t("Gemini disconnected."));
    }).catch(error => showToast(error.message, "error"));
    return;
  }
  if (action === "propose-schedule") {
    const proposal = proposeSchedule(state, new Date());
    ui.view = "plan"; ui.planView = "schedule";
    await commit(saveProposal(state, proposal));
    showToast(proposal.blocks.length ? t("Proposal ready for review.") : t("No feasible slots were found."), proposal.blocks.length ? "success" : "error");
    return;
  }
  if (action === "apply-proposal") { await commit(applyProposal(state, button.dataset.proposalId)); showToast(t("Proposal applied to your local schedule.")); return; }
  if (action === "dismiss-proposal") { await commit(dismissProposal(state, button.dataset.proposalId)); showToast(t("Proposal dismissed.")); return; }
  if (action === "explain-proposal") {
    const proposal = state.proposals.find(item => item.id === button.dataset.proposalId);
    if (!proposal) return;
    await setBusy("explain", async () => {
      const explanation = await runGeminiAction("explain", { proposal, tasks: state.tasks, timezone });
      await commit(attachExplanation(state, proposal.id, explanation));
      showToast(t("Gemini explanation added for review."));
    }).catch(error => showToast(error.message, "error"));
    return;
  }
  if (action === "reflect") {
    await setBusy("reflect", async () => {
      const analytics = computeAnalytics(state);
      ui.reflection = await runGeminiAction("reflect", { metrics: privacyReducedReflectionPayload(analytics) });
      showToast(t("Reflection ready."));
    }).catch(error => showToast(error.message, "error"));
    return;
  }
  if (action === "set-theme") {
    state.preferences.theme = button.dataset.value === "paper" ? "paper" : "night";
    await commit(state);
    return;
  }
  if (action === "export-backup") { await exportBackup(); return; }
  if (action === "export-gemini-debug") {
    if (busy("diagnostics")) return;
    await setBusy("diagnostics", async () => {
      const report = await getGeminiDebugReport();
      downloadJson(report, `studio-gemini-debug-v${APP_VERSION}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      showToast(report.records.length ? t("Debug report exported. Attach the JSON file to your bug report.") : t("Empty report exported. Reproduce the issue on this version, then export again."));
    });
    return;
  }
  if (action === "clear-gemini-debug") {
    if (busy("diagnostics")) return;
    await setBusy("diagnostics", async () => { await clearGeminiDiagnostics(); showToast(t("Debug history cleared.")); });
    return;
  }
  if (action === "choose-import") { document.querySelector("#backup-input")?.click(); return; }
  if (action === "ask-reset") {
    ui.modal = { type: "confirm", title: t("Erase local Stuđiô data?"), message: t("Tasks, plans, settings, Custom Instructions, saved memories, learning evidence, focus history, and saved feedback will be removed. Export a backup first if you may want them later."), confirmAction: "confirm-reset", confirmLabel: t("Erase local data"), danger: true };
    render();
    return;
  }
  if (action === "confirm-reset") {
    await setBusy("data", async () => {
    const replaced = await replaceAppData(createDefaultState(), null, true);
    state = replaced.state; learnedMemory = replaced.memory;
    learningGuide = await getLearningGuide().catch(() => null); learningError = ""; ui.learningTopic = null;
    tracking = await getTracking().catch(() => null);
    await clearGeminiDiagnostics(true);
    diagnosticSettings = { includeText: false };
    await disconnectGemini().catch(() => {});
    gemini = { connected: false, remembered: false, model: DEFAULT_MODEL, lastTestAt: null };
    ui.modal = null;
    ui.view = "today";
    await clearFocusAlarm().catch(() => {});
    ui.memoryDraft = null;
    ui.learnedDraft = null; ui.guideDraft = {}; ui.learningNote = ""; ui.guideReflection = ""; ui.advice = null; ui.guidance = null;
    render();
    showToast(t("Local data erased."));
    });
    return;
  }
  if (action === "confirm-import") {
    if (!ui.pendingImport) return;
    await setBusy("data", async () => {
    const replaced = await replaceAppData(ui.pendingImport, ui.pendingLearningImport);
    state = replaced.state; learnedMemory = replaced.memory;
    tracking = await getTracking().catch(() => null);
    ui.modal = null;
    await syncFocusAlarm().catch(() => {});
    ui.pendingImport = null;
    ui.memoryDraft = null;
    ui.learnedDraft = null; ui.pendingLearningImport = null; ui.guideDraft = {}; ui.learningNote = ""; ui.guideReflection = ""; ui.advice = null; ui.guidance = null;
    ui.view = "today";
    render();
    showToast(t("Backup restored. Learning is paused; API credentials were unchanged."));
    });
  }
}

async function handleLearnedAction(action, button) {
  if (busy("learned")) return;
  const id = button.dataset.memoryId ?? ui.modal?.memoryId;
  if (action === "learned-add" || action === "learned-edit") {
    const record = action === "learned-edit" ? learnedMemory?.memories.find(item => item.id === id) : null;
    if (action === "learned-edit" && !record) throw new Error(t("This memory is no longer available."));
    ui.learnedDraft = record ? { ...structuredClone(record), expectedRevision: record.revision } : { text: "", scope: "general", kind: "context" };
    ui.modal = { type: "learned-memory" }; render(); return;
  }
  if (action === "learned-ask-forget") {
    ui.modal = { type: "confirm", memoryId: id, title: t("Forget this memory?"), message: t("Removes this entry, its learning evidence, and its change history from the memory store. This cannot be undone. Exported backups, debug reports, and original tasks or timer records are separate copies."), confirmAction: "learned-forget", confirmLabel: t("Forget memory"), danger: true };
    render(); return;
  }
  if (action === "learned-ask-clear") {
    ui.modal = { type: "confirm", title: t("Clear learned data?"), message: t("Removes all saved memories, learning evidence, and memory change history, and pauses learning. Custom Instructions, tasks, and timers are kept. Exported files are unchanged."), confirmAction: "learned-clear", confirmLabel: t("Clear learned data"), danger: true };
    render(); return;
  }
  await setBusy("learned", async () => {
    if (action === "learned-refresh-view") learnedMemory = await getLearnedMemory();
    else if (action === "learned-update") {
      const result = await learnedMemoryAction("update");
      learnedMemory = result.store;
      showToast(result.store.lastError || (result.outcome === "updated" ? t("Memory updated. Review the changes below.") : t("Memory update: ") + result.outcome.replaceAll("_", " ")), result.outcome === "failed" ? "error" : "success");
    } else {
      const operation = action.slice("learned-".length);
      if (!["forget", "clear", "confirm", "undo"].includes(operation)) return;
      learnedMemory = await learnedMemoryAction(operation, { id: operation === "undo" ? button.dataset.changeId : id });
      ui.modal = null; ui.advice = null; ui.guidance = null;
      if (operation === "clear") ui.learningNote = "";
      showToast(operation === "forget" ? t("Memory and its learning evidence removed; this cannot be undone.") : t("Saved memory updated."));
    }
  });
}

async function handleSubmit(form) {
  if (form.id.startsWith("activity-")) return activityUI.submit(form);
  const data = new FormData(form);
  if (busy("data")) return;
  if (form.id === "ai-budget-form") {
    if (busy("privacy")) return;
    await setBusy("privacy", async () => { aiPolicy = await setAIPolicy({ dailyLimit: Number(data.get("dailyLimit")) }); ui.lastSortKey = ""; });
    showToast(guideText("Automatic AI limit saved.", "Đã lưu giới hạn AI tự động.")); return;
  }
  if (form.id === "privacy-site-form") {
    if (busy("privacy")) return;
    const url = String(data.get("origin") ?? "");
    const permission = requestSignalPermission(url);
    await setBusy("privacy", async () => {
      if (!await permission) throw new Error("Site access was not granted.");
      await performActivityAction("site", { origin: resourceIdentity(url).origin });
      await activityUI.load(); ui.privacyMediaSetup = false;
      showToast(t("Site enabled. Reload the page to read media signals."));
    }); return;
  }
  if (form.id === "quick-task-form") {
    if (busy("quick-add")) return;
    const title = String(data.get("title") ?? "").trim();
    if (!title) return;
    ui.quickText = title;
    await setBusy("quick-add", async () => {
      await commit(addTask(state, { title, durationMinutes: state.preferences.focusMinutes, source: "manual" }).state);
      ui.quickText = "";
    }); showToast(t("Task added locally.")); return;
  }
  if (form.id === "quick-focus-form") {
    if (["running", "paused", "ready"].includes(state.focus.status)) { ui.view = "today"; ui.focusMinimized = false; render(); return; }
    const choice = selectedFocus();
    const taskId = form.dataset.taskId || choice.task?.id || null;
    const blockId = form.dataset.blockId || choice.block?.id || null;
    const durationMinutes = Number(data.get("durationMinutes"));
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 480) throw new Error("Choose a focus duration from 1 to 480 minutes.");
    ui.view = "today"; ui.focusMinimized = false;
    await timerAction("start", { taskId, blockId, mode: "single", durationMinutes }); return;
  }
  if (form.id === "kanban-block-form" && ui.modal?.type === "kanban-block") {
    ui.modal.reason = String(data.get("reason") ?? "");
    if (await kanbanAction("block", { taskId: ui.modal.taskId, expectedRevision: ui.modal.expectedRevision, reason: ui.modal.reason })) { ui.modal = null; render(); }
    return;
  }
  if (form.id === "budget-form") { await commit(saveDayPlan(state, { availableMinutes: Number(data.get("availableMinutes")) })); showToast(t("Today's time budget saved.")); return; }
  if (form.id === "guide-help-form") {
    if (busy("advice")) return;
    ui.guideReflection = String(data.get("reflection") ?? "");
    await setBusy("advice", async () => {
      const result = await runGeminiAction("advice", { timezone, reflection: ui.guideReflection });
      if (state.preferences.planningAssistance === "guided") ui.guidance = result;
    });
    return;
  }
  if (form.id === "guided-plan-form") {
    if (busy("guide-save")) return;
    const draft = { output: data.get("output"), taskId: String(data.get("taskId") ?? ""), title: String(data.get("title") ?? ""), notes: String(data.get("notes") ?? ""), durationMinutes: Number(data.get("durationMinutes")), startAt: String(data.get("startAt") ?? "") };
    ui.guideDraft = { ...draft, editing: true };
    await setBusy("guide-save", async () => {
      const fresh = await loadState();
      const result = applyGuidedPlan(fresh, draft);
      await commit(result.state);
      ui.guideDraft = {}; ui.advice = null;
      if (ui.modal?.type === "manual-plan") ui.modal = null;
      showToast(result.blockId ? t("Your focus block is scheduled. Its timer has not started.") : t("Your task is saved."));
    });
    return;
  }
  if (form.id === "learned-memory-form") {
    if (busy("learned")) return;
    const expiryInput = String(data.get("expiresAt") ?? "");
    ui.learnedDraft = { ...ui.learnedDraft, text: String(data.get("text") ?? ""), scope: data.get("scope"), kind: data.get("kind"), expiryInput, expiresAt: expiryInput ? new Date(expiryInput).toISOString() : null };
    await setBusy("learned", async () => {
      learnedMemory = await learnedMemoryAction("save", { draft: ui.learnedDraft });
      ui.modal = null; ui.learnedDraft = null; ui.advice = null; ui.guidance = null;
      showToast(t("Memory saved locally. No Gemini call was made."));
    });
    return;
  }
  if (form.id === "learning-note-form") {
    if (busy("learned")) return;
    ui.learningNote = String(data.get("text") ?? ""); ui.learningNoteScope = String(data.get("scope") ?? "general");
    await setBusy("learned", async () => {
      learnedMemory = await learnedMemoryAction("note", { text: ui.learningNote, scope: ui.learningNoteScope });
      ui.learningNote = ""; showToast(t("Observation queued for the next memory update."));
    });
    return;
  }
  if (form.id === "model-choice-form") {
    if (busy("connect")) return;
    const model = submittedModel(data);
    await setBusy("connect", async () => {
      gemini = await changeGeminiModel(model);
      ui.modelDrafts = {};
      await commit({ ...state, preferences: { ...state.preferences, model: gemini.model } });
      showToast(t("Model test passed. Your connection now uses ") + gemini.model + ".");
    });
    return;
  }
  if (form.id === "capture-blocks-form") {
    if (busy("capture-save") || ui.modal?.type !== "capture-blocks") return;
    for (const input of form.querySelectorAll?.("[data-capture-field]") ?? []) updateCaptureDraft(input, false);
    await setBusy("capture-save", async () => {
      // Refresh after review so newly added blocks and timer activity are respected.
      state = await loadState();
      const result = applyCaptureDraft(state, ui.modal.draft);
      await commit(result.state);
      ui.modal = null;
      ui.omnibarOpen = false;
      ui.captureText = "";
      ui.view = "today";
      showToast(msg`Added ${result.blockCount} focus blocks across ${result.taskCount} task${result.taskCount === 1 ? "" : t("s")}.`);
    });
    return;
  }
  if (form.id === "memory-form") {
    if (busy("memory")) return;
    ui.memoryDraft = { customInstructions: String(data.get("customInstructions") ?? ""), enabled: data.get("memoryEnabled") === "on" };
    await setBusy("memory", async () => {
      await commit(updateMemory(state, ui.memoryDraft));
      ui.memoryDraft = null;
      showToast(state.memory.enabled ? t("Instructions saved. They will be used in new Gemini requests.") : t("Instructions saved locally. Use with Gemini is off."));
    });
    return;
  }
  if (form.id === "gemini-form") {
    if (busy("connect")) return;
    const credentials = { apiKey: data.get("apiKey"), model: submittedModel(data), remember: data.get("remember") === "on" };
    await setBusy("connect", async () => {
      gemini = await connectGemini(credentials);
      aiPolicy = await getAIPolicy();
      ui.modelDrafts = {};
      state.preferences.model = gemini.model;
      await commit(state);
      ui.showGeminiForm = false;
      showToast(gemini.message || t("Gemini connection succeeded."));
    }).catch(error => showToast(error.message, "error"));
    return;
  }
  if (form.id === "omnibar-form") {
    if (busy("capture") || busy("capture-preference")) return;
    const text = String(data.get("capture") ?? "").trim();
    if (!text) { showToast(t("Write one thing to interpret."), "error"); return; }
    ui.captureText = text;
    if (!gemini.connected) {
      ui.modal = { type: "task", source: "manual", draft: { title: text, durationMinutes: state.preferences.focusMinutes } };
      showToast(t("Gemini is not connected, so this is a manual draft."));
      render();
      return;
    }
    await setBusy("capture", async () => {
      const draft = await runGeminiAction("capture", { text, nowIso: new Date().toISOString(), timezone, defaultDuration: state.preferences.focusMinutes });
      ui.modal = draft.kind === "capture-blocks"
        ? { type: "capture-blocks", draft: { ...draft, id: uid("capture"), originalTasks: structuredClone(draft.tasks) } }
        : { type: "task", source: "gemini", draft, assumptions: draft.assumptions };
    }).catch(error => showToast(error.message, "error"));
    return;
  }
  if (form.id === "task-form") {
    const dueValue = String(data.get("dueAt") ?? "").trim();
    const draft = {
      title: data.get("title"),
      notes: data.get("notes"),
      durationMinutes: Number(data.get("durationMinutes")),
      dueAt: dueValue ? new Date(dueValue).toISOString() : null,
      energy: data.get("energy"),
      priority: data.get("priority"),
      important: data.get("important") === "yes" ? true : data.get("important") === "no" ? false : null,
      urgency: data.get("urgency") ?? "auto",
      source: form.dataset.source === "gemini" ? "gemini" : "manual"
    };
    const taskId = form.dataset.taskId;
    const existing = taskById(taskId);
    if (draft.important != null || (existing?.important != null && draft.important == null)) Object.assign(draft, { sortLocked: true, sortSource: "manual", sortNote: "" });
    if (taskId) await commit(updateTask(state, taskId, draft));
    else await commit(addTask(state, draft).state);
    ui.modal = null;
    ui.omnibarOpen = false;
    ui.captureText = "";
    render();
    showToast(taskId ? t("Task updated.") : t("Task added locally."));
    return;
  }
  if (form.id === "focus-form") {
    const options = {
      taskId: form.dataset.taskId || data.get("taskId") || null,
      blockId: form.dataset.blockId || null,
      mode: data.get("mode") || "single",
      durationMinutes: Number(data.get("durationMinutes")),
      breakMinutes: Number(data.get("breakMinutes") ?? state.preferences.breakMinutes),
      cycles: Number(data.get("cycles") ?? state.preferences.cycles),
      longBreakMinutes: Number(data.get("longBreakMinutes") ?? state.preferences.longBreakMinutes),
      longBreakEvery: Number(data.get("longBreakEvery") ?? state.preferences.longBreakEvery)
    };
    ui.modal = null;
    ui.view = "today";
    ui.focusMinimized = false;
    await timerAction("start", options);
    return;
  }
  if (form.id === "feedback-form") {
    const text = String(data.get("text") ?? "").trim();
    if (!text) return;
    state.feedback.push({ id: `feedback-${Date.now()}`, text: text.slice(0, 2000), createdAt: new Date().toISOString() });
    ui.modal = null;
    await commit(state);
    showToast(t("Observation saved locally."));
  }
}

function downloadJson(value, filename) {
  const content = JSON.stringify(value, null, 2);
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function exportBackup() {
  const memories = isExtension ? await learnedMemoryAction("export") : null;
  downloadJson(createBackup(state, new Date(), memories), `studio-backup-${localDateKey(new Date())}.json`);
  showToast(t("Backup exported without API credentials."));
}

async function handleImport(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    ui.pendingImport = restoreBackup(parsed);
    ui.pendingLearningImport = parsed.learnedMemory ? normalizeLearnedMemory(parsed.learnedMemory) : null;
    ui.modal = { type: "confirm", title: t("Restore this backup?"), message: msg`It contains ${ui.pendingImport.tasks.length} tasks, ${ui.pendingImport.schedule.length} schedule blocks, and ${ui.pendingImport.sessions.length} focus sessions. Current app data and custom instructions will be replaced; Gemini credentials will not be changed. Memory in this backup is ${activeCustomInstructions(ui.pendingImport.memory) ? t("on and will be sent with new Gemini requests") : ui.pendingImport.memory.enabled ? "on, with no saved text to send" : "off"}.`, confirmAction: "confirm-import", confirmLabel: t("Restore backup") };
    ui.modal.message += msg` Saved memories will also be replaced (${ui.pendingLearningImport?.memories.length ?? 0} entries). Background learning will be paused.`;
    render();
  } catch (error) {
    showToast(error.message || t("Could not read that backup."), "error");
  }
}

document.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  // An ancestor backdrop is not the action for clicks inside the dialog.
  // Keep native disclosure, checkbox/label, and form-submit behavior intact.
  if (button.dataset.action === "backdrop-close" && event.target !== button) return;
  event.preventDefault();
  handleAction(button, event).catch(error => showToast(error.message || t("That action failed."), "error"));
});

document.addEventListener("toggle", event => {
  if (event.target.id === "privacy-ai-options") ui.privacyAdvanced = event.target.open;
}, true);

document.addEventListener("submit", event => {
  event.preventDefault();
  handleSubmit(event.target).catch(error => showToast(error.message || t("Could not save that."), "error"));
});

function retainTaskDraft(input) {
  if (ui.modal?.type !== "task") return;
  const fields = { "task-title": "title", "task-notes": "notes", "task-duration": "durationMinutes", "task-due": "dueAt", "task-energy": "energy", "task-priority": "priority", "task-important": "important", "task-urgency": "urgency" };
  const field = fields[input.id];
  if (!field) return;
  const draft = ui.modal.draft ?? taskById(ui.modal.taskId) ?? {};
  const value = field === "important" ? input.value === "yes" ? true : input.value === "no" ? false : null : input.value;
  ui.modal.draft = { ...draft, [field]: value };
}

document.addEventListener("change", event => {
  const input = event.target;
  if (input.dataset.bulkSite && ui.modal?.type === "local-extras") { ui.modal.origins = input.checked ? [...new Set([...ui.modal.origins, input.dataset.bulkSite])] : ui.modal.origins.filter(origin => origin !== input.dataset.bulkSite); return; }
  if (input.id === "ai-mode") {
    if (input.value === "automatic") { ui.modalReturnSelector = "#ai-mode"; ui.modal = { type: "automatic-ai" }; render(); }
    else setBusy("privacy", async () => { aiPolicy = await setAIPolicy({ automaticEnabled: false }); ui.lastSortKey = ""; }).catch(error => showToast(error.message, "error"));
    return;
  }
  if (input.dataset.privacy) { changePrivacy(input.dataset.privacy, input.checked).catch(error => { render(); showToast(error.message, "error"); }); return; }
  if (activityUI.change(input)) return;
  retainTaskDraft(input);
  if (input.dataset.kanbanSetting) {
    const key = input.dataset.kanbanSetting;
    const value = ["wipLimit", "ageDays"].includes(key) ? Number(input.value) : input.checked;
    kanbanAction("settings", { patch: { [key]: value } }).catch(error => showToast(error.message, "error")); return;
  }
  if (input.id === "planning-enabled" || input.id === "auto-daily-budget" || input.dataset.autoSort !== undefined) {
    const key = input.id === "planning-enabled" ? "planningEnabled" : input.id === "auto-daily-budget" ? "autoDailyBudget" : "autoSort";
    if (key === "autoSort") { ui.lastSortKey = ""; ui.sortError = ""; }
    commit({ ...state, preferences: { ...state.preferences, [key]: input.checked } }).catch(error => showToast(error.message, "error")); return;
  }
  if (input.dataset.quadrantTask) {
    commit(moveToQuadrant(state, input.dataset.quadrantTask, input.value)).catch(error => showToast(error.message, "error")); return;
  }
  if (input.id === "timer-mode") {
    const pomodoro = input.value === "pomodoro";
    const fields = document.querySelector("#pomodoro-fields");
    if (fields) { fields.hidden = !pomodoro; fields.disabled = !pomodoro; }
    const start = document.querySelector("#start-timer");
    if (start) start.textContent = pomodoro ? t("Start Pomodoro") : t("Start focus");
    return;
  }
  if (["model", "connected-model"].includes(input.dataset.modelPicker)) {
    if (busy("connect")) return;
    const id = input.dataset.modelPicker;
    ui.modelDrafts[id] = { ...modelPickerDraft(id), choice: input.value };
    // Update only the custom field; rebuilding the form would clear a pasted key.
    updateModelPickerDom(id);
    return;
  }
  if (input.id === "planning-mode") {
    if (busy("advice") || busy("guide-save")) return;
    const mode = input.value === "suggest" ? "suggest" : "guided";
    commit({ ...state, preferences: { ...state.preferences, planningAssistance: mode } }).catch(error => showToast(error.message, "error"));
    return;
  }
  if (input.dataset.guideField) {
    ui.guideDraft = { ...ui.guideDraft, [input.dataset.guideField]: input.value, editing: true };
    if (["output", "taskId"].includes(input.dataset.guideField)) render();
    return;
  }
  if (input.id === "learned-use" || input.id === "learned-learning") {
    if (busy("learned")) return;
    const patch = { [input.id === "learned-use" ? "useWithGemini" : "learningEnabled"]: input.checked };
    setBusy("learned", async () => {
      learnedMemory = await learnedMemoryAction("settings", { patch });
      ui.advice = null; ui.guidance = null;
    }).catch(error => showToast(error.message, "error"));
    return;
  }
  if (input.id === "learning-note-scope") ui.learningNoteScope = input.value;
  if (ui.learnedDraft && ["learned-scope", "learned-kind", "learned-expiry"].includes(input.id)) ui.learnedDraft[input.id === "learned-expiry" ? "expiryInput" : input.id.slice(8)] = input.value;
  if (updateCaptureDraft(input)) return;
  if (input.id === "diagnostics-include-text") {
    if (busy("diagnostics") || !diagnosticSettings) return;
    setBusy("diagnostics", async () => {
      diagnosticSettings = await setGeminiDiagnosticText(input.checked);
      showToast(diagnosticSettings.includeText ? t("Future debug reports will include request text and API error messages. API keys stay redacted.") : t("Debug text removed. Future reports will contain technical metadata only."));
    }).catch(error => showToast(error.message, "error"));
    return;
  }
  if (input.dataset.captureMultiple) {
    if (busy("capture") || busy("capture-preference") || busy("capture-save")) return;
    const enabled = input.checked;
    setBusy("capture-preference", () => commit({ ...state, preferences: { ...state.preferences, allowMultipleFocusBlocks: enabled } }))
      .catch(error => showToast(error.message, "error"));
    return;
  }
  if (input.id === "backup-input") {
    handleImport(input.files?.[0]);
    input.value = "";
    return;
  }
  if (input.id === "memory-enabled") {
    ui.memoryDraft = { ...(ui.memoryDraft ?? state.memory), enabled: input.checked };
    updateMemoryEditorDom();
    return;
  }
  const preference = input.dataset.preference;
  if (!preference) return;
  const numeric = ["focusMinutes", "breakMinutes", "cycles", "bufferMinutes", "longBreakMinutes", "longBreakEvery", "dailyBudgetMinutes"].includes(preference);
  state.preferences[preference] = numeric ? Number(input.value) : input.value;
  commit(normalizeState(state)).catch(error => showToast(error.message, "error"));
});

document.addEventListener("input", event => {
  if (event.target.id === "quick-task") ui.quickText = event.target.value;
  activityUI.input(event.target);
  retainTaskDraft(event.target);
  if (event.target.id === "kanban-blocker" && ui.modal?.type === "kanban-block") ui.modal.reason = event.target.value;
  if (["model", "connected-model"].includes(event.target.dataset.modelCustom)) {
    if (busy("connect")) return;
    const id = event.target.dataset.modelCustom;
    ui.modelDrafts[id] = { ...modelPickerDraft(id), custom: event.target.value };
    return;
  }
  if (updateCaptureDraft(event.target)) return;
  if (event.target.id === "guide-reflection") ui.guideReflection = event.target.value;
  if (event.target.dataset.guideField) ui.guideDraft = { ...ui.guideDraft, [event.target.dataset.guideField]: event.target.value, editing: true };
  if (event.target.id === "learned-text" && ui.learnedDraft) ui.learnedDraft.text = event.target.value;
  if (event.target.id === "learning-note") ui.learningNote = event.target.value;
  if (event.target.id === "capture-input") ui.captureText = event.target.value;
  if (event.target.id === "memory-instructions") {
    ui.memoryDraft = { ...(ui.memoryDraft ?? state.memory), customInstructions: event.target.value };
    updateMemoryEditorDom();
  }
});

document.addEventListener("keydown", event => {
  if (trapDialogKey(event, document.querySelector('.learning-card[role="dialog"]') ?? document.querySelector('.modal[role="dialog"]'))) return;
  if (event.key !== "Escape") return;
  if (busy("capture-save") || busy("privacy")) return;
  if (ui.learningTour) { event.preventDefault?.(); void handleLearningAction("learning-pause", { dataset: {} }); return; }
  if (ui.modal) ui.modal = null;
  else if (ui.omnibarOpen) { ui.omnibarOpen = false; ui.captureText = ""; ui.learningTopic = null; }
  else if (ui.zenMenu) ui.zenMenu = false;
  render();
});

setInterval(async () => {
  if (!state || state.focus.status !== "running" || busy("timer")) return;
  const reconciled = reconcileFocus(state, new Date());
  if (reconciled.changed) await timerAction("reconcile").catch(error => showToast(error.message, "error"));
  else updateTimerDom();
}, 1000);

async function bootstrap() {
  state = await loadState();
  state = await performTimerAction("reconcile");
  learningGuide = await getLearningGuide().catch(() => {
    learningError = guideText("Guide progress is unavailable. Try opening a guide again.", "Chưa đọc được tiến độ. Thử mở lại một hướng dẫn.");
    return null;
  });
  [gemini, diagnosticSettings, learnedMemory, tracking, aiPolicy] = await Promise.all([
    getGeminiStatus().catch(() => ({ connected: false, remembered: false, available: false, model: state.preferences.model || DEFAULT_MODEL, lastTestAt: null })),
    getGeminiDiagnosticSettings().catch(() => null),
    getLearnedMemory().catch(() => null),
    getTracking().catch(() => null),
    getAIPolicy().catch(() => null)
  ]);
  await activityUI.load();
  activityUI.observe();
  const requestedView = new URLSearchParams(globalThis.location?.search ?? "").get("view");
  if (["today","activity","plan","insights","settings"].includes(requestedView)) { ui.view = requestedView; if (requestedView === "plan") ui.planView = "schedule"; }
  if (gemini.model) state.preferences.model = gemini.model;
  observeState(next => {
    if (saveInFlight) return;
    state = next;
    if (!ui.modal && !ui.omnibarOpen && !document.activeElement?.matches?.("input, textarea, select") && !activityUI.isEditing()) render();
  });
  observeDiagnosticSettings(next => { diagnosticSettings = next; render(); });
  observeAIPolicy(next => {
    if (next.day !== aiPolicy?.day || next.automaticEnabled !== aiPolicy?.automaticEnabled || next.dailyLimit !== aiPolicy?.dailyLimit) ui.lastSortKey = "";
    aiPolicy = next;
    if (!ui.modal && !ui.learningTour && !document.activeElement?.matches?.("input, textarea, select") && ["settings", "privacy"].includes(ui.view)) render();
  });
  observeLearnedMemory(next => {
    learnedMemory = next;
    // Avoid resetting active forms when the background job publishes metadata.
    if (ui.view === "settings" && !ui.modal && !ui.learningTour && !document.activeElement?.matches?.("input, textarea, select")) render();
  });
  render();
}

bootstrap().catch(error => {
  app.innerHTML = html`<div class="app-loading"><p>Stuđiô could not open.</p><p class="subtle">${escapeHtml(t(error.message))}</p></div>`;
});

import { activeCustomInstructions } from "./core/memory.js";
import { localDateKey, uid } from "./core/utils.js";
import { redactText } from "./core/diagnostics.js";
import { normalizeState, STATE_KEY } from "./core/state.js";
import {
  activityEvidence, addEvidence, applyMemoryChanges, buildMemoryUpdateRequest,
  confirmMemory, exportLearnedMemory, forgetMemory, LEARNED_MEMORY_KEY,
  MEMORY_ALARM, MEMORY_LIMITS, normalizeLearnedMemory, pendingEvidence,
  restoreLearnedMemory, saveExplicitMemory, undoMemoryChange
} from "./core/learned-memory.js";

// One writer owns the separate memory store. Network work never holds this
// queue; epoch/revision checks reject stale results after user corrections.
export function createMemoryWorker({ storage, alarms, readState, readCredential, requestUpdate, automaticPolicy = async () => null, interactiveBusy = () => false, now = () => new Date() }) {
  let writes = Promise.resolve();
  let activeRun = null;
  const read = async () => normalizeLearnedMemory((await storage.get(LEARNED_MEMORY_KEY))[LEARNED_MEMORY_KEY]);
  function mutate(operation, extraStorage = {}) {
    const operationPromise = writes.then(async () => {
      const previous = await read();
      const result = await operation(structuredClone(previous));
      if (!result) return previous;
      const next = normalizeLearnedMemory(result);
      next.revision = previous.revision + 1;
      await storage.set({ ...extraStorage, [LEARNED_MEMORY_KEY]: next });
      return next;
    });
    writes = operationPromise.catch(() => {});
    return operationPromise;
  }
  async function get() { await writes; return read(); }

  function workdayEnd(state, date) {
    const end = new Date(date);
    const clock = /^\d{2}:\d{2}$/.test(state.preferences?.dayEnd) ? state.preferences.dayEnd : "21:30";
    const [hours, minutes] = clock.split(":").map(Number);
    end.setHours(hours, minutes, 0, 0);
    return end;
  }

  async function schedule() {
    const store = await get();
    if (!store.settings.learningEnabled) { await alarms.clear(MEMORY_ALARM); return; }
    const policy = await automaticPolicy();
    if (policy && !policy.automaticEnabled) { await alarms.clear(MEMORY_ALARM); return; }
    const date = now(), today = localDateKey(date), state = await readState();
    let when = workdayEnd(state, date);
    if (store.usage.automaticDay === today || (store.usage.day === today && store.usage.calls >= MEMORY_LIMITS.dailyCalls) || (!pendingEvidence(store).length && when <= date)) when.setDate(when.getDate() + 1);
    else if (pendingEvidence(store).some(item => item.day < today)) when = new Date(date);
    if (state.focus?.status === "running" && new Date(state.focus.endsAt) > when) when = new Date(state.focus.endsAt);
    if (store.job) when = new Date(new Date(store.job.startedAt).getTime() + 75_000);
    if (store.retryAfter && new Date(store.retryAfter) > when) when = new Date(store.retryAfter);
    if (policy && policy.used >= policy.dailyLimit) { when = workdayEnd(state, date); when.setDate(when.getDate() + 1); }
    await alarms.create(MEMORY_ALARM, { when: Math.max(date.getTime() + 60_000, when.getTime()) });
  }

  async function recover(resuming = false) {
    const store = await get();
    if (store.job && (!activeRun || resuming) && now().getTime() - new Date(store.job.startedAt).getTime() >= 75_000) {
      await mutate(next => { next.job = null; next.status = "interrupted"; next.lastError = "The browser interrupted an update. Pending evidence is retained; refresh manually or wait for the next daily update."; return next; });
    }
  }

  async function initialize() { await recover(); await schedule(); }

  async function observe(previous, current) {
    const entries = activityEvidence(previous, current);
    if (!entries.length) return;
    const credential = await readCredential();
    await mutate(store => {
      if (!store.settings.learningEnabled) return null;
      return addEvidence(store, entries, [credential.apiKey]);
    });
    await schedule();
  }

  async function settings(patch) {
    if ((!Object.hasOwn(patch ?? {}, "learningEnabled") && !Object.hasOwn(patch ?? {}, "useWithGemini")) || Object.keys(patch).some(key => !["learningEnabled", "useWithGemini"].includes(key) || typeof patch[key] !== "boolean")) throw new Error("Choose whether to learn from activity or use saved memory.");
    const result = await mutate(store => {
      if (Object.hasOwn(patch, "learningEnabled") && patch.learningEnabled !== store.settings.learningEnabled) {
        store.enabledAt = patch.learningEnabled ? now().toISOString() : null;
        store.epoch += 1; store.job = null;
        // Pausing drops the unprocessed backlog; supporting history remains
        // available for already saved entries. Re-enabling starts fresh.
        store.evidence = store.evidence.filter(item => item.sequence <= store.processedSequence);
        store.processedSequence = store.nextSequence - 1;
        store.status = patch.learningEnabled ? "idle" : "paused";
      }
      if (Object.hasOwn(patch, "useWithGemini") && patch.useWithGemini !== store.settings.useWithGemini) { store.memoryRevision += 1; store.lastContext = null; }
      store.settings = { ...store.settings, ...patch };
      return store;
    });
    await schedule(); return result;
  }

  async function save(draft) {
    const credential = await readCredential();
    return mutate(store => saveExplicitMemory(store, draft, now(), [credential.apiKey]));
  }

  async function note(value, scope) {
    if (typeof value !== "string" || !value.trim() || value.length > 1600) throw new Error("Write an observation within 1,600 characters.");
    const credential = await readCredential();
    const result = await mutate(store => {
      if (!store.settings.learningEnabled) throw new Error("Turn on Learn from my activity before submitting a learning note.");
      return addEvidence(store, [{ id: uid("learning-note"), at: now().toISOString(), day: localDateKey(now()), type: "learning_note", origin: "user", scope, detail: value }], [credential.apiKey]);
    });
    await schedule(); return result;
  }

  async function clear(appState = null) {
    const result = await mutate(store => {
      const empty = normalizeLearnedMemory(null);
      empty.epoch = store.epoch + 1; empty.memoryRevision = store.memoryRevision + 1;
      empty.usage = store.usage; empty.lastAttemptAt = store.lastAttemptAt; empty.retryAfter = store.retryAfter;
      return empty;
    }, appState ? { [STATE_KEY]: normalizeState(appState) } : {});
    await schedule(); return result;
  }

  async function restore(backup, appState = null) {
    const result = await mutate(store => restoreLearnedMemory(backup, store, now()), appState ? { [STATE_KEY]: normalizeState(appState) } : {});
    await schedule(); return result;
  }

  async function update(manual = false) {
    if (activeRun) return { outcome: "running", store: await get() };
    activeRun = performUpdate(manual);
    try { return await activeRun; }
    finally { activeRun = null; await schedule().catch(() => {}); }
  }

  async function performUpdate(manual) {
    await recover(true);
    const policy = manual ? null : await automaticPolicy();
    if (policy && (!policy.automaticEnabled || policy.used >= policy.dailyLimit)) return { outcome: "paused", store: await get() };
    const credential = await readCredential();
    const state = await readState();
    let reservation = null, batch = [];
    const prepared = await mutate(store => {
      if (!store.settings.learningEnabled) throw new Error("Learning is paused. Enable Learn from my activity to run an update.");
      if (store.job) return null;
      batch = pendingEvidence(store).slice(0, MEMORY_LIMITS.batch);
      if (!batch.length) { store.status = "no_changes"; store.lastError = ""; return store; }
      const date = now(), today = localDateKey(date);
      if (!manual && (interactiveBusy() || state.focus?.status === "running" || (date < workdayEnd(state, date) && !batch.some(item => item.day < today)))) return null;
      if (!credential.apiKey) { store.status = "paused"; store.lastError = "Connect Gemini to process pending evidence. Existing memories remain available."; return store; }
      if (store.retryAfter && new Date(store.retryAfter) > date) { store.status = "paused"; return store; }
      if (store.usage.day !== today) store.usage = { day: today, calls: 0, automaticDay: store.usage.automaticDay };
      if (store.usage.calls >= MEMORY_LIMITS.dailyCalls || (!manual && store.usage.automaticDay === today)) { store.status = "budget"; store.lastError = "The memory update budget is used for today. Existing memories still work."; return store; }
      reservation = { id: uid("memory-job"), startedAt: date.toISOString(), epoch: store.epoch, memoryRevision: store.memoryRevision, evidenceIds: batch.map(item => item.id), throughSequence: batch.at(-1).sequence, previousUsage: structuredClone(store.usage), previousAttempt: store.lastAttemptAt };
      store.job = reservation; store.usage.calls += 1; store.usage.automaticDay = today;
      store.lastAttemptAt = date.toISOString(); store.lastError = ""; store.status = "running";
      return store;
    });
    if (!reservation) return { outcome: prepared.status, store: prepared };
    try {
      const request = buildMemoryUpdateRequest(prepared, batch, activeCustomInstructions(state.memory));
      const response = await requestUpdate(request, raw => {
        applyMemoryChanges(prepared, raw, batch, now(), [credential.apiKey]);
        return raw;
      }, { automatic: !manual });
      let applied = false;
      const result = await mutate(store => {
        if (store.job?.id !== reservation.id) return null;
        if (!store.settings.learningEnabled || store.epoch !== reservation.epoch || store.memoryRevision !== reservation.memoryRevision) {
          store.job = null; store.status = "pending"; store.lastError = "Memory changed during this update. The stale result was discarded."; return store;
        }
        const next = applyMemoryChanges(store, response, batch, now(), [credential.apiKey]);
        next.job = null; next.processedSequence = Math.max(next.processedSequence, reservation.throughSequence);
        next.lastSuccessAt = now().toISOString(); next.retryAfter = null; next.lastError = "";
        next.status = next.memoryRevision === store.memoryRevision ? "no_changes" : "updated";
        applied = true; return next;
      });
      return { outcome: applied ? result.status : "discarded", store: result };
    } catch (error) {
      const result = await mutate(store => {
        if (store.job?.id !== reservation.id) return null;
        store.job = null; store.status = "failed";
        store.lastError = redactText(error?.message ?? "Memory update failed.", [credential.apiKey]).slice(0, 300);
        store.retryAfter = new Date(now().getTime() + 15 * 60_000).toISOString();
        if (error.code === "automatic_ai_paused") {
          store.usage = reservation.previousUsage; store.lastAttemptAt = reservation.previousAttempt;
          store.retryAfter = error.retryAt; store.status = "budget";
        }
        return store;
      });
      return { outcome: error.code === "automatic_ai_paused" ? "paused" : "failed", store: result };
    }
  }

  async function recordContext(action, selected) {
    await mutate(store => {
      const memoryIds = selected.filter(item => store.memories.some(current => current.id === item.id && current.revision === item.revision && current.text === item.text)).map(item => item.id);
      if ((!store.settings.useWithGemini && selected.length) || memoryIds.length !== selected.length) return null;
      store.lastContext = { at: now().toISOString(), action, memoryIds };
      return store;
    });
  }

  return {
    get, initialize, observe, settings, save, note, update, clear, restore, recordContext, schedule,
    confirm: id => mutate(store => confirmMemory(store, id, now())),
    forget: id => mutate(store => forgetMemory(store, id, now())),
    undo: id => mutate(store => undoMemoryChange(store, id, now())),
    export: async () => exportLearnedMemory(await get())
  };
}

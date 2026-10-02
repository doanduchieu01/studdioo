import { advanceTracking, normalizeTracking, trackingSummary, websiteHost, TRACKING_KEY, TRACKING_ALARM, TRACKING_PERMISSIONS, IDLE_SECONDS } from "./core/browser-tracking.js";

const SESSION_KEY = "studioTrackingBrowserSession";

export function createBrowserTracker(api, clock = () => Date.now()) {
  let queue = Promise.resolve(), revision = 0;
  // Optional API namespaces may appear only after the permission is granted.
  const available = Boolean(api.tabs?.query && api.windows?.getLastFocused && api.permissions?.contains && api.storage?.session);
  const serialize = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  const permitted = async () => available && await api.permissions.contains(TRACKING_PERMISSIONS) && Boolean(api.idle?.queryState);
  const read = async () => (await api.storage.local.get(TRACKING_KEY))[TRACKING_KEY];
  const write = async (old, next) => {
    if (JSON.stringify(old) !== JSON.stringify(next)) await api.storage.local.set({ [TRACKING_KEY]: next });
  };
  async function sessionId() {
    const saved = (await api.storage.session.get(SESSION_KEY))[SESSION_KEY];
    if (saved) return saved;
    const id = crypto.randomUUID();
    await api.storage.session.set({ [SESSION_KEY]: id });
    return id;
  }
  async function sample(ticket, forcePause = false) {
    const old = await read();
    let next = normalizeTracking(old, clock());
    if (!next.enabled) {
      if (old) await write(old, next);
      return trackingSummary(next, clock(), available);
    }
    if (!await permitted()) {
      next.enabled = false; next.cursor = null;
      await write(old, next); await api.alarms.clear(TRACKING_ALARM);
      return trackingSummary(next, clock(), available);
    }
    if (!await api.alarms.get(TRACKING_ALARM)) await api.alarms.create(TRACKING_ALARM, { periodInMinutes: 1 });
    api.idle.setDetectionInterval(IDLE_SECONDS);
    const session = await sessionId();
    let host = null;
    try {
      if (!forcePause && !api.extension?.inIncognitoContext && await api.idle.queryState(IDLE_SECONDS) === "active") {
        const window = await api.windows.getLastFocused({ windowTypes: ["normal"] });
        if (window.focused && !window.incognito && window.state !== "minimized") {
          const [tab] = await api.tabs.query({ active: true, windowId: window.id });
          host = tab?.active && !tab.discarded ? websiteHost(tab.url, tab.incognito) : null;
        }
      }
    } catch {
      // An ambiguous snapshot must not bridge time across an unknown window/tab.
      next.cursor = null;
    }
    if (ticket !== revision) return trackingSummary(next, clock(), available);
    if (!await permitted()) { next.enabled = false; next.cursor = null; }
    next = advanceTracking(next, host, clock(), session);
    await write(old, next);
    return trackingSummary(next, clock(), available);
  }
  return {
    tick(forcePause = false) { const ticket = revision; return serialize(() => sample(ticket, forcePause)); },
    setEnabled(enabled) {
      const ticket = ++revision;
      return serialize(async () => {
        if (enabled && !await permitted()) throw new Error("Allow tab and idle access to enable website tracking.");
        const old = await read(), next = normalizeTracking(old, clock());
        // Pause/re-enable never backfills an unfinished interval.
        next.enabled = enabled === true; next.cursor = null;
        await write(old, next);
        if (!next.enabled) await api.alarms.clear(TRACKING_ALARM);
        return sample(ticket);
      });
    },
    clear() {
      ++revision;
      return serialize(async () => {
        const next = normalizeTracking(null, clock());
        await api.storage.local.set({ [TRACKING_KEY]: next });
        await api.alarms.clear(TRACKING_ALARM);
        return trackingSummary(next, clock(), available);
      });
    }
  };
}

/**
 * Stuđiô AI Companion - Optional-permission requests at first use.
 *
 * Base install keeps only: activeTab, alarms, sidePanel, storage,
 * contextMenus, omnibox + commands. Everything below is requested
 * just-in-time when its feature first runs; denial degrades to a clear
 * toast (or silent skip) — never a crash.
 */

// First TaskPad trigger (Alt+S / Alt+N): inject content-taskpad.js.
export const TASKPAD_INJECT_REQUEST = {
  permissions: ["scripting"],
  origins: ["https://*/*", "http://*/*"],
};

// Lecture-detect heartbeat reads audible tabs + idle state.
export const LECTURE_DETECT_REQUEST = { permissions: ["tabs", "idle"] };

// Tab reads that need url/title (quick-capture, scan-tabs, omnibox source).
export const TABS_QUERY_REQUEST = { permissions: ["tabs"] };

// Reminders / test bells / capture confirmations.
export const NOTIFY_REQUEST = { permissions: ["notifications"] };

/**
 * Request an optional permission set, prompting at most once.
 * Returns true when granted — or when the permissions API is unavailable
 * (unit tests / older builds), where callers must already tolerate absence.
 * On denial (or API throw) calls onDenied once for the user-visible toast,
 * then returns false. Never throws.
 */
export async function ensureOptionalPermissions(chromeNs, request, onDenied) {
  const fail = async () => {
    try {
      if (typeof onDenied === "function") await onDenied();
    } catch {}
    return false;
  };
  try {
    const perms = chromeNs?.permissions;
    if (!perms?.contains || !perms?.request) return true;
    if (await perms.contains(request)) return true;
    const granted = await perms.request(request);
    if (granted === true) return true;
    return fail();
  } catch {
    return fail();
  }
}

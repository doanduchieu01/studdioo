import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { makeChrome } from "./chrome-stub.js";
import {
  ensureOptionalPermissions,
  TASKPAD_INJECT_REQUEST,
  LECTURE_DETECT_REQUEST,
  NOTIFY_REQUEST,
  TABS_QUERY_REQUEST,
} from "../lib/permissions.js";

// Phase 5.2: tabs/scripting/idle/notifications move to optional_permissions,
// host <all_urls> moves to optional_host_permissions; features request the
// grant at first use and degrade to a clear toast on denial (never a crash).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.join(__dirname, "..");
const manifest = () => JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));

test("manifest keeps only minimal base permissions (contextMenus stays: core activation)", () => {
  const m = manifest();
  const base = m.permissions ?? [];
  for (const keep of ["activeTab", "alarms", "sidePanel", "storage", "contextMenus"]) {
    assert.ok(base.includes(keep), `base permissions must keep ${keep}`);
  }
  for (const moved of ["tabs", "scripting", "idle", "notifications"]) {
    assert.ok(!base.includes(moved), `${moved} must NOT remain a base permission`);
  }
});

test("manifest moves tabs/scripting/idle/notifications to optional_permissions", () => {
  const m = manifest();
  const optional = m.optional_permissions ?? [];
  for (const moved of ["tabs", "scripting", "idle", "notifications"]) {
    assert.ok(optional.includes(moved), `optional_permissions must include ${moved}`);
  }
});

test("manifest drops <all_urls> host in favor of optional_host_permissions", () => {
  const m = manifest();
  const raw = JSON.stringify(m);
  assert.ok(!raw.includes("<all_urls>"), "no <all_urls> may remain anywhere in the manifest");
  assert.deepEqual(m.optional_host_permissions, ["https://*/*", "http://*/*"]);
});

test("permission request sets cover the three first-use sites", () => {
  assert.ok(
    TASKPAD_INJECT_REQUEST.permissions.includes("scripting") &&
      (TASKPAD_INJECT_REQUEST.origins ?? []).length > 0,
    "TaskPad inject must request scripting + host origins"
  );
  assert.ok(LECTURE_DETECT_REQUEST.permissions.includes("idle"), "lecture-detect must request idle");
  assert.ok(NOTIFY_REQUEST.permissions.includes("notifications"), "reminders must request notifications");
  assert.ok(TABS_QUERY_REQUEST.permissions.includes("tabs"), "tab reads must request tabs");
});

test("ensureOptionalPermissions: already granted resolves true without prompting", async () => {
  let prompts = 0;
  const fake = {
    permissions: {
      async contains() {
        return true;
      },
      async request() {
        prompts++;
        return true;
      },
    },
  };
  assert.equal(await ensureOptionalPermissions(fake, { permissions: ["tabs"] }, null), true);
  assert.equal(prompts, 0, "must not prompt when already granted");
});

test("ensureOptionalPermissions: missing grant prompts once and returns the verdict", async () => {
  let prompts = 0;
  const fake = {
    permissions: {
      async contains() {
        return false;
      },
      async request() {
        prompts++;
        return true;
      },
    },
  };
  assert.equal(await ensureOptionalPermissions(fake, { permissions: ["tabs"] }, null), true);
  assert.equal(prompts, 1);
});

test("ensureOptionalPermissions: denied path toasts once, returns false, never throws", async () => {
  let toasts = 0;
  const fake = {
    permissions: {
      async contains() {
        return false;
      },
      async request() {
        return false;
      },
    },
  };
  const verdict = await ensureOptionalPermissions(fake, { permissions: ["notifications"] }, async () => {
    toasts++;
  });
  assert.equal(verdict, false);
  assert.equal(toasts, 1, "denial must surface exactly one clear toast");
});

test("ensureOptionalPermissions: missing API (unit tests) resolves true without crashing", async () => {
  assert.equal(await ensureOptionalPermissions({}, { permissions: ["tabs"] }, null), true);
  assert.equal(await ensureOptionalPermissions(undefined, { permissions: ["tabs"] }, null), true);
});

test("ensureOptionalPermissions: throwing API degrades to false + toast, no crash", async () => {
  let toasts = 0;
  const fake = {
    permissions: {
      async contains() {
        throw new Error("boom");
      },
      async request() {
        throw new Error("boom");
      },
    },
  };
  const verdict = await ensureOptionalPermissions(fake, { permissions: ["idle"] }, async () => {
    toasts++;
  });
  assert.equal(verdict, false);
  assert.equal(toasts, 1);
});

async function boot(t, seed = {}) {
  const h = makeChrome(seed);
  const prevChrome = globalThis.chrome;
  const prevFetch = globalThis.fetch;
  globalThis.chrome = h.chrome;
  globalThis.fetch = h.fetchStub;
  t.after(() => {
    globalThis.chrome = prevChrome;
    globalThis.fetch = prevFetch;
  });
  await import(`../background.js?perms=${Date.now()}-${Math.random()}`);
  await delay(10);
  return h;
}

const READABLE_TAB = { id: 7, url: "https://example.com/article", title: "Bai bao hay" };
const LECTURE_TAB = { id: 11, url: "https://www.youtube.com/watch?v=abc", title: "Bai giang", audible: true };

function denyAll(h) {
  h.chrome.permissions = {
    async contains() {
      return false;
    },
    async request() {
      return false;
    },
  };
}

test("denied TaskPad inject toasts clearly and never crashes", async (t) => {
  const h = await boot(t, { tabsSeed: [READABLE_TAB] });
  // Selective denial: scripting+host refused, notifications allowed — the
  // realistic shape of "denied → clear toast" (a toast needs its channel).
  h.chrome.permissions = {
    async contains(req) {
      return (req?.permissions ?? []).includes("notifications");
    },
    async request(req) {
      return (req?.permissions ?? []).includes("notifications");
    },
  };
  let injections = 0;
  const orig = h.chrome.scripting.executeScript.bind(h.chrome.scripting);
  h.chrome.scripting.executeScript = async (opts) => {
    injections++;
    return orig(opts);
  };

  await h.listeners.onCommand("toggle-taskpad");
  await delay(20);
  assert.equal(injections, 0, "denied inject must not touch scripting");
  const forwarded = h.__sent.filter((e) => e.kind === "tabs.sendMessage");
  assert.equal(forwarded.length, 0, "denied inject must not message any tab");
  const notes = h.__sent.filter((e) => e.kind === "notification");
  assert.ok(notes.length >= 1, "denial must surface a clear toast");
  assert.match(`${notes[0].title ?? ""} ${notes[0].message ?? ""}`, /TaskPad|quyền|cho phép/i);
});

test("lecture-detect without grant stays silent: no crash, no activity write", async (t) => {
  const h = await boot(t, { tabsSeed: [LECTURE_TAB] });
  denyAll(h);
  await h.listeners.onAlarm({ name: "companion-heartbeat" });
  await delay(20);
  assert.equal(h.localMap.has("studioActivityToday"), false, "denied detect must not write activity");
});

test("notify without grant degrades silently: task still created, no crash", async (t) => {
  const API = "https://exe-studio.onrender.com";
  const server = { tasks: new Map(), sessions: [] };
  const h = makeChrome({
    localSeed: { studioAuth: { accessToken: "TOK", apiBase: API, user: { id: "u1" } } },
    tabsSeed: [READABLE_TAB],
    fetchImpl: async (url, opts = {}) => {
      const method = opts?.method ?? "GET";
      const body = opts?.body ? JSON.parse(opts.body) : undefined;
      if (url === `${API}/api/v1/tasks/` && method === "POST") {
        const record = { ...structuredClone(body), revision: 1 };
        server.tasks.set(body.id, record);
        return { ok: true, status: 201, async json() { return structuredClone(record); } };
      }
      if (url === `${API}/api/v1/schedule/timeline` && method === "GET") {
        return { ok: true, status: 200, async json() { return []; } };
      }
      if (url === `${API}/api/v1/tasks/` && method === "GET") {
        return { ok: true, status: 200, async json() { return [...server.tasks.values()]; } };
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    },
  });
  denyAll(h);
  const prevChrome = globalThis.chrome;
  const prevFetch = globalThis.fetch;
  globalThis.chrome = h.chrome;
  globalThis.fetch = h.fetchStub;
  t.after(() => {
    globalThis.chrome = prevChrome;
    globalThis.fetch = prevFetch;
  });
  await import(`../background.js?notifydeny=${Date.now()}-${Math.random()}`);
  await delay(10);

  await h.listeners.onClicked(
    { menuItemId: "studi-save-page-task", pageUrl: READABLE_TAB.url },
    READABLE_TAB
  );
  await delay(30);
  assert.equal(server.tasks.size, 1, "capture must still succeed when notifications are denied");
  const notes = h.__sent.filter((e) => e.kind === "notification");
  assert.equal(notes.length, 0, "denied notify must stay silent, not stack toasts");
});

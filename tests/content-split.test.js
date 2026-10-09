import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { makeChrome } from "./chrome-stub.js";

// Phase 5.1: content.js is split — PART 1 (auth bridge, Studio pages only)
// ships as declared content-auth.js with NARROW matches; PART 2
// (TaskPad/scratchpad/bubble) ships as content-taskpad.js injected
// programmatically via chrome.scripting on first Alt+S / Alt+N.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(EXT, f), "utf8");
const manifest = () => JSON.parse(read("manifest.json"));

const NARROW_MATCHES = [
  "https://exe-studio.onrender.com/*",
  "http://localhost:5173/*",
  "http://127.0.0.1:5173/*",
  "http://localhost:8000/*",
  "http://127.0.0.1:8000/*",
];

test("manifest declares ONLY content-auth.js with narrow Studio matches", () => {
  const m = manifest();
  const scripts = m.content_scripts ?? [];
  assert.equal(scripts.length, 1, "exactly one declared content script expected");
  assert.deepEqual(scripts[0].js, ["content-auth.js"]);
  assert.deepEqual(scripts[0].matches, NARROW_MATCHES);
  for (const pat of scripts[0].matches) {
    assert.ok(pat !== "<all_urls>", "auth bridge must not match <all_urls>");
    assert.ok(!pat.includes("://*"), `narrow match must not wildcard hosts: ${pat}`);
  }
});

test("content-taskpad.js is NOT declared in manifest (programmatic inject only)", () => {
  const raw = JSON.stringify(manifest());
  assert.ok(!raw.includes("content-taskpad"), "taskpad must be injected via chrome.scripting, not declared");
});

test("content-auth.js auto-syncs auth and carries no TaskPad code", () => {
  const src = read("content-auth.js");
  assert.ok(src.includes("companion:auto-sync-auth"), "auth bridge message must remain");
  assert.ok(!src.includes("taskpad:toggle"), "no TaskPad toggle in auth bridge");
  assert.ok(!src.includes("taskpad:quick-capture"), "no scratchpad trigger in auth bridge");
  assert.ok(!src.includes("window.top"), "auth bridge has no frame guard");
});

test("content-taskpad.js keeps top-frame guard + toggle listeners, no auth bridge", () => {
  const src = read("content-taskpad.js");
  assert.ok(src.includes("window === window.top"), "window === window.top frame logic must be preserved");
  assert.ok(src.includes("taskpad:toggle"), "Alt+S toggle listener must remain");
  assert.ok(src.includes("taskpad:quick-capture"), "Alt+N scratchpad listener must remain");
  assert.ok(!src.includes("companion:auto-sync-auth"), "no auth bridge in taskpad bundle");
});

test("legacy content.js is gone (split is complete)", () => {
  assert.ok(!fs.existsSync(path.join(EXT, "content.js")), "content.js must be removed after the split");
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
  await import(`../background.js?split=${Date.now()}-${Math.random()}`);
  await delay(10);
  return h;
}

const SELF = { id: "test-companion" };
const READABLE_TAB = { id: 7, url: "https://example.com/article", title: "Bai bao hay" };
const STUDIO_TAB = { id: 8, url: "https://exe-studio.onrender.com/app", title: "Studio" };

function withPermissions(h, { contains = false, request = true } = {}) {
  h.chrome.permissions = {
    async contains() {
      return contains;
    },
    async request() {
      return request;
    },
  };
}

function recordExecutions(h) {
  const executed = [];
  const orig = h.chrome.scripting.executeScript.bind(h.chrome.scripting);
  h.chrome.scripting.executeScript = async (opts) => {
    executed.push(structuredClone(opts));
    return orig(opts);
  };
  return executed;
}

test("auth bridge still auto-syncs on a Studio page without scripting perm", async (t) => {
  const h = await boot(t);
  const res = await h.sendInternal(
    {
      type: "companion:auto-sync-auth",
      payload: { accessToken: "GOOD", refreshToken: "R", user: { id: "u1" }, apiBase: "http://localhost:5173" },
    },
    { id: "test-companion", tab: { url: "http://localhost:5173/app" } }
  );
  assert.equal(res.ok, true);
  assert.equal(res.data?.success, true);
  assert.equal(h.localMap.get("studioAuth")?.accessToken, "GOOD");
});

test("Alt+S injects content-taskpad.js on demand exactly once, then toggles", async (t) => {
  const h = await boot(t, { tabsSeed: [READABLE_TAB] });
  withPermissions(h, { contains: false, request: true });
  const executed = recordExecutions(h);

  await h.listeners.onCommand("toggle-taskpad");
  await delay(10);
  assert.equal(executed.length, 1, "first Alt+S must inject");
  assert.deepEqual(executed[0].files, ["content-taskpad.js"]);
  assert.equal(executed[0].target?.tabId, READABLE_TAB.id);
  let forwarded = h.__sent.filter(
    (e) => e.kind === "tabs.sendMessage" && e.message?.type === "taskpad:toggle"
  );
  assert.equal(forwarded.length, 1, "toggle must reach the injected TaskPad");

  await h.listeners.onCommand("toggle-taskpad");
  await delay(10);
  assert.equal(executed.length, 1, "second Alt+S must NOT re-inject (session dedupe)");
  forwarded = h.__sent.filter(
    (e) => e.kind === "tabs.sendMessage" && e.message?.type === "taskpad:toggle"
  );
  assert.equal(forwarded.length, 2, "second Alt+S must still toggle");
});

test("Alt+N injects on demand then forwards to the scratchpad", async (t) => {
  const h = await boot(t, { tabsSeed: [READABLE_TAB] });
  withPermissions(h, { contains: true });
  const executed = recordExecutions(h);

  await h.listeners.onCommand("quick-capture");
  await delay(10);
  assert.equal(executed.length, 1, "first Alt+N must inject");
  assert.deepEqual(executed[0].files, ["content-taskpad.js"]);
  const forwarded = h.__sent.filter(
    (e) => e.kind === "tabs.sendMessage" && e.message?.type === "taskpad:quick-capture"
  );
  assert.equal(forwarded.length, 1);
});

test("Alt+S on a Studio tab does NOT inject (TaskPad never ran there)", async (t) => {
  const h = await boot(t, { tabsSeed: [STUDIO_TAB] });
  withPermissions(h, { contains: false, request: true });
  const executed = recordExecutions(h);

  await h.listeners.onCommand("toggle-taskpad");
  await delay(10);
  assert.equal(executed.length, 0, "Studio tabs must never get the TaskPad injected");
  const forwarded = h.__sent.filter((e) => e.kind === "tabs.sendMessage");
  assert.equal(forwarded.length, 0, "no toggle may be sent to a Studio tab");
});

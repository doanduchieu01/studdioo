import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { makeChrome } from "./chrome-stub.js";

// Capture-path wiring: Alt+N quick-capture, context-menu page/selection
// tasks, and omnibox create must all carry source_url/source_title through the
// outbox; system/empty pages are rejected with a clear notification and zero
// network calls. Boots the real background.js under the chrome stub.

const API = "https://exe-studio.onrender.com";
const AUTH = { accessToken: "TOK", refreshToken: "R", user: { id: "u1" }, apiBase: API };

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return structuredClone(body); } };
}

// Stateful stub: server holds tasks by id + focus sessions; timeline empty.
function backendStub(server) {
  return async (url, opts = {}) => {
    const method = opts?.method ?? "GET";
    const body = opts?.body ? JSON.parse(opts.body) : undefined;
    if (url === `${API}/api/v1/tasks/` && method === "GET") return jsonResponse(200, [...server.tasks.values()]);
    if (url === `${API}/api/v1/schedule/timeline` && method === "GET") return jsonResponse(200, []);
    if (url === `${API}/api/v1/tasks/` && method === "POST") {
      if (server.tasks.has(body.id)) return jsonResponse(200, server.tasks.get(body.id));
      const record = { ...structuredClone(body), revision: 1 };
      server.tasks.set(body.id, record);
      return jsonResponse(201, record);
    }
    if (url === `${API}/api/v1/focus/session/complete` && method === "POST") {
      const record = { ...structuredClone(body) };
      server.sessions.push(record);
      return jsonResponse(201, record);
    }
    throw new Error(`unexpected fetch in test: ${method} ${url}`);
  };
}

async function boot(t, { server = null, tabs = [], auth = AUTH } = {}) {
  const store = server ?? { tasks: new Map(), sessions: [] };
  const seed = auth ? { studioAuth: structuredClone(auth) } : {};
  const h = makeChrome({ localSeed: seed, tabsSeed: tabs, fetchImpl: backendStub(store) });
  const prevChrome = globalThis.chrome;
  const prevFetch = globalThis.fetch;
  globalThis.chrome = h.chrome;
  globalThis.fetch = h.fetchStub;
  t.after(() => {
    globalThis.chrome = prevChrome;
    globalThis.fetch = prevFetch;
  });
  await import(`../background.js?capbg=${Date.now()}-${Math.random()}`);
  await delay(10);
  return { h, store };
}

const SELF = { id: "test-companion" };
const READABLE_TAB = { id: 7, url: "https://example.com/article", title: "B\u00e0i b\u00e1o hay" };
const SYSTEM_TAB = { id: 9, url: "chrome://extensions", title: "Extensions" };

function fetches(h) {
  return h.__sent.filter((e) => e.kind === "fetch");
}

function notifications(h) {
  return h.__sent.filter((e) => e.kind === "notification");
}

test("quick-capture on a readable tab creates a server task with source fields", async (t) => {
  const { h, store } = await boot(t, { tabs: [READABLE_TAB] });
  const res = await h.sendInternal({ type: "companion:quick-capture" }, SELF);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(store.tasks.size, 1);
  const record = [...store.tasks.values()][0];
  assert.equal(record.source_url, READABLE_TAB.url);
  assert.equal(record.source_title, READABLE_TAB.title);
  assert.equal(record.source, "capture");
  const st = await h.sendInternal({ type: "sync:status" }, SELF);
  assert.equal(st.data.pending, 0, "outbox must drain after flush");
});

test("quick-capture on a chrome:// tab is rejected with zero network calls", async (t) => {
  const { h, store } = await boot(t, { tabs: [SYSTEM_TAB] });
  const res = await h.sendInternal({ type: "companion:quick-capture" }, SELF);
  assert.equal(res.ok, false, JSON.stringify(res));
  assert.match(res.error ?? "", /h\u1ec7 th\u1ed1ng/i);
  assert.equal(fetches(h).length, 0, "rejected capture must not touch the network");
  assert.equal(store.tasks.size, 0);
  assert.ok(notifications(h).length >= 1, "user must see a clear error notification");
});

test("quick-capture on an empty-title page is rejected with zero network calls", async (t) => {
  const { h, store } = await boot(t, { tabs: [{ id: 7, url: "https://example.com/blank", title: "   " }] });
  const res = await h.sendInternal({ type: "companion:quick-capture" }, SELF);
  assert.equal(res.ok, false, JSON.stringify(res));
  assert.equal(fetches(h).length, 0);
  assert.equal(store.tasks.size, 0);
});

test("context-menu selection-task carries source fields to the server", async (t) => {
  const { h, store } = await boot(t, { tabs: [READABLE_TAB] });
  await h.listeners.onClicked(
    { menuItemId: "studi-save-selection-task", selectionText: "  \u00dd ch\u00ednh c\u1ea7n nh\u1edb  ", pageUrl: READABLE_TAB.url },
    READABLE_TAB
  );
  await delay(20);
  assert.equal(store.tasks.size, 1);
  const record = [...store.tasks.values()][0];
  assert.equal(record.title, "\u00dd ch\u00ednh c\u1ea7n nh\u1edb");
  assert.equal(record.source_url, READABLE_TAB.url);
  assert.equal(record.source_title, READABLE_TAB.title);
});

test("context-menu page-task carries source fields to the server", async (t) => {
  const { h, store } = await boot(t, { tabs: [READABLE_TAB] });
  await h.listeners.onClicked({ menuItemId: "studi-save-page-task", pageUrl: READABLE_TAB.url }, READABLE_TAB);
  await delay(20);
  assert.equal(store.tasks.size, 1);
  const record = [...store.tasks.values()][0];
  assert.equal(record.source_url, READABLE_TAB.url);
  assert.equal(record.source_title, READABLE_TAB.title);
});

test("context-menu capture on a chrome:// tab is rejected with zero network calls", async (t) => {
  const { h, store } = await boot(t, { tabs: [SYSTEM_TAB] });
  for (const info of [
    { menuItemId: "studi-save-page-task", pageUrl: SYSTEM_TAB.url },
    { menuItemId: "studi-save-selection-task", selectionText: "some text", pageUrl: SYSTEM_TAB.url },
  ]) {
    await h.listeners.onClicked(info, SYSTEM_TAB);
    await delay(20);
  }
  assert.equal(store.tasks.size, 0);
  assert.equal(fetches(h).length, 0, "system-page context capture must not touch the network");
  assert.ok(notifications(h).length >= 2, "each rejected click must notify");
});

test("omnibox create attaches the active readable tab as source", async (t) => {
  const { h, store } = await boot(t, { tabs: [READABLE_TAB] });
  await h.listeners.onInputEntered("Hoc bai moi");
  await delay(20);
  assert.equal(store.tasks.size, 1);
  const record = [...store.tasks.values()][0];
  assert.equal(record.title, "Hoc bai moi");
  assert.equal(record.source_url, READABLE_TAB.url);
  assert.equal(record.source_title, READABLE_TAB.title);
});

test("omnibox create on a system tab still creates the typed task but without source fields", async (t) => {
  const { h, store } = await boot(t, { tabs: [SYSTEM_TAB] });
  await h.listeners.onInputEntered("Hoc bai moi");
  await delay(20);
  assert.equal(store.tasks.size, 1);
  const record = [...store.tasks.values()][0];
  assert.equal(record.title, "Hoc bai moi");
  assert.ok(!("source_url" in record), "system urls must never be stored as source");
});

test("Alt+N command still forwards to the content-script scratchpad (no behavior change)", async (t) => {
  const { h, store } = await boot(t, { tabs: [READABLE_TAB] });
  await h.listeners.onCommand("quick-capture");
  await delay(10);
  const forwarded = h.__sent.filter(
    (e) => e.kind === "tabs.sendMessage" && e.message?.type === "taskpad:quick-capture"
  );
  assert.equal(forwarded.length, 1);
  assert.equal(store.tasks.size, 0, "Alt+N itself must not create tasks");
  assert.equal(fetches(h).length, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { makeChrome } from "./chrome-stub.js";

// Phase 4 gate (end-to-end, stubbed): each flow boots the real background.js
// and drives it through the outbox to the stub server, asserting server-side
// state — not just enqueued ops.

const API = "https://exe-studio.onrender.com";
const AUTH = { accessToken: "TOK", refreshToken: "R", user: { id: "u1" }, apiBase: API };

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return structuredClone(body); } };
}

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
      server.sessions.push(structuredClone(body));
      return jsonResponse(201, body);
    }
    throw new Error(`unexpected fetch in test: ${method} ${url}`);
  };
}

async function boot(t, { tabs = [], timer = null, auth = AUTH } = {}) {
  const server = { tasks: new Map(), sessions: [] };
  const seed = {};
  if (auth) seed.studioAuth = structuredClone(auth);
  if (timer) seed.studioTimer = structuredClone(timer);
  const h = makeChrome({ localSeed: seed, tabsSeed: tabs, fetchImpl: backendStub(server) });
  const prevChrome = globalThis.chrome;
  const prevFetch = globalThis.fetch;
  globalThis.chrome = h.chrome;
  globalThis.fetch = h.fetchStub;
  t.after(() => {
    globalThis.chrome = prevChrome;
    globalThis.fetch = prevFetch;
  });
  await import(`../background.js?gate4=${Date.now()}-${Math.random()}`);
  await delay(10);
  return { h, server };
}

const SELF = { id: "test-companion" };

test("gate: quick-capture on readable tab lands server-side with source_url/source_title", async (t) => {
  const tab = { id: 7, url: "https://example.com/article", title: "B\u00e0i b\u00e1o hay" };
  const { h, server } = await boot(t, { tabs: [tab] });
  const res = await h.sendInternal({ type: "companion:quick-capture" }, SELF);
  assert.equal(res.ok, true, JSON.stringify(res));
  const st = await h.sendInternal({ type: "sync:status" }, SELF);
  assert.equal(st.data.pending, 0, "outbox must flush through to the server");
  assert.equal(server.tasks.size, 1);
  const record = [...server.tasks.values()][0];
  assert.equal(record.source_url, tab.url);
  assert.equal(record.source_title, tab.title);
});

test("gate: 25m timer fire lands a session POST server-side with matching minutes", async (t) => {
  const startTime = Date.now() - 25 * 60 * 1000;
  const { h, server } = await boot(t, {
    timer: { isRunning: true, durationMinutes: 25, taskTitle: "Deep work", startTime },
  });
  await h.listeners.onAlarm({ name: "pomodoro-timer" });
  await delay(20);
  assert.equal(server.sessions.length, 1);
  assert.equal(server.sessions[0].planned_minutes, 25);
  assert.equal(server.sessions[0].actual_minutes, 25);
  assert.equal(server.sessions[0].started_at, new Date(startTime).toISOString());
  const st = await h.sendInternal({ type: "sync:status" }, SELF);
  assert.equal(st.data.pending, 0, "focus op must flush, not linger in the outbox");
});

test("gate: chrome:// tab capture rejected with zero network calls", async (t) => {
  const tab = { id: 9, url: "chrome://extensions", title: "Extensions" };
  const { h, server } = await boot(t, { tabs: [tab] });
  const res = await h.sendInternal({ type: "companion:quick-capture" }, SELF);
  assert.equal(res.ok, false);
  await h.listeners.onClicked({ menuItemId: "studi-save-page-task", pageUrl: tab.url }, tab);
  await delay(20);
  assert.equal(server.tasks.size, 0);
  assert.equal(server.sessions.length, 0);
  assert.equal(h.__sent.filter((e) => e.kind === "fetch").length, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { makeChrome } from "./chrome-stub.js";

const API = "https://exe-studio.onrender.com";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return structuredClone(body); } };
}

// Stateful stub: server holds tasks by id; timeline always empty.
function backendStub(server) {
  return async (url, opts = {}) => {
    const method = opts?.method ?? "GET";
    const body = opts?.body ? JSON.parse(opts.body) : undefined;
    if (url === `${API}/api/v1/tasks/` && method === "GET") {
      return jsonResponse(200, [...server.tasks.values()]);
    }
    if (url === `${API}/api/v1/schedule/timeline` && method === "GET") {
      return jsonResponse(200, []);
    }
    if (url === `${API}/api/v1/tasks/` && method === "POST") {
      if (server.tasks.has(body.id)) return jsonResponse(200, server.tasks.get(body.id));
      const record = { ...body, revision: 1 };
      server.tasks.set(body.id, record);
      return jsonResponse(201, record);
    }
    const m = String(url).match(/\/api\/v1\/tasks\/([^/]+)$/);
    if (m && method === "PATCH") {
      const current = server.tasks.get(m[1]);
      if (!current) return jsonResponse(404, { detail: "not found" });
      const want = opts?.headers?.["If-Match"];
      if (want != null && Number(want) !== current.revision) {
        return jsonResponse(409, { detail: { error: "conflict", current_revision: current.revision } });
      }
      const next = { ...current, ...body, revision: current.revision + 1 };
      server.tasks.set(m[1], next);
      return jsonResponse(200, next);
    }
    if (m && method === "DELETE") {
      server.tasks.delete(m[1]);
      return jsonResponse(204, null);
    }
    throw new Error(`unexpected fetch in test: ${method} ${url}`);
  };
}

async function boot(t, { server = null, localSeed = null } = {}) {
  const store = server ?? { tasks: new Map() };
  const h = makeChrome({
    localSeed: localSeed ?? {
      studioAuth: { accessToken: "TOK", refreshToken: "R", user: { id: "u1" }, apiBase: API },
    },
    fetchImpl: backendStub(store),
  });
  const prevChrome = globalThis.chrome;
  const prevFetch = globalThis.fetch;
  globalThis.chrome = h.chrome;
  globalThis.fetch = h.fetchStub;
  t.after(() => {
    globalThis.chrome = prevChrome;
    globalThis.fetch = prevFetch;
  });
  await import(`../background.js?syncbg=${Date.now()}-${Math.random()}`);
  await delay(10);
  return { h, store };
}

const SELF = { id: "test-companion" };

test("sync:status on fresh worker reports zeroed counters", async (t) => {
  const { h } = await boot(t);
  const res = await h.sendInternal({ type: "sync:status" }, SELF);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.pending, 0);
  assert.equal(res.data.dead, 0);
  assert.equal(res.data.conflicts, 0);
  assert.equal(res.data.lastPullAt, 0);
  assert.equal(res.data.lastPushAt, 0);
});

test("sync:enqueue then sync:now pushes op and pulls", async (t) => {
  const { h, store } = await boot(t);
  const op = { kind: "task", method: "POST", path: "/tasks/", body: { id: "t-enq", title: "Queued" } };
  const enq = await h.sendInternal({ type: "sync:enqueue", op }, SELF);
  assert.equal(enq.ok, true, JSON.stringify(enq));
  assert.ok(enq.data?.queued?.opId);
  assert.equal(enq.data?.flushed?.pushed, 1);
  assert.ok(store.tasks.has("t-enq"), "server must hold the pushed record");

  const st = await h.sendInternal({ type: "sync:status" }, SELF);
  assert.equal(st.data.pending, 0);
  assert.ok(st.data.lastPushAt > 0);
  assert.ok(st.data.lastPullAt > 0);
});

test("companion:sidepanel-opened pulls server list into studioTaskCache", async (t) => {
  const { h } = await boot(t, {
    server: { tasks: new Map([["web-1", { id: "web-1", title: "Web task", revision: 3 }]]) },
  });
  const res = await h.sendInternal({ type: "companion:sidepanel-opened" }, SELF);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data?.pulled?.ok, true);
  const cache = h.localMap.get("studioTaskCache");
  assert.ok(cache, "pull cache must exist under studioTaskCache");
  assert.ok((cache.tasks ?? []).some((r) => r.id === "web-1"), "web task must be in cache");
});

test("sync-pull alarm triggers a pull without touching the heartbeat", async (t) => {
  const { h } = await boot(t, {
    server: { tasks: new Map([["web-2", { id: "web-2", title: "Alarm pull", revision: 1 }]]) },
  });
  assert.ok(h.listeners.onAlarm, "expected an alarms listener");
  await h.listeners.onAlarm({ name: "sync-pull" });
  await delay(20);
  const cache = h.localMap.get("studioTaskCache");
  assert.ok((cache?.tasks ?? []).some((r) => r.id === "web-2"), "sync-pull alarm must pull into cache");
});

test("sync:conflicts empty, sync:retry-dead revives nothing, sync:restore unknown id errors", async (t) => {
  const { h } = await boot(t);
  const c = await h.sendInternal({ type: "sync:conflicts" }, SELF);
  assert.equal(c.ok, true);
  assert.deepEqual(c.data, []);
  const r = await h.sendInternal({ type: "sync:retry-dead" }, SELF);
  assert.equal(r.ok, true);
  assert.equal(r.data?.revived?.revived ?? r.data?.revived, 0);
  const bad = await h.sendInternal({ type: "sync:restore", conflictId: "nope" }, SELF);
  assert.equal(bad.ok, false);
  assert.match(bad.error ?? "", /Conflict not found/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { makeChrome } from "./chrome-stub.js";

const API = "https://exe-studio.onrender.com";
const SAME_UUID = "11111111-2222-4333-8444-555555555555";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return structuredClone(body); } };
}

function signedInSeed() {
  return {
    studioAuth: { accessToken: "TOK", refreshToken: "R", user: { id: "u1" }, apiBase: API },
  };
}

// Stateful backend: idempotent POST by client UUID, If-Match-checked PATCH
// with the verified 409 shape {detail:{error:"conflict",current_revision}}.
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
    throw new Error(`unexpected fetch in gate test: ${method} ${url}`);
  };
}

async function boot(t, { server = null, localSeed = null } = {}) {
  const store = server ?? { tasks: new Map() };
  const h = makeChrome({
    localSeed: localSeed ?? signedInSeed(),
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
  await import(`../background.js?gates=${Date.now()}-${Math.random()}`);
  await delay(10);
  return { h, store };
}

const SELF = { id: "test-companion" };

test("GATE 1: offline burst 20 ops same UUID → server exactly 1 record", async (t) => {
  // Boot signed-OUT so every enqueue queues without a doomed flush attempt
  // (no tries/backoff consumed), then sign in and push once.
  const { h, store } = await boot(t, { localSeed: {} });
  for (let i = 0; i < 20; i++) {
    const r = await h.sendInternal({
      type: "sync:enqueue",
      op: { kind: "task", method: "POST", path: "/tasks/", body: { id: SAME_UUID, title: `Burst ${i}` } },
    }, SELF);
    assert.equal(r.ok, true, JSON.stringify(r));
  }
  const before = await h.sendInternal({ type: "sync:status" }, SELF);
  assert.equal(before.data.pending, 20);

  h.localMap.set("studioAuth", signedInSeed().studioAuth);
  const synced = await h.sendInternal({ type: "sync:now" }, SELF);
  assert.equal(synced.ok, true, JSON.stringify(synced));
  assert.equal(synced.data?.flushed?.pushed, 20);
  assert.equal(store.tasks.size, 1, "idempotent POST by client UUID must yield exactly 1 server record");
  assert.ok(store.tasks.has(SAME_UUID));
});

test("GATE 2: pull skips pending records, flush-then-pull converges", async (t) => {
  const { h } = await boot(t, {
    server: { tasks: new Map([["t1", { id: "t1", title: "Server cũ", revision: 1 }]]) },
    localSeed: {},
  });
  await h.sendInternal({
    type: "sync:enqueue",
    op: { kind: "task", method: "PATCH", path: "/tasks/t1", body: { title: "Local mới" }, recordId: "t1" },
  }, SELF);

  h.localMap.set("studioAuth", signedInSeed().studioAuth);
  const opened = await h.sendInternal({ type: "companion:sidepanel-opened" }, SELF);
  assert.equal(opened.data?.pulled?.ok, true, JSON.stringify(opened));
  assert.equal(opened.data.pulled.skippedPending, 1);
  const cacheBefore = h.localMap.get("studioTaskCache");
  assert.ok(!(cacheBefore?.tasks ?? []).some((r) => r.id === "t1"), "pending record must not be overwritten by pull");

  const synced = await h.sendInternal({ type: "sync:now" }, SELF);
  assert.equal(synced.data?.flushed?.pushed, 1);
  const cacheAfter = h.localMap.get("studioTaskCache");
  assert.equal(cacheAfter.tasks.find((r) => r.id === "t1")?.title, "Local mới");
});

test("GATE 3: web-created task appears in TaskPad list after sync", async (t) => {
  const { h } = await boot(t, {
    server: { tasks: new Map([["web-9", { id: "web-9", title: "Viec tao tu web", status: "pending", revision: 1 }]]) },
  });
  await h.sendInternal({ type: "companion:sidepanel-opened" }, SELF);
  const cache = h.localMap.get("studioTaskCache");
  assert.ok((cache?.tasks ?? []).some((r) => r.id === "web-9"), "pull must cache the web-created task");

  const list = await h.sendInternal({ type: "companion:get-tasks" }, SELF);
  assert.equal(list.ok, true, JSON.stringify(list));
  assert.ok((list.data?.tasks ?? []).some((x) => x.id === "web-9" && x.title === "Viec tao tu web"),
    "TaskPad list must include the web-created task after sync");
});

test("GATE 4: conflict stores local snapshot, restore re-enqueues PATCH with server revision", async (t) => {
  const { h, store } = await boot(t, {
    server: { tasks: new Map([["t1", { id: "t1", title: "Server", revision: 2 }]]) },
    localSeed: {
      ...signedInSeed(),
      studioTaskCache: { tasks: [{ id: "t1", title: "Local", revision: 1 }], schedule: [] },
    },
  });
  await h.sendInternal({
    type: "sync:enqueue",
    op: { kind: "task", method: "PATCH", path: "/tasks/t1", body: { title: "Local" }, ifMatch: 1, recordId: "t1" },
  }, SELF);

  const conflicts = await h.sendInternal({ type: "sync:conflicts" }, SELF);
  assert.equal(conflicts.ok, true, JSON.stringify(conflicts));
  assert.equal(conflicts.data.length, 1);
  assert.equal(conflicts.data[0].localSnapshot?.title, "Local");
  assert.equal(conflicts.data[0].serverSnapshot?.title, "Server");
  assert.equal(conflicts.data[0].serverRevision, 2);

  const restored = await h.sendInternal({ type: "sync:restore", conflictId: conflicts.data[0].id }, SELF);
  assert.equal(restored.ok, true, JSON.stringify(restored));
  const outbox = h.localMap.get("studioOutbox");
  assert.equal(outbox?.length, 1);
  assert.equal(outbox[0].method, "PATCH");
  assert.equal(outbox[0].ifMatch, 2, "restore must re-enqueue with the server revision");

  const synced = await h.sendInternal({ type: "sync:now" }, SELF);
  assert.equal(synced.data?.flushed?.pushed, 1);
  assert.equal(store.tasks.get("t1")?.title, "Local", "restored local version must win after retry with fresh revision");
  const after = await h.sendInternal({ type: "sync:conflicts" }, SELF);
  assert.equal(after.data.length, 0);
});

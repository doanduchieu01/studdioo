import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { makeChrome } from "./chrome-stub.js";

const API = "https://exe-studio.onrender.com";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return structuredClone(body); } };
}

async function boot(t, { fetchImpl, localSeed } = {}) {
  const h = makeChrome({
    localSeed: localSeed ?? {
      studioAuth: { accessToken: "TOK", refreshToken: "R", user: { id: "u1" }, apiBase: API },
    },
    fetchImpl,
  });
  const prevChrome = globalThis.chrome;
  const prevFetch = globalThis.fetch;
  globalThis.chrome = h.chrome;
  globalThis.fetch = h.fetchStub;
  t.after(() => {
    globalThis.chrome = prevChrome;
    globalThis.fetch = prevFetch;
  });
  await import(`../background.js?outbox=${Date.now()}-${Math.random()}`);
  await delay(10);
  return h;
}

const SELF = { id: "test-companion" };

function onlineServer(server, seen) {
  return async (url, opts = {}) => {
    const method = opts?.method ?? "GET";
    const body = opts?.body ? JSON.parse(opts.body) : undefined;
    seen.push({ url, method, body, ifMatch: opts?.headers?.["If-Match"] });
    if (url === `${API}/api/v1/tasks/` && method === "GET") return jsonResponse(200, [...server.tasks.values()]);
    if (url === `${API}/api/v1/schedule/timeline` && method === "GET") return jsonResponse(200, []);
    if (url === `${API}/api/v1/tasks/` && method === "POST") {
      if (server.tasks.has(body.id)) return jsonResponse(200, server.tasks.get(body.id));
      const record = { ...body, revision: 1 };
      server.tasks.set(body.id, record);
      return jsonResponse(201, record);
    }
    const m = String(url).match(/\/api\/v1\/tasks\/([^/]+)$/);
    if (m && method === "PATCH") {
      const current = server.tasks.get(m[1]) ?? { id: m[1], revision: 1 };
      const next = { ...current, ...body, revision: current.revision + 1 };
      server.tasks.set(m[1], next);
      return jsonResponse(200, next);
    }
    if (m && method === "DELETE") {
      server.tasks.delete(m[1]);
      return jsonResponse(204, null);
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
  };
}

test("offline create-task stays successful AND keeps the op in studioOutbox", async (t) => {
  const seen = [];
  const h = await boot(t, {
    fetchImpl: async (url, opts = {}) => {
      const method = opts?.method ?? "GET";
      seen.push({ url, method });
      if (method === "GET") {
        if (String(url).endsWith("/schedule/timeline")) return jsonResponse(200, []);
        return jsonResponse(200, []);
      }
      throw new TypeError("fetch failed");
    },
  });
  const res = await h.sendInternal(
    { type: "companion:create-task", payload: { title: "Offline burst 1" } },
    SELF
  );
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data?.success, true);
  assert.ok(res.data?.task?.id, "optimistic task must carry the client UUID");
  const outbox = h.localMap.get("studioOutbox");
  assert.equal(outbox?.length, 1, "op must survive offline in the outbox");
  assert.equal(outbox[0].method, "POST");
  assert.equal(outbox[0].body.title, "Offline burst 1");
  assert.match(outbox[0].body.id ?? "", /^[0-9a-f-]{36}$/i, "create must carry a client UUID");
});

test("toggle-task PATCH carries If-Match from the pull cache", async (t) => {
  const server = { tasks: new Map([["t1", { id: "t1", title: "T", status: "pending", revision: 5 }]]) };
  const seen = [];
  const h = await boot(t, {
    fetchImpl: onlineServer(server, seen),
    localSeed: {
      studioAuth: { accessToken: "TOK", refreshToken: "R", user: { id: "u1" }, apiBase: API },
      studioTaskCache: { tasks: [{ id: "t1", title: "T", status: "pending", revision: 5 }], schedule: [] },
    },
  });
  const res = await h.sendInternal(
    { type: "companion:toggle-task", payload: { taskId: "t1", status: "completed" } },
    SELF
  );
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data?.success, true);
  const patch = seen.find((c) => c.method === "PATCH" && c.url.endsWith("/tasks/t1"));
  assert.ok(patch, "expected a PATCH to /tasks/t1");
  assert.equal(patch.ifMatch, "5", "If-Match must come from the cached revision");
  assert.equal(h.localMap.get("studioOutbox")?.length ?? 0, 0, "online op must flush");
});

test("delete-task routes DELETE through the outbox and flushes online", async (t) => {
  const server = { tasks: new Map([["t9", { id: "t9", title: "Xoa", revision: 1 }]]) };
  const seen = [];
  const h = await boot(t, { fetchImpl: onlineServer(server, seen) });
  const res = await h.sendInternal({ type: "companion:delete-task", payload: { taskId: "t9" } }, SELF);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data?.success, true);
  assert.ok(seen.some((c) => c.method === "DELETE" && c.url.endsWith("/tasks/t9")), "expected DELETE /tasks/t9");
  assert.ok(!server.tasks.has("t9"));
  assert.equal(h.localMap.get("studioOutbox")?.length ?? 0, 0);
});

test("context-menu page-task creates via outbox (exactly one POST online)", async (t) => {
  const server = { tasks: new Map() };
  const seen = [];
  const h = await boot(t, { fetchImpl: onlineServer(server, seen) });
  assert.ok(h.listeners.onClicked, "expected a contextMenus.onClicked listener");
  await h.listeners.onClicked(
    { menuItemId: "studi-save-page-task" },
    { title: "Bai hoc", url: "https://example.com/bai" }
  );
  await delay(20);
  const posts = seen.filter((c) => c.method === "POST" && c.url === `${API}/api/v1/tasks/`);
  assert.equal(posts.length, 1);
  assert.match(posts[0].body.id ?? "", /^[0-9a-f-]{36}$/i, "menu create must carry a client UUID");
  assert.equal(server.tasks.size, 1);
});

test("create-task default source is backend-accepted (no more 422 sink)", async (t) => {
  // Hoi quy: default tung la "floating_widget" ma backend Literal khong nhan.
  const server = { tasks: new Map() };
  const seen = [];
  const h = await boot(t, { fetchImpl: onlineServer(server, seen) });
  const res = await h.sendInternal(
    { type: "companion:create-task", payload: { title: "Khong source" } },
    SELF
  );
  assert.equal(res.ok, true, JSON.stringify(res));
  const posts = seen.filter((c) => c.method === "POST" && c.url === `${API}/api/v1/tasks/`);
  assert.equal(posts.length, 1);
  assert.ok(
    ["manual", "capture", "gemini", "extension"].includes(posts[0].body.source),
    `source phai backend chap nhan, nhan: ${posts[0].body.source}`
  );
  assert.equal(server.tasks.size, 1, "task phai toi server, khong rot vao dead");
});

test("internal studi:start-timer creates the alarm and timer row (no more fake timer)", async (t) => {
  // Hoi quy S2: TaskPad gui studi:start-timer noi bo nhung khong co case -> roi qua null.
  const h = await boot(t, {});
  const res = await h.sendInternal(
    { type: "studi:start-timer", payload: { durationMinutes: 25, taskTitle: "Hoc bai" } },
    SELF
  );
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data?.success, true);
  assert.ok(
    h.__sent.some((s) => s.kind === "alarms.create" && s.name === "pomodoro-timer"),
    "phai tao alarm pomodoro-timer"
  );
  const timer = h.localMap.get("studioTimer");
  assert.equal(timer?.isRunning, true);
  assert.equal(timer?.durationMinutes, 25);
  const stop = await h.sendInternal({ type: "studi:stop-timer" }, SELF);
  assert.equal(stop.ok, true, JSON.stringify(stop));
  assert.ok(
    h.__sent.some((s) => s.kind === "alarms.clear" && s.name === "pomodoro-timer"),
    "phai clear alarm khi stop"
  );
  assert.equal(h.localMap.get("studioTimer")?.isRunning, false);
});

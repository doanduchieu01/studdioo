import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { makeChrome } from "./chrome-stub.js";

// Focus reporting: when the pomodoro-timer alarm fires, the existing
// notify + local-minutes behavior stays unchanged, and a POST
// /focus/session/complete is enqueued through the outbox (client UUID for
// idempotency). Signed-out fires record local minutes only — no network.
// Boots the real background.js under the chrome stub.

const API = "https://exe-studio.onrender.com";
const AUTH = { accessToken: "TOK", refreshToken: "R", user: { id: "u1" }, apiBase: API };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function boot(t, { server = null, localSeed = null } = {}) {
  const store = server ?? { tasks: new Map(), sessions: [] };
  const h = makeChrome({ localSeed: localSeed ?? {}, fetchImpl: backendStub(store) });
  const prevChrome = globalThis.chrome;
  const prevFetch = globalThis.fetch;
  globalThis.chrome = h.chrome;
  globalThis.fetch = h.fetchStub;
  t.after(() => {
    globalThis.chrome = prevChrome;
    globalThis.fetch = prevFetch;
  });
  await import(`../background.js?focusrep=${Date.now()}-${Math.random()}`);
  await delay(10);
  return { h, store };
}

function fetches(h) {
  return h.__sent.filter((e) => e.kind === "fetch");
}

function sessionPosts(h) {
  return fetches(h).filter((e) => e.url === `${API}/api/v1/focus/session/complete` && e.method === "POST");
}

test("timer 25m fire posts a focus session with matching minutes (existing behavior unchanged)", async (t) => {
  const startTime = Date.now() - 25 * 60 * 1000;
  const { h, store } = await boot(t, {
    localSeed: {
      studioAuth: structuredClone(AUTH),
      studioTimer: { isRunning: true, durationMinutes: 25, taskTitle: "Algebra", startTime },
    },
  });
  await h.listeners.onAlarm({ name: "pomodoro-timer" });
  await delay(20);

  // Existing behavior unchanged: completion notification + timer cleared + local minutes.
  const notes = h.__sent.filter((e) => e.kind === "notification");
  assert.ok(notes.some((n) => /Ho\u00e0n th\u00e0nh phi\u00ean t\u1eadp trung/.test(n.title ?? "")), "completion notification must still fire");
  assert.equal(h.localMap.get("studioTimer")?.isRunning, false);
  assert.equal(h.localMap.get("studioActivityToday")?.focusMinutes, 25);

  // New: exactly one session POST with the right minutes + idempotency id, no task_id.
  const posts = sessionPosts(h);
  assert.equal(posts.length, 1);
  const body = JSON.parse(posts[0].body);
  assert.equal(body.planned_minutes, 25);
  assert.equal(body.actual_minutes, 25);
  assert.equal(body.started_at, new Date(startTime).toISOString());
  assert.match(body.id ?? "", UUID_RE, "client UUID required for idempotency");
  assert.ok(!("task_id" in body) || body.task_id == null, "no fuzzy title matching — task_id only from known context");
  assert.equal(store.sessions.length, 1);
  assert.equal(store.sessions[0].planned_minutes, 25);
});

test("signed-out timer fire records local minutes with zero network calls", async (t) => {
  const { h, store } = await boot(t, {
    localSeed: {
      studioTimer: { isRunning: true, durationMinutes: 25, taskTitle: "Bare countdown", startTime: Date.now() - 25 * 60 * 1000 },
    },
  });
  await h.listeners.onAlarm({ name: "pomodoro-timer" });
  await delay(20);

  assert.equal(h.localMap.get("studioActivityToday")?.focusMinutes, 25, "local minutes still recorded");
  assert.equal(fetches(h).length, 0, "signed-out fire must not touch the network");
  assert.equal(store.sessions.length, 0);
});

test("actual minutes cap at planned when the alarm fires late", async (t) => {
  const startTime = Date.now() - 60 * 60 * 1000;
  const { h } = await boot(t, {
    localSeed: {
      studioAuth: structuredClone(AUTH),
      studioTimer: { isRunning: true, durationMinutes: 25, taskTitle: "Late", startTime },
    },
  });
  await h.listeners.onAlarm({ name: "pomodoro-timer" });
  await delay(20);
  const posts = sessionPosts(h);
  assert.equal(posts.length, 1);
  const body = JSON.parse(posts[0].body);
  assert.equal(body.planned_minutes, 25);
  assert.equal(body.actual_minutes, 25, "elapsed capped at planned");
});

test("optional taskId in studi:start-timer links the session, web contract unchanged", async (t) => {
  const taskId = "11111111-2222-3333-4444-555555555555";
  const { h } = await boot(t, { localSeed: { studioAuth: structuredClone(AUTH) } });
  const origin = { origin: "http://localhost:5173" };
  // Web-style start (durationMinutes + taskTitle only) still works.
  const plain = await h.sendExternal({ type: "studi:start-timer", payload: { durationMinutes: 25, taskTitle: "Web" } }, origin);
  assert.equal(plain.ok, true);
  assert.equal(h.localMap.get("studioTimer")?.taskId ?? null, null);
  // A caller that knows the task id may pass it; it is stored, never guessed.
  const linked = await h.sendExternal({ type: "studi:start-timer", payload: { durationMinutes: 25, taskTitle: "Known", taskId } }, origin);
  assert.equal(linked.ok, true);
  assert.equal(h.localMap.get("studioTimer")?.taskId, taskId);

  await h.listeners.onAlarm({ name: "pomodoro-timer" });
  await delay(20);
  const posts = sessionPosts(h);
  assert.equal(posts.length, 1);
  assert.equal(JSON.parse(posts[0].body).task_id, taskId);
});

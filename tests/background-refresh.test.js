import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { makeChrome } from "./chrome-stub.js";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return structuredClone(body); } };
}

const API = "https://exe-studio.onrender.com";

function expiredOnceFetch() {
  return async (url, opts = {}) => {
    if (String(url).endsWith("/auth/refresh")) {
      return jsonResponse(200, { access_token: "NEW", refresh_token: "R2", user: { id: "u1" } });
    }
    if (opts?.headers?.Authorization === "Bearer OLD") {
      return jsonResponse(401, { detail: "expired" });
    }
    if (String(url) === `${API}/api/v1/tasks/` && (opts?.method ?? "GET") === "POST") {
      return jsonResponse(201, { id: "task-1", title: JSON.parse(opts.body).title });
    }
    if (String(url) === `${API}/api/v1/notes/` && (opts?.method ?? "GET") === "POST") {
      return jsonResponse(201, { id: "note-1" });
    }
    return jsonResponse(200, {});
  };
}

async function boot(t, fetchImpl) {
  const h = makeChrome({
    localSeed: {
      studioAuth: { accessToken: "OLD", refreshToken: "R1", user: { id: "u1" }, apiBase: API },
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
  await import(`../background.js?bgrefresh=${Date.now()}-${Math.random()}`);
  await delay(10);
  return h;
}

test("stubbed 401 on POST task -> auto refresh -> retry succeeds, old token replaced", async (t) => {
  const h = await boot(t, expiredOnceFetch());
  const res = await h.sendInternal(
    { type: "companion:create-task", payload: { title: "Hoc bai moi" } },
    { id: "test-companion" }
  );
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data?.task?.id, "task-1");
  assert.equal(h.localMap.get("studioAuth")?.accessToken, "NEW");
  assert.equal(h.localMap.get("studioAuth")?.refreshToken, "R2");
  const refreshes = h.__sent.filter((e) => e.kind === "fetch" && e.url.endsWith("/auth/refresh"));
  assert.equal(refreshes.length, 1);
});

test("gate: expired token rejected once, refresh succeeds -> TaskPad action completes with NO web re-login", async (t) => {
  const h = await boot(t, expiredOnceFetch());
  const res = await h.sendInternal(
    { type: "companion:create-note", payload: { title: "Ghi chep", content: "nd" } },
    { id: "test-companion" }
  );
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data?.note?.id, "note-1");
  // No re-login was needed: the store still holds a session, now with the new token.
  assert.equal(h.localMap.has("studioAuth"), true);
  assert.equal(h.localMap.get("studioAuth")?.accessToken, "NEW");
});

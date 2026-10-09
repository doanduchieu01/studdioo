import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { makeChrome } from "./chrome-stub.js";

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
  await import(`../background.js?guard=${Date.now()}-${Math.random()}`);
  await delay(10);
  return h;
}

test("(a) companion:auto-sync-auth from non-Studio tab must NOT store auth", async (t) => {
  const h = await boot(t);
  const res = await h.sendInternal(
    {
      type: "companion:auto-sync-auth",
      payload: { accessToken: "EVIL", refreshToken: "R", user: { id: "evil" }, apiBase: "https://evil.example/" },
    },
    { id: "test-companion", tab: { url: "https://evil.example/" } }
  );
  assert.equal(res.ok, false, "evil sender must be rejected");
  assert.match(res.error ?? "", /Stuđiô|Studio|cho phép|allowed|rejected/i);
  assert.equal(h.localMap.has("studioAuth"), false, "auth must not be stored from evil tab");
});

test("(b) companion:auto-sync-auth from localhost:5173 tab MUST store auth", async (t) => {
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

test("(c) onMessageExternal from disallowed origin stays rejected", async (t) => {
  const h = await boot(t);
  const res = await h.sendExternal(
    { type: "studi:ping" },
    { url: "https://evil.example/page", origin: "https://evil.example" }
  );
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /không được phép|not allowed/i);
});

test("(d) onMessageExternal ping from allowed Studio origin still works", async (t) => {
  const h = await boot(t);
  const res = await h.sendExternal(
    { type: "studi:ping" },
    { url: "https://exe-studio.onrender.com/app", origin: "https://exe-studio.onrender.com" }
  );
  assert.equal(res.ok, true);
  assert.equal(res.data?.installed, true);
});

test("(e) manual logout blocks auto-sync and scan until next explicit login", async (t) => {
  const h = await boot(t);
  const studio = { id: "test-companion", tab: { url: "http://localhost:5173/app" } };
  const good = {
    type: "companion:auto-sync-auth",
    payload: { accessToken: "GOOD", refreshToken: "R", user: { id: "u1" }, apiBase: "http://localhost:5173" },
  };
  await h.sendInternal({ type: "companion:logout" }, { id: "test-companion" });
  assert.equal(h.localMap.has("studioAuth"), false);
  const blocked = await h.sendInternal(good, studio);
  assert.equal(blocked.ok, true);
  assert.equal(blocked.data?.success, false, "auto-sync phai bi chan sau logout tay");
  assert.equal(h.localMap.has("studioAuth"), false, "khong luu auth khi bi chan");
  const scan = await h.sendInternal({ type: "companion:scan-tabs-auth" }, { id: "test-companion" });
  assert.equal(scan.data?.success, false, "scan-tabs cung bi chan");
  // Login tay mo lai cua.
  h.localMap.set("studioManualLogoutAt", Date.now() - 6 * 60 * 1000);
  const reopened = await h.sendInternal(good, studio);
  assert.equal(reopened.data?.success, true);
  assert.equal(h.localMap.get("studioAuth")?.accessToken, "GOOD");
});

test("(f) apiBase chuan hoa giong web: 127/localhost -> cung host port 8000", async (t) => {
  const h = await boot(t);
  const from127 = await h.sendInternal(
    {
      type: "companion:auto-sync-auth",
      payload: { accessToken: "T", refreshToken: "R", user: { id: "u1" }, apiBase: "http://127.0.0.1:5173" },
    },
    { id: "test-companion", tab: { url: "http://127.0.0.1:5173/app" } }
  );
  assert.equal(from127.data?.success, true);
  assert.equal(h.localMap.get("studioAuth")?.apiBase, "http://127.0.0.1:8000");
  const fromLocal = await h.sendInternal(
    {
      type: "companion:auto-sync-auth",
      payload: { accessToken: "T2", refreshToken: "R", user: { id: "u1" }, apiBase: "http://localhost:5173" },
    },
    { id: "test-companion", tab: { url: "http://localhost:5173/app" } }
  );
  assert.equal(fromLocal.data?.success, true);
  assert.equal(h.localMap.get("studioAuth")?.apiBase, "http://localhost:8000");
});

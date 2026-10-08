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

import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { makeChrome } from "./chrome-stub.js";

function fakeTaskJson(status = 201, body = { id: "task-1" }) {
  return { ok: status >= 200 && status < 300, status, async json() { return structuredClone(body); } };
}

test("omnibox 'studi <title>' POSTs a task with that title", async (t) => {
  const h = makeChrome({
    localSeed: {
      studioAuth: {
        accessToken: "TOK",
        apiBase: "https://exe-studio.onrender.com",
        user: { id: "u1" },
      },
    },
    fetchImpl: async () => fakeTaskJson(),
  });
  const prevChrome = globalThis.chrome;
  const prevFetch = globalThis.fetch;
  globalThis.chrome = h.chrome;
  globalThis.fetch = h.fetchStub;
  t.after(() => {
    globalThis.chrome = prevChrome;
    globalThis.fetch = prevFetch;
  });

  await import(`../background.js?omnibox=${Date.now()}`);
  await delay(10);

  assert.ok(h.listeners.onInputEntered, "expected chrome.omnibox.onInputEntered listener to be registered");

  await h.listeners.onInputEntered("Hoc bai moi");
  await delay(10);

  const posts = h.__sent.filter(
    (e) => e.kind === "fetch" && e.url === "https://exe-studio.onrender.com/api/v1/tasks/" && e.method === "POST"
  );
  assert.equal(posts.length, 1);
  const payload = JSON.parse(posts[0].body);
  assert.equal(payload.title, "Hoc bai moi");
  assert.equal(posts[0].headers?.Authorization, "Bearer TOK");
});

import test from "node:test";
import assert from "node:assert/strict";

test("background Gemini boundary keeps the key out of URLs and sets store false", async () => {
  const local = new Map();
  const session = new Map();
  let onMessage;
  let fetchCall;

  function area(map) {
    return {
      async get(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter(key => map.has(key)).map(key => [key, map.get(key)]));
      },
      async set(values) { for (const [key, value] of Object.entries(values)) map.set(key, value); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) map.delete(key); }
    };
  }

  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      runtime: {
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: { addListener(listener) { onMessage = listener; } }
      },
      storage: {
        local: area(local),
        session: area(session)
      },
      alarms: {
        onAlarm: { addListener() {} },
        async clear() { return true; },
        async create() {}
      },
      sidePanel: { async setPanelBehavior() {} }
    }
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    fetchCall = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return { steps: [{ type: "model_output", content: [{ type: "text", text: '{"ok":true,"message":"Connection ready"}' }] }] };
      }
    };
  };

  try {
    await import(`../src/background.js?test=${Date.now()}`);
    assert.equal(typeof onMessage, "function");
    const apiKey = "test-private-key-1234567890";
    const response = await new Promise(resolve => {
      const keepAlive = onMessage({ type: "gemini:connect", apiKey, remember: false, model: "gemini-3.1-flash-lite" }, {}, resolve);
      assert.equal(keepAlive, true);
    });
    assert.equal(response.ok, true);
    assert.equal(fetchCall.url.includes(apiKey), false);
    assert.equal(fetchCall.options.headers["x-goog-api-key"], apiKey);
    assert.equal(JSON.parse(fetchCall.options.body).store, false);
    assert.equal(JSON.parse(fetchCall.options.body).model, "gemini-3.1-flash-lite");
    assert.equal(local.has("studioGeminiRememberedKey"), false);
    assert.equal(session.get("studioGeminiSessionKey"), apiKey);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.chrome;
  }
});

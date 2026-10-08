import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient, normalizeBaseUrl, AUTH_KEY, DEFAULT_API_BASE } from "../lib/api.js";

function area(map) {
  return {
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => map.has(key)).map(key => [key, structuredClone(map.get(key))])); },
    async set(values) { for (const [key, value] of Object.entries(values)) map.set(key, structuredClone(value)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) map.delete(key); }
  };
}

function storage(local = new Map()) {
  return { local: area(local) };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return structuredClone(body); } };
}

function authRecord(over = {}) {
  return {
    accessToken: "A1",
    refreshToken: "R1",
    user: { id: "u" },
    apiBase: DEFAULT_API_BASE,
    ...over,
  };
}

test("normalizeBaseUrl accepts http(s) and strips trailing slashes", () => {
  assert.equal(normalizeBaseUrl("http://localhost:8000/"), "http://localhost:8000");
  assert.equal(normalizeBaseUrl("https://api.example.com"), "https://api.example.com");
});

test("normalizeBaseUrl rejects non-http schemes", () => {
  for (const bad of ["file:///etc/passwd", "chrome://extensions", "javascript:alert(1)", "ftp://x", ""]) {
    assert.throws(() => normalizeBaseUrl(bad), /http/, bad || "(empty)");
  }
});

test("requests carry the Bearer token and device label", async () => {
  const local = new Map([[AUTH_KEY, authRecord()]]);
  let seen;
  const api = createApiClient({ storage: storage(local), fetchImpl: async (url, opts) => {
    seen = { url, opts };
    return jsonResponse(200, { ok: true });
  }});
  await api.get("/tasks/");
  assert.equal(seen.url, `${DEFAULT_API_BASE}/api/v1/tasks/`);
  assert.equal(seen.opts.headers.Authorization, "Bearer A1");
  assert.ok(typeof seen.opts.headers["X-Device-Label"] === "string" && seen.opts.headers["X-Device-Label"].length > 0);
});

test("per-request baseUrl comes from stored apiBase", async () => {
  const local = new Map([[AUTH_KEY, authRecord({ apiBase: "https://api.example.com" })]]);
  let seen;
  const api = createApiClient({ storage: storage(local), fetchImpl: async (url, opts) => {
    seen = { url, opts };
    return jsonResponse(200, { ok: true });
  }});
  await api.get("/tasks/");
  assert.equal(seen.url, "https://api.example.com/api/v1/tasks/");
});

test("401 triggers one refresh then retries the original request", async () => {
  const local = new Map([[AUTH_KEY, authRecord({ accessToken: "OLD" })]]);
  const calls = [];
  const api = createApiClient({ storage: storage(local), fetchImpl: async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization });
    if (url.endsWith("/auth/refresh")) return jsonResponse(200, { access_token: "NEW", refresh_token: "R2", user: { id: "u" } });
    if (opts.headers.Authorization === "Bearer OLD") return jsonResponse(401, { detail: "expired" });
    return jsonResponse(200, { ok: true });
  }});
  const result = await api.get("/tasks/");
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.filter(c => c.url.endsWith("/auth/refresh")).length, 1);
  assert.equal(local.get(AUTH_KEY).accessToken, "NEW");
  assert.equal(local.get(AUTH_KEY).refreshToken, "R2");
});

test("failed refresh clears the store and reports unauthorized", async () => {
  const local = new Map([[AUTH_KEY, authRecord({ accessToken: "OLD", refreshToken: "DEAD" })]]);
  const api = createApiClient({ storage: storage(local), fetchImpl: async url => {
    if (url.endsWith("/auth/refresh")) return jsonResponse(401, { detail: "revoked" });
    return jsonResponse(401, { detail: "expired" });
  }});
  await assert.rejects(api.get("/tasks/"), /hết hạn/);
  assert.equal(local.has(AUTH_KEY), false);
});

test("concurrent 401s cause exactly one refresh (single-flight)", async () => {
  const local = new Map([[AUTH_KEY, authRecord({ accessToken: "OLD" })]]);
  let refreshCalls = 0;
  const api = createApiClient({ storage: storage(local), fetchImpl: async (url, opts) => {
    if (url.endsWith("/auth/refresh")) {
      refreshCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 20));
      return jsonResponse(200, { access_token: "NEW", refresh_token: "R2", user: { id: "u" } });
    }
    if (opts.headers.Authorization === "Bearer OLD") return jsonResponse(401, {});
    return jsonResponse(200, { ok: true });
  }});
  const results = await Promise.all(Array.from({ length: 5 }, () => api.get("/tasks/")));
  assert.ok(results.every(r => r.ok));
  assert.equal(refreshCalls, 1);
});

test("If-Match passes through on PATCH", async () => {
  const local = new Map();
  let seen;
  const api = createApiClient({ storage: storage(local), fetchImpl: async (url, opts) => {
    seen = opts.headers;
    return jsonResponse(200, { revision: 4 });
  }});
  await api.patch("/tasks/abc", { title: "x" }, { ifMatch: 3 });
  assert.equal(seen["If-Match"], "3");
});

test("network failure and server errors map to clear codes", async () => {
  const local = new Map();
  const netFail = createApiClient({ storage: storage(local), fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  const netErr = await netFail.get("/tasks/").catch(e => e);
  assert.equal(netErr.code, "network_error");
  const serverFail = createApiClient({ storage: storage(local), fetchImpl: async () => jsonResponse(500, { detail: "boom" }) });
  const srvErr = await serverFail.get("/tasks/").catch(e => e);
  assert.equal(srvErr.code, "http_500");
  assert.match(srvErr.message, /boom/);
});

test("changing base URL signs out, same URL keeps tokens", async () => {
  const local = new Map([[AUTH_KEY, authRecord()]]);
  const api = createApiClient({ storage: storage(local), fetchImpl: async () => jsonResponse(200, {}) });
  assert.equal(await api.setBaseUrl(DEFAULT_API_BASE), DEFAULT_API_BASE);
  assert.equal(local.has(AUTH_KEY), true);
  await api.setBaseUrl("https://api.example.com");
  assert.equal(local.has(AUTH_KEY), false);
  assert.deepEqual(await api.getStatus(), { signedIn: false });
});

test("loginWithPassword stores tokens from /auth/login", async () => {
  const local = new Map();
  const api = createApiClient({ storage: storage(local), fetchImpl: async (url, opts) => {
    assert.match(url, /\/auth\/login$/);
    assert.deepEqual(JSON.parse(opts.body), { email: "a@x.com", password: "pw" });
    return jsonResponse(200, { access_token: "A", refresh_token: "R", user: { id: "u" } });
  }});
  const auth = await api.loginWithPassword({ email: "a@x.com", password: "pw" });
  assert.equal(auth.accessToken, "A");
  assert.equal(local.get(AUTH_KEY).accessToken, "A");
});

test("loginWithGoogle stores tokens from /auth/google", async () => {
  const local = new Map();
  const api = createApiClient({ storage: storage(local), fetchImpl: async (url) => {
    assert.match(url, /\/auth\/google$/);
    return jsonResponse(200, { access_token: "A", refresh_token: "R", user: { id: "u" } });
  }});
  const auth = await api.loginWithGoogle({ id_token: "", email: "chau.nguyen@vnuhcm.edu.vn" });
  assert.equal(auth.accessToken, "A");
  assert.equal(local.get(AUTH_KEY).accessToken, "A");
});

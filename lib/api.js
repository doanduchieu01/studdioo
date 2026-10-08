// ApiClient — the ONLY place that calls HTTP to the Studio backend.
// Ported from archived extension src/core/api.js, adapted to the companion
// store shape: chrome.storage.local key `studioAuth` =
// { accessToken, refreshToken, user, apiBase }.
// - Token re-read from store EVERY request, never cached in module state.
// - 401 with a refresh token -> single refresh -> retry original once.
// - Failed refresh clears the store and throws `unauthorized`.
// - Single-flight concurrent 401s (one refresh for N parallel requests).
// - Device label is a static string (companion has no per-device tracking).
// - Secret only via Authorization header, never in URL.

export const AUTH_KEY = "studioAuth";
export const API_BASE_KEY = "studioApiBase";
export const DEFAULT_API_BASE = "https://exe-studio.onrender.com";

export const API_UNAUTHORIZED = "unauthorized";
export const API_NETWORK = "network_error";
export const API_TIMEOUT = "timeout";

export const API_TIMEOUT_MS = 15_000;
export const API_AI_TIMEOUT_MS = 60_000;

export const DEVICE_LABEL = "Chrome extension";

const AI_PATHS = ["/advisor/", "/tasks/ai-decompose", "/study-plans"];

function timeoutFor(path) {
  return AI_PATHS.some(prefix => String(path).includes(prefix))
    ? API_AI_TIMEOUT_MS
    : API_TIMEOUT_MS;
}

function errorWithCode(code, message) {
  return Object.assign(new Error(message), { code });
}

export function normalizeBaseUrl(raw) {
  const text = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(text)) {
    throw new Error("API address must start with http:// or https://");
  }
  return text;
}

export function deviceLabel(userAgentData, userAgent) {
  const platform = String(userAgentData?.platform ?? "").trim();
  if (platform) return `Chrome · ${platform}`.slice(0, 120);
  const ua = String(userAgent ?? "");
  if (/Windows/i.test(ua)) return "Chrome · Windows";
  if (/Macintosh|Mac OS/i.test(ua)) return "Chrome · macOS";
  if (/Linux/i.test(ua)) return "Chrome · Linux";
  return DEVICE_LABEL;
}

export function createApiClient({ storage, fetchImpl = fetch, now = () => Date.now() } = {}) {
  if (!storage?.local) throw new Error("ApiClient needs chrome.storage.");

  async function readBaseUrl() {
    const saved = await storage.local.get([API_BASE_KEY, AUTH_KEY]);
    const override = saved?.[API_BASE_KEY];
    if (override) return normalizeBaseUrl(override);
    const raw = saved?.[AUTH_KEY]?.apiBase || DEFAULT_API_BASE;
    return normalizeBaseUrl(raw);
  }

  async function readTokens() {
    const saved = await storage.local.get(AUTH_KEY);
    return saved?.[AUTH_KEY] ?? null;
  }

  async function writeTokens(value) {
    if (value == null) {
      await storage.local.remove(AUTH_KEY);
      return null;
    }
    const record = {
      accessToken: value.accessToken,
      refreshToken: value.refreshToken ?? null,
      user: value.user ?? null,
      apiBase: value.apiBase || DEFAULT_API_BASE,
      deviceLabel: value.deviceLabel ?? DEVICE_LABEL,
      obtainedAt: now(),
    };
    await storage.local.set({ [AUTH_KEY]: record });
    return record;
  }

  // Single-flight refresh: concurrent 401s share one refresh call.
  let refreshFlight = null;
  async function refreshTokens(api, tokens) {
    if (!refreshFlight) {
      refreshFlight = (async () => {
        try {
          const res = await fetchImpl(`${api.baseUrl}/api/v1/auth/refresh`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(api.deviceLabel ? { "X-Device-Label": api.deviceLabel } : {}),
            },
            body: JSON.stringify({ refresh_token: tokens.refreshToken }),
            signal: AbortSignal.timeout(API_TIMEOUT_MS),
          });
          if (!res.ok) return null;
          const body = await res.json();
          if (!body?.access_token) return null;
          return writeTokens({
            accessToken: body.access_token,
            refreshToken: body.refresh_token ?? tokens.refreshToken,
            user: body.user ?? tokens.user,
            apiBase: tokens.apiBase || DEFAULT_API_BASE,
            deviceLabel: api.deviceLabel,
          });
        } catch {
          return null;
        } finally {
          refreshFlight = null;
        }
      })();
    }
    return refreshFlight;
  }

  function apiError(status, body) {
    if (status === 401) return errorWithCode(API_UNAUTHORIZED, "Phiên đã hết hạn. Vui lòng đăng nhập lại.");
    const detail = typeof body?.detail === "string" ? body.detail
      : typeof body?.detail?.error === "string" ? body.detail.error
      : null;
    return errorWithCode(`http_${status}`, detail || `Máy chủ trả lỗi ${status}.`);
  }

  async function request(method, path, body, { timeout, ifMatch, retry = true } = {}) {
    const baseUrl = await readBaseUrl();
    const tokens = await readTokens();
    const headers = { "Content-Type": "application/json" };
    const label = tokens?.deviceLabel || DEVICE_LABEL;
    if (label) headers["X-Device-Label"] = label;
    if (tokens?.accessToken) headers.Authorization = `Bearer ${tokens.accessToken}`;
    if (ifMatch != null) headers["If-Match"] = String(ifMatch);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout ?? timeoutFor(path));
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/api/v1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw errorWithCode(API_TIMEOUT, "Máy chủ phản hồi quá lâu. Thử lại sau.");
      }
      throw errorWithCode(API_NETWORK, "Không kết nối được máy chủ. Kiểm tra mạng và địa chỉ API.");
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 && tokens?.refreshToken && retry) {
      const refreshed = await refreshTokens({ baseUrl, deviceLabel: label }, tokens);
      if (refreshed) return request(method, path, body, { timeout, ifMatch, retry: false });
      await writeTokens(null);
      throw errorWithCode(API_UNAUTHORIZED, "Phiên đã hết hạn. Vui lòng đăng nhập lại.");
    }
    if (!response.ok) {
      let parsed = null;
      try { parsed = await response.json(); } catch { /* non-JSON */ }
      throw apiError(response.status, parsed);
    }
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  // Single login implementations shared by background.js and sidepanel.js.
  // Payload bytes identical to the previous direct-fetch code.
  async function loginWithPassword({ email, password, apiBase = DEFAULT_API_BASE } = {}) {
    const baseUrl = normalizeBaseUrl(apiBase);
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      throw errorWithCode(API_NETWORK, "Không kết nối được máy chủ. Kiểm tra mạng và địa chỉ API.");
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const detail = typeof err?.detail === "string" ? err.detail : null;
      throw errorWithCode(`http_${res.status}`, detail || "Email hoặc mật khẩu không chính xác.");
    }
    const data = await res.json();
    return writeTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      user: data.user,
      apiBase: baseUrl,
    });
  }

  async function loginWithGoogle({ id_token, email, apiBase = DEFAULT_API_BASE } = {}) {
    const baseUrl = normalizeBaseUrl(apiBase);
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/api/v1/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: id_token ?? "", ...(email ? { email } : {}) }),
      });
    } catch {
      throw errorWithCode(API_NETWORK, "Không kết nối được máy chủ. Kiểm tra mạng và địa chỉ API.");
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const detail = typeof err?.detail === "string" ? err.detail : null;
      throw errorWithCode(`http_${res.status}`, detail || "Không thể đăng nhập tài khoản mẫu.");
    }
    const data = await res.json();
    return writeTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      user: data.user,
      apiBase: baseUrl,
    });
  }

  return {
    readBaseUrl,
    readTokens,
    // Changing base URL signs out: tokens from the old origin are meaningless.
    async setBaseUrl(raw) {
      const baseUrl = normalizeBaseUrl(raw);
      const current = await readBaseUrl();
      await storage.local.set({ [API_BASE_KEY]: baseUrl });
      if (current !== baseUrl) await writeTokens(null);
      return baseUrl;
    },
    setTokens: writeTokens,
    clearTokens: () => writeTokens(null),
    async getStatus() {
      const tokens = await readTokens();
      if (!tokens?.accessToken) return { signedIn: false };
      return { signedIn: true, user: tokens.user ?? null, obtainedAt: tokens.obtainedAt ?? null };
    },
    get: (path, opts) => request("GET", path, undefined, opts),
    post: (path, body, opts) => request("POST", path, body, opts),
    patch: (path, body, opts) => request("PATCH", path, body, opts),
    delete: (path, opts) => request("DELETE", path, undefined, opts),
    loginWithPassword,
    loginWithGoogle,
  };
}

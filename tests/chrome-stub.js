/**
 * Minimal chrome stub for node --test harness.
 * Boots the real extension-companion/background.js under Node with a
 * fake `chrome` global + `fetch` stub. `__sent` outbox captures
 * tabs.sendMessage + notifications.create + fetch calls.
 */

export function makeChrome(options = {}) {
  const {
    localSeed = {},
    sessionSeed = {},
    tabsSeed = [],
    fetchImpl = null,
    scriptingResult = null,
  } = options;

  const localMap = new Map(Object.entries(localSeed));
  const sessionMap = new Map(Object.entries(sessionSeed));
  let tabList = tabsSeed.map((t) => ({ ...t }));
  const __sent = [];
  const listeners = {
    onMessage: null,
    onMessageExternal: null,
    onAlarm: null,
    onCommand: null,
    onClicked: null,
    onInputEntered: null,
    onInstalled: null,
  };

  const area = (map) => ({
    async get(keys) {
      const arr = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of arr) {
        if (map.has(k)) out[k] = structuredClone(map.get(k));
      }
      return out;
    },
    async set(values) {
      for (const [k, v] of Object.entries(values)) {
        map.set(k, structuredClone(v));
      }
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) map.delete(k);
    },
  });

  const recordFetch = (url, opts = {}) => {
    __sent.push({
      kind: "fetch",
      url: String(url),
      method: opts?.method ?? "GET",
      headers: opts?.headers,
      body: opts?.body,
    });
  };

  const defaultFetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {};
    },
  });

  const innerFetch = fetchImpl ?? defaultFetch;
  const fetchStub = async (url, opts = {}) => {
    recordFetch(url, opts);
    return innerFetch(url, opts);
  };

  const chrome = {
    runtime: {
      id: "test-companion",
      onMessage: {
        addListener(fn) {
          listeners.onMessage = fn;
        },
      },
      onMessageExternal: {
        addListener(fn) {
          listeners.onMessageExternal = fn;
        },
      },
      onInstalled: {
        addListener(fn) {
          listeners.onInstalled = fn;
        },
      },
    },
    storage: {
      local: area(localMap),
      session: area(sessionMap),
      onChanged: {
        addListener() {},
        removeListener() {},
      },
    },
    alarms: {
      onAlarm: {
        addListener(fn) {
          listeners.onAlarm = fn;
        },
      },
      get(name, cb) {
        if (typeof cb === "function") {
          cb(null);
          return;
        }
        return Promise.resolve(null);
      },
      async create(name, info) {
        __sent.push({ kind: "alarms.create", name, info: structuredClone(info ?? {}) });
      },
      async clear(name) {
        __sent.push({ kind: "alarms.clear", name });
        return true;
      },
    },
    tabs: {
      async query() {
        return structuredClone(tabList);
      },
      async sendMessage(tabId, message) {
        __sent.push({ kind: "tabs.sendMessage", tabId, message: structuredClone(message) });
        return {};
      },
    },
    scripting: {
      async executeScript() {
        return [{ result: scriptingResult }];
      },
    },
    notifications: {
      async create(payload) {
        __sent.push({ kind: "notification", ...structuredClone(payload ?? {}) });
        return "test-notification-id";
      },
    },
    contextMenus: {
      removeAll(cb) {
        if (typeof cb === "function") cb();
      },
      create() {
        return "test-menu-id";
      },
      onClicked: {
        addListener(fn) {
          listeners.onClicked = fn;
        },
      },
    },
    commands: {
      onCommand: {
        addListener(fn) {
          listeners.onCommand = fn;
        },
      },
    },
    omnibox: {
      setDefaultSuggestion() {},
      onInputEntered: {
        addListener(fn) {
          listeners.onInputEntered = fn;
        },
      },
    },
    action: {},
    sidePanel: {
      async setPanelBehavior() {},
      async open() {},
    },
  };

  function sendInternal(request, sender) {
    return new Promise((resolve) => {
      listeners.onMessage(request, sender ?? { id: "test-companion" }, resolve);
    });
  }

  function sendExternal(request, sender) {
    return new Promise((resolve) => {
      listeners.onMessageExternal(request, sender ?? {}, resolve);
    });
  }

  function setTabs(tabs) {
    tabList = tabs.map((t) => ({ ...t }));
  }

  return {
    chrome,
    listeners,
    localMap,
    sessionMap,
    __sent,
    fetchStub,
    sendInternal,
    sendExternal,
    setTabs,
  };
}

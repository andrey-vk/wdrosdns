// Minimal stubs so common.js can be exercised outside a browser extension.

const realFetch = globalThis.fetch;

// `handler` receives { url, method, body } and returns { status, body } or a
// thrown error to simulate a network failure.
export function stubFetch(handler) {
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    const call = {
      url,
      method: options.method || "GET",
      body: options.body ? JSON.parse(options.body) : null
    };
    calls.push(call);

    const res = await handler(call, calls);
    const status = res.status === undefined ? 200 : res.status;

    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (res.body === undefined ? "" : JSON.stringify(res.body))
    };
  };

  return calls;
}

export function restoreFetch() {
  globalThis.fetch = realFetch;
}

// In-memory chrome.storage areas, enough for loadSettings/saveSettings and the
// session-scoped DNS cache.
function storageArea(store) {
  return {
    async get(defaults) {
      if (defaults === null || defaults === undefined) return { ...store };
      const wanted = typeof defaults === "string"
        ? { [defaults]: undefined }
        : Array.isArray(defaults)
          ? Object.fromEntries(defaults.map(key => [key, undefined]))
          : defaults;
      const out = {};
      for (const [key, fallback] of Object.entries(wanted)) {
        out[key] = key in store ? store[key] : fallback;
      }
      return out;
    },
    async set(values) {
      Object.assign(store, values);
    },
    async remove(keys) {
      for (const key of [].concat(keys)) delete store[key];
    }
  };
}

export function stubChromeStorage(initial = {}, session = {}) {
  const local = { ...initial };
  const sessionStore = { ...session };

  globalThis.chrome = {
    storage: {
      local: storageArea(local),
      session: storageArea(sessionStore)
    }
  };

  return local;
}

export function profile(overrides = {}) {
  return {
    id: "p1",
    name: "Router",
    url: "https://192.168.88.1",
    login: "admin",
    password: "secret",
    expectedIdentity: "MikroTik",
    ...overrides
  };
}

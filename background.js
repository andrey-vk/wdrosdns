import {
  addDomainsUsingDetection,
  loadSettings,
  saveSettings,
  detectRouter,
  getIdentity,
  normalizeBaseUrl,
  makeId,
  hostnameFromUrl,
  trimToBaseDomain,
  filterNetworkEntries,
  normalizeDomainCollector,
  effectiveProfileSettings,
  fetchStaticDns,
  deleteStaticDns,
  readDnsCache,
  writeDnsCache,
  removeDnsCacheRecords,
  setDnsCacheDisabled,
  setStaticDnsDisabled,
  buildDnsIndex,
  dnsStatusForHost,
  DEFAULT_DOMAIN_COLLECTOR
} from "./common.js";

/* --- settings cache ---
   The webRequest listeners run on every single request, so they must not each
   trigger a storage read. Settings are cached in the worker and invalidated by
   chrome.storage.onChanged. */

let settingsPromise = null;
let collectorLimit = DEFAULT_DOMAIN_COLLECTOR.maxEntriesPerTab;

function cachedSettings() {
  if (!settingsPromise) {
    settingsPromise = loadSettings().then(settings => {
      collectorLimit = normalizeDomainCollector(settings.domainCollector).maxEntriesPerTab;
      return settings;
    }).catch(err => {
      settingsPromise = null;
      throw err;
    });
  }

  return settingsPromise;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  settingsPromise = null;
  cachedSettings().catch(() => {});
});

/* --- collector state ---
   MV3 terminates idle service workers, which would drop everything captured so
   far. The in-memory map stays the hot path; chrome.storage.session is a
   write-behind mirror that is read back when the worker restarts. */

const NET_PREFIX = "net:";
const FLUSH_DELAY_MS = 1000;

const networkByTab = new Map();
const dirtyTabs = new Set();
const clearedTabs = new Set();

let flushTimer = null;
let hydrated = false;

const hydration = hydrate().catch(() => { hydrated = true; });

function sessionKey(tabId) {
  return `${NET_PREFIX}${Number(tabId)}`;
}

async function hydrate() {
  const stored = await chrome.storage.session.get(null);

  for (const [key, value] of Object.entries(stored || {})) {
    if (!key.startsWith(NET_PREFIX)) continue;

    const tabId = Number(key.slice(NET_PREFIX.length));
    // A main_frame navigation that landed before hydration finished already
    // invalidated this tab; restoring it would resurrect the old page's hosts.
    if (clearedTabs.has(tabId) || !Array.isArray(value)) continue;

    const log = getTabLog(tabId);
    for (const entry of value) {
      if (entry && entry.requestId && !log.has(entry.requestId)) {
        log.set(entry.requestId, entry);
      }
    }
  }

  hydrated = true;
  clearedTabs.clear();
}

// Only meaningful until hydration finishes; afterwards nothing can be restored.
function markCleared(tabId) {
  if (!hydrated) clearedTabs.add(Number(tabId));
}

function getTabLog(tabId) {
  const key = Number(tabId);
  if (!networkByTab.has(key)) {
    networkByTab.set(key, new Map());
  }
  return networkByTab.get(key);
}

function markDirty(tabId) {
  dirtyTabs.add(Number(tabId));
  if (flushTimer) return;

  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush().catch(() => {});
  }, FLUSH_DELAY_MS);
}

// Batched so a request-heavy page writes once per second instead of per request.
async function flush() {
  if (!dirtyTabs.size) return;

  const tabs = Array.from(dirtyTabs);
  dirtyTabs.clear();

  const writes = {};
  const removals = [];

  for (const tabId of tabs) {
    const log = networkByTab.get(tabId);
    if (!log || !log.size) {
      removals.push(sessionKey(tabId));
    } else {
      writes[sessionKey(tabId)] = Array.from(log.values());
    }
  }

  if (removals.length) await chrome.storage.session.remove(removals);
  if (Object.keys(writes).length) await chrome.storage.session.set(writes);
}

function pruneTabLog(tabId, maxEntries) {
  const log = getTabLog(tabId);
  if (log.size <= maxEntries) return;

  const ordered = Array.from(log.values()).sort((a, b) => Number(a.startTime || 0) - Number(b.startTime || 0));
  const toDelete = ordered.slice(0, Math.max(0, ordered.length - maxEntries));
  for (const entry of toDelete) {
    log.delete(entry.requestId);
  }
}

// Only the fields the collector UI actually uses. The full URL is deliberately
// dropped: query strings routinely carry tokens and personal data, and nothing
// downstream needs more than the host.
function baseEntry(details) {
  const host = hostnameFromUrl(details.url);
  return {
    requestId: details.requestId,
    tabId: details.tabId,
    host,
    baseHost: trimToBaseDomain(host),
    method: details.method || "",
    type: details.type || "",
    startTime: Date.now(),
    responseStartedTime: null,
    completedTime: null,
    statusCode: null,
    statusLine: "",
    error: "",
    fromCache: false
  };
}

function ensureEntry(details) {
  const log = getTabLog(details.tabId);
  let entry = log.get(details.requestId);
  if (!entry) {
    entry = baseEntry(details);
    log.set(details.requestId, entry);
  }
  return entry;
}

function clearTabLog(tabId) {
  const key = Number(tabId);
  networkByTab.set(key, new Map());
  markCleared(key);
  markDirty(key);
}

function forgetTab(tabId) {
  const key = Number(tabId);
  networkByTab.delete(key);
  dirtyTabs.delete(key);
  markCleared(key);
  chrome.storage.session.remove(sessionKey(key)).catch(() => {});
}

function networkHostsForTab(tabId) {
  const log = networkByTab.get(Number(tabId));
  if (!log) return [];

  const hosts = [];
  for (const entry of log.values()) {
    if (entry.host) hosts.push(entry.host);
  }

  return Array.from(new Set(hosts));
}

chrome.webRequest.onBeforeRequest.addListener(
  details => {
    if (details.tabId < 0) return;

    if (details.type === "main_frame") {
      clearTabLog(details.tabId);
    }

    const log = getTabLog(details.tabId);
    log.set(details.requestId, baseEntry(details));

    pruneTabLog(details.tabId, collectorLimit);
    markDirty(details.tabId);
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onResponseStarted.addListener(
  details => {
    if (details.tabId < 0) return;
    const entry = ensureEntry(details);
    entry.responseStartedTime = Date.now();
    entry.statusCode = details.statusCode || entry.statusCode;
    entry.statusLine = details.statusLine || entry.statusLine || "";
    entry.fromCache = !!details.fromCache;
    markDirty(details.tabId);
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onCompleted.addListener(
  details => {
    if (details.tabId < 0) return;
    const entry = ensureEntry(details);
    entry.completedTime = Date.now();
    entry.statusCode = details.statusCode || entry.statusCode;
    entry.statusLine = details.statusLine || entry.statusLine || "";
    entry.fromCache = !!details.fromCache;
    markDirty(details.tabId);
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onErrorOccurred.addListener(
  details => {
    if (details.tabId < 0) return;
    const entry = ensureEntry(details);
    entry.completedTime = Date.now();
    entry.error = details.error || "unknown_error";
    markDirty(details.tabId);
  },
  { urls: ["<all_urls>"] }
);

chrome.tabs.onRemoved.addListener(forgetTab);

// Prime the caches as soon as the worker starts instead of on first use.
cachedSettings().catch(() => {});

/* --- toolbar badge ---
   Shows whether the current tab's host already has a static DNS entry on the
   active router. It is computed from the session cache only, so it costs no
   requests; the router is asked only by an explicit refresh or an add. */

const BADGE_STYLE = {
  exact: { text: "✓", color: "#2e7d32" },
  covered: { text: "✓", color: "#2e7d32" },
  disabled: { text: "!", color: "#b26a00" },
  absent: { text: "", color: "#8a8a8a" },
  unknown: { text: "?", color: "#5f6368" }
};

async function activeDnsIndex() {
  const settings = await cachedSettings();
  const cache = await readDnsCache(settings.lastProfileId);
  return cache ? buildDnsIndex(cache.records) : null;
}

async function paintTab(tab, index) {
  if (!tab || tab.id === undefined || !/^https?:/i.test(tab.url || "")) return;

  const host = hostnameFromUrl(tab.url);
  const state = index ? dnsStatusForHost(index, host).state : "unknown";
  const style = BADGE_STYLE[state];
  const stateLabel = chrome.i18n.getMessage(`dnsStatus${state[0].toUpperCase()}${state.slice(1)}`) || state;

  try {
    await Promise.all([
      chrome.action.setBadgeText({ tabId: tab.id, text: style.text }),
      chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: style.color }),
      chrome.action.setTitle({ tabId: tab.id, title: `${host}: ${stateLabel}` })
    ]);
  } catch {
    // The tab may have closed while the badge was being computed.
  }
}

async function paintBadges(tabId = null) {
  const index = await activeDnsIndex().catch(() => null);

  if (tabId !== null) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    await paintTab(tab, index);
    return;
  }

  for (const tab of await chrome.tabs.query({})) {
    await paintTab(tab, index);
  }
}

chrome.tabs.onActivated.addListener(({ tabId }) => { paintBadges(tabId).catch(() => {}); });

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url === undefined && changeInfo.status !== "complete") return;
  activeDnsIndex()
    .catch(() => null)
    .then(index => paintTab(tab, index))
    .catch(() => {});
});

chrome.storage.session.onChanged.addListener(changes => {
  if (Object.keys(changes).some(key => key.startsWith("dnsCache:"))) {
    paintBadges().catch(() => {});
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "lastProfileId" in changes) {
    paintBadges().catch(() => {});
  }
});

paintBadges().catch(() => {});

function profileById(settings, id) {
  return settings.profiles.find(p => p.id === id) || null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === "ADD_DOMAINS") {
        if (!hydrated) await hydration;

        const resolveCandidates = [
          ...(Array.isArray(message.resolveCandidates) ? message.resolveCandidates : []),
          ...(message.tabId !== undefined && message.tabId !== null ? networkHostsForTab(message.tabId) : [])
        ];

        const result = await addDomainsUsingDetection(message.domains || [], {
          preferredProfileId: message.preferredProfileId || null,
          resolveCandidates
        });
        sendResponse(result);
        return;
      }

      if (message.type === "GET_TAB_NETWORK") {
        if (!hydrated) await hydration;

        const settings = await cachedSettings();
        const tabId = Number(message.tabId);
        const includeAll = !!message.includeAll;
        const log = networkByTab.get(tabId) || new Map();
        const entries = Array.from(log.values())
          .filter(e => e.host)
          .sort((a, b) => Number(b.startTime || 0) - Number(a.startTime || 0));
        const filteredEntries = filterNetworkEntries(entries, settings.domainCollector, includeAll, Date.now());

        sendResponse({
          ok: true,
          tabId,
          includeAll,
          entries,
          filteredEntries,
          domainCollector: normalizeDomainCollector(settings.domainCollector)
        });
        return;
      }

      if (message.type === "CLEAR_TAB_NETWORK") {
        clearTabLog(Number(message.tabId));
        await flush();
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "GET_COLLECTOR_SETTINGS") {
        const settings = await cachedSettings();
        sendResponse({ ok: true, domainCollector: normalizeDomainCollector(settings.domainCollector) });
        return;
      }

      if (message.type === "DETECT_ROUTER") {
        const settings = await cachedSettings();
        const result = await detectRouter(settings, message.preferredProfileId || null);

        // A profile that actually answered is the one the badge and the DNS cache
        // should describe from now on, so it becomes the last used profile.
        const matched = result.status === "matched" || result.status === "matched_other_identity_profile";
        if (matched && result.profile && result.profile.id !== settings.lastProfileId) {
          await chrome.storage.local.set({ lastProfileId: result.profile.id });
        }

        sendResponse(result);
        return;
      }

      if (message.type === "REFRESH_STATIC_DNS") {
        const settings = await cachedSettings();
        const profile = profileById(settings, message.profileId || settings.lastProfileId);
        if (!profile) {
          sendResponse({ ok: false, error: "profile_not_found" });
          return;
        }

        const eff = effectiveProfileSettings(settings, profile);
        const list = await fetchStaticDns(profile, eff.requestTimeoutMs);
        if (!list.ok) {
          sendResponse({ ok: false, reason: "list_failed", profileId: profile.id, list });
          return;
        }

        const cache = await writeDnsCache(profile.id, list.records);
        sendResponse({ ok: true, profileId: profile.id, cache });
        return;
      }

      if (message.type === "SET_STATIC_DNS_DISABLED") {
        const settings = await cachedSettings();
        const profile = profileById(settings, message.profileId || settings.lastProfileId);
        if (!profile) {
          sendResponse({ ok: false, error: "profile_not_found" });
          return;
        }

        const disabled = !!message.disabled;
        const eff = effectiveProfileSettings(settings, profile);
        const changed = [];
        const failed = [];

        for (const id of Array.isArray(message.ids) ? message.ids : []) {
          const r = await setStaticDnsDisabled(profile, id, disabled, eff.requestTimeoutMs);
          if (r.ok) changed.push(String(id));
          else failed.push({ id: String(id), result: r });
        }

        if (changed.length) await setDnsCacheDisabled(profile.id, changed, disabled);
        sendResponse({ ok: failed.length === 0, profileId: profile.id, disabled, changed, failed });
        return;
      }

      if (message.type === "DELETE_STATIC_DNS") {
        const settings = await cachedSettings();
        const profile = profileById(settings, message.profileId || settings.lastProfileId);
        if (!profile) {
          sendResponse({ ok: false, error: "profile_not_found" });
          return;
        }

        const eff = effectiveProfileSettings(settings, profile);
        const deleted = [];
        const failed = [];

        for (const id of Array.isArray(message.ids) ? message.ids : []) {
          const r = await deleteStaticDns(profile, id, eff.requestTimeoutMs);
          if (r.ok) deleted.push(String(id));
          else failed.push({ id: String(id), result: r });
        }

        if (deleted.length) await removeDnsCacheRecords(profile.id, deleted);
        sendResponse({ ok: failed.length === 0, profileId: profile.id, deleted, failed });
        return;
      }

      if (message.type === "CREATE_PROFILE_FROM_DRAFT") {
        const settings = await loadSettings();
        const draft = message.draftProfile;
        const profile = {
          ...draft,
          id: draft.id || makeId(),
          url: normalizeBaseUrl(draft.url)
        };
        settings.profiles.push(profile);
        settings.lastProfileId = profile.id;
        settings.pendingProfileDraft = null;
        await saveSettings(settings);
        sendResponse({ ok: true, profile });
        return;
      }

      if (message.type === "UPDATE_PROFILE_IDENTITY") {
        const settings = await loadSettings();
        const profile = settings.profiles.find(p => p.id === message.profileId);
        if (!profile) {
          sendResponse({ ok: false, error: "profile_not_found" });
          return;
        }
        profile.expectedIdentity = message.identity;
        settings.lastProfileId = profile.id;
        await saveSettings(settings);
        sendResponse({ ok: true, profile });
        return;
      }

      if (message.type === "SAVE_PENDING_PROFILE_DRAFT") {
        const settings = await loadSettings();
        settings.pendingProfileDraft = message.draftProfile || null;
        await saveSettings(settings);
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "GET_IDENTITY_FOR_PROFILE") {
        const settings = await cachedSettings();
        const r = await getIdentity(message.profile, settings.requestTimeoutMs || 5000);
        sendResponse(r);
        return;
      }

      sendResponse({ ok: false, error: "unknown_message_type" });
    } catch (err) {
      sendResponse({ ok: false, error: String(err && err.message || err) });
    }
  })();

  return true;
});

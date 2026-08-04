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
  normalizeDomainCollector
} from "./common.js";

const networkByTab = new Map();

function getTabLog(tabId) {
  const key = Number(tabId);
  if (!networkByTab.has(key)) {
    networkByTab.set(key, new Map());
  }
  return networkByTab.get(key);
}

function pruneTabLog(tabId, maxEntries = 1000) {
  const log = getTabLog(tabId);
  if (log.size <= maxEntries) return;

  const ordered = Array.from(log.values()).sort((a, b) => Number(a.startTime || 0) - Number(b.startTime || 0));
  const toDelete = ordered.slice(0, Math.max(0, ordered.length - maxEntries));
  for (const entry of toDelete) {
    log.delete(entry.requestId);
  }
}

function baseEntry(details) {
  const host = hostnameFromUrl(details.url);
  return {
    requestId: details.requestId,
    tabId: details.tabId,
    url: details.url,
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
  networkByTab.set(Number(tabId), new Map());
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

    loadSettings()
      .then(settings => pruneTabLog(details.tabId, normalizeDomainCollector(settings.domainCollector).maxEntriesPerTab))
      .catch(() => pruneTabLog(details.tabId, 1000));
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
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onErrorOccurred.addListener(
  details => {
    if (details.tabId < 0) return;
    const entry = ensureEntry(details);
    entry.completedTime = Date.now();
    entry.error = details.error || "unknown_error";
  },
  { urls: ["<all_urls>"] }
);

chrome.tabs.onRemoved.addListener(tabId => {
  networkByTab.delete(Number(tabId));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === "ADD_DOMAINS") {
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
        const settings = await loadSettings();
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
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "DETECT_ROUTER") {
        const settings = await loadSettings();
        const result = await detectRouter(settings, message.preferredProfileId || null);
        sendResponse(result);
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
        const settings = await loadSettings();
        const r = await getIdentity(message.profile, settings.requestTimeoutMs || 5000);
        sendResponse(r);
        return;
      }

      sendResponse({ ok: false, error: "unknown_message_type" });
    } catch (err) {
      sendResponse({ ok: false, error: String(err && err.stack || err) });
    }
  })();

  return true;
});

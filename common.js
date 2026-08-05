import { isIpAddress, registrableDomain } from "./public-suffix.js";

export const DEFAULT_RECORD = {
  type: "FWD",
  address: "",
  forwardTo: "",
  addressList: "",
  comment: "added-by-edge-extension",
  matchSubdomain: true
};

export const DEFAULT_RESOLVE_SERVER = "127.0.0.1";

// null in an override means "inherit the global value", so a later change to the
// global settings still reaches the profile.
export const INHERITED_RECORD = Object.fromEntries(
  Object.keys(DEFAULT_RECORD).map(key => [key, null])
);

export const DEFAULT_PROFILE_OVERRIDES = {
  enabled: false,
  defaultTrimToBaseDomain: null,
  doResolveAfterAdd: null,
  resolveServer: null,
  requestTimeoutMs: null,
  record: { ...INHERITED_RECORD }
};

export const DEFAULT_DOMAIN_COLLECTOR = {
  pendingNoDataMs: 5000,
  maxEntriesPerTab: 1000,
  filters: [
    { id: "status_200_299", label: "HTTP 2xx", kind: "status", enabled: false, from: 200, to: 299, pattern: "" },
    { id: "status_300_399", label: "HTTP 3xx", kind: "status", enabled: false, from: 300, to: 399, pattern: "" },
    { id: "status_400_499", label: "HTTP 4xx", kind: "status", enabled: true, from: 400, to: 499, pattern: "" },
    { id: "status_500_599", label: "HTTP 5xx", kind: "status", enabled: true, from: 500, to: 599, pattern: "" },
    { id: "connection_refused", label: "Connection refused", kind: "error", enabled: true, from: null, to: null, pattern: "ERR_CONNECTION_REFUSED" },
    { id: "pending_no_data", label: "Pending без данных", kind: "pendingNoData", enabled: true, from: null, to: null, pattern: "" }
  ]
};

export const DEFAULT_SETTINGS = {
  profiles: [],
  lastProfileId: null,
  defaultTrimToBaseDomain: true,
  record: { ...DEFAULT_RECORD },
  doResolveAfterAdd: true,
  resolveServer: DEFAULT_RESOLVE_SERVER,
  requestTimeoutMs: 5000,
  pendingProfileDraft: null,
  domainCollector: { ...DEFAULT_DOMAIN_COLLECTOR }
};

export function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
}

export function normalizeBaseUrl(url) {
  if (!url) return "";
  let v = url.trim();
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  v = v.replace(/\/+$/, "");
  return v;
}

export function normalizeHost(host) {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/^\*\./, "")
    .replace(/\.$/, "");
}

export function hostnameFromUrl(url) {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return "";
  }
}

// Registrable domain according to the bundled Public Suffix List, so
// "a.b.example.co.uk" becomes "example.co.uk" and never bare "co.uk".
export function trimToBaseDomain(hostname) {
  return registrableDomain(normalizeHost(hostname));
}

// Underscores are allowed: they are not legal in host names but do occur in real
// DNS labels (and on internal networks), and RouterOS accepts them.
const DNS_LABEL = /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/;

export function isValidDomainName(hostname) {
  const host = String(hostname || "");
  if (!host || host.length > 253) return false;
  if (isIpAddress(host)) return true;

  return host
    .split(".")
    .every(label => label.length >= 1 && label.length <= 63 && DNS_LABEL.test(label));
}

// Accepts what a user may realistically paste — a hostname, "*.example.com", or
// a full URL — and returns a bare DNS name, or "" when the input cannot yield
// one. Everything that reaches RouterOS goes through here first.
export function domainFromInput(value) {
  let raw = String(value === null || value === undefined ? "" : value).trim();
  if (!raw) return "";

  // A wildcard is only meaningful as a leading "*."; RouterOS expresses it via
  // match-subdomain, so the marker itself is dropped.
  if (raw.startsWith("*.")) raw = raw.slice(2);
  if (raw.includes("*")) return "";

  // Bare IPv6 needs brackets before URL parsing accepts it.
  if (raw.includes(":") && /^[0-9a-f:]+$/i.test(raw)) raw = `[${raw}]`;

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  if (hasScheme && !/^https?:\/\//i.test(raw)) return "";

  let host;
  try {
    host = new URL(hasScheme ? raw : `http://${raw}`).hostname;
  } catch {
    return "";
  }

  host = normalizeHost(host.replace(/^\[|\]$/g, ""));
  return isValidDomainName(host) ? host : "";
}

// Splits user-supplied input into names safe to send and the raw entries that
// could not be understood, so the UI can report them instead of failing later.
export function partitionDomainInput(values) {
  const valid = [];
  const invalid = [];

  for (const value of values || []) {
    const raw = String(value === null || value === undefined ? "" : value).trim();
    if (!raw) continue;

    const domain = domainFromInput(raw);
    if (domain) {
      valid.push(domain);
    } else {
      invalid.push(raw);
    }
  }

  return { valid: uniqueDomains(valid), invalid: Array.from(new Set(invalid)) };
}

export function uniqueDomains(domains) {
  return Array.from(new Set(domains.map(normalizeHost).filter(Boolean)));
}

// Keeps a checkbox selection stable while the row list is rebuilt: a domain seen
// for the first time starts selected, and an explicit deselection survives
// re-renders caused by searching, filtering or reloading.
export function reconcileSelection(domains, selection, known) {
  for (const domain of domains || []) {
    if (!domain || known.has(domain)) continue;
    known.add(domain);
    selection.add(domain);
  }

  return selection;
}

export function normalizeCollectorFilter(filter) {
  const f = filter || {};
  const kind = ["status", "error", "pendingNoData"].includes(f.kind) ? f.kind : "status";

  return {
    id: f.id || makeId(),
    label: String(f.label || f.id || "Filter"),
    kind,
    enabled: !!f.enabled,
    from: f.from === null || f.from === undefined || f.from === "" ? null : Number(f.from),
    to: f.to === null || f.to === undefined || f.to === "" ? null : Number(f.to),
    pattern: String(f.pattern || "")
  };
}

export function normalizeDomainCollector(domainCollector) {
  const dc = domainCollector || {};
  const filters = Array.isArray(dc.filters) && dc.filters.length
    ? dc.filters.map(normalizeCollectorFilter)
    : DEFAULT_DOMAIN_COLLECTOR.filters.map(normalizeCollectorFilter);

  return {
    pendingNoDataMs: clampNumber(dc.pendingNoDataMs, 0, 600000, DEFAULT_DOMAIN_COLLECTOR.pendingNoDataMs),
    maxEntriesPerTab: clampNumber(dc.maxEntriesPerTab, 1, 100000, DEFAULT_DOMAIN_COLLECTOR.maxEntriesPerTab),
    filters
  };
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function activeCollectorFilters(domainCollector) {
  return normalizeDomainCollector(domainCollector).filters.filter(f => f.enabled);
}

export function networkEntryReasons(entry, domainCollector, now = Date.now()) {
  const dc = normalizeDomainCollector(domainCollector);
  const reasons = [];

  for (const filter of dc.filters.filter(f => f.enabled)) {
    if (filter.kind === "status") {
      const code = Number(entry.statusCode || 0);
      const from = filter.from === null ? -Infinity : Number(filter.from);
      const to = filter.to === null ? Infinity : Number(filter.to);
      if (code && code >= from && code <= to) {
        reasons.push({
          id: filter.id,
          label: filter.label,
          kind: filter.kind
        });
      }
      continue;
    }

    if (filter.kind === "error") {
      const err = String(entry.error || "");
      const pattern = String(filter.pattern || "").trim();
      if (err && (!pattern || err.includes(pattern))) {
        reasons.push({
          id: filter.id,
          label: filter.label,
          kind: filter.kind
        });
      }
      continue;
    }

    if (filter.kind === "pendingNoData") {
      const pendingMs = now - Number(entry.startTime || now);
      const noResponseStarted = !entry.responseStartedTime;
      const notFinished = !entry.completedTime && !entry.error;
      if (notFinished && noResponseStarted && pendingMs >= dc.pendingNoDataMs) {
        reasons.push({
          id: filter.id,
          label: filter.label,
          kind: filter.kind
        });
      }
    }
  }

  return reasons;
}

export function filterNetworkEntries(entries, domainCollector, includeAll = false, now = Date.now()) {
  const input = Array.isArray(entries) ? entries : [];

  return input
    .map(entry => ({
      ...entry,
      reasons: includeAll
        ? [{ id: "all", label: "Все", kind: "all" }]
        : networkEntryReasons(entry, domainCollector, now)
    }))
    .filter(entry => includeAll || entry.reasons.length > 0);
}

// Override records only carry the keys the extension knows about; a missing key
// becomes null so it keeps inheriting from the global record.
export function normalizeOverrideRecord(record) {
  const src = record || {};
  const out = {};

  for (const key of Object.keys(DEFAULT_RECORD)) {
    out[key] = src[key] === undefined ? null : src[key];
  }

  return out;
}

export function mergeRecordOverrides(globalRecord, overrideRecord) {
  const record = { ...DEFAULT_RECORD, ...(globalRecord || {}) };

  for (const [key, value] of Object.entries(overrideRecord || {})) {
    if (value === null || value === undefined) continue;
    record[key] = value;
  }

  return record;
}

export function normalizeProfile(profile) {
  const p = profile || {};
  const overrides = p.overrides || {};

  return {
    ...p,
    url: normalizeBaseUrl(p.url || ""),
    overrides: {
      ...DEFAULT_PROFILE_OVERRIDES,
      ...overrides,
      enabled: !!overrides.enabled,
      record: normalizeOverrideRecord(overrides.record)
    }
  };
}

export async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);

  const settings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    record: {
      ...DEFAULT_RECORD,
      ...(stored.record || {})
    },
    domainCollector: normalizeDomainCollector(stored.domainCollector),
    profiles: Array.isArray(stored.profiles)
      ? stored.profiles.map(normalizeProfile)
      : []
  };

  return settings;
}

export async function saveSettings(settings) {
  const normalized = {
    ...settings,
    record: {
      ...DEFAULT_RECORD,
      ...(settings.record || {})
    },
    domainCollector: normalizeDomainCollector(settings.domainCollector),
    profiles: Array.isArray(settings.profiles)
      ? settings.profiles.map(normalizeProfile)
      : []
  };

  await chrome.storage.local.set(normalized);
}

const SECRET_KEYS = new Set(["password", "authorization", "Authorization"]);

// Raw router responses are shown verbatim in the UI and they carry whole profile
// objects, so anything secret is masked before it reaches the DOM.
export function redactSecrets(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map(item => redactSecrets(item, seen));

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SECRET_KEYS.has(key)
      ? (item ? "***" : "")
      : redactSecrets(item, seen);
  }

  return out;
}

export function authHeader(login, password) {
  return "Basic " + btoa(`${login || ""}:${password || ""}`);
}

export function classifyFetchError(err) {
  if (err && err.name === "AbortError") return "timeout";
  return "network";
}

export function effectiveProfileSettings(globalSettings, profile) {
  const p = normalizeProfile(profile);
  const o = p.overrides || DEFAULT_PROFILE_OVERRIDES;

  if (!o.enabled) {
    return {
      record: {
        ...DEFAULT_RECORD,
        ...(globalSettings.record || {})
      },
      defaultTrimToBaseDomain: !!globalSettings.defaultTrimToBaseDomain,
      doResolveAfterAdd: !!globalSettings.doResolveAfterAdd,
      resolveServer: normalizeResolveServer(globalSettings.resolveServer),
      requestTimeoutMs: Number(globalSettings.requestTimeoutMs || 5000)
    };
  }

  return {
    record: mergeRecordOverrides(globalSettings.record, o.record),
    defaultTrimToBaseDomain:
      o.defaultTrimToBaseDomain === null || o.defaultTrimToBaseDomain === undefined
        ? !!globalSettings.defaultTrimToBaseDomain
        : !!o.defaultTrimToBaseDomain,
    doResolveAfterAdd:
      o.doResolveAfterAdd === null || o.doResolveAfterAdd === undefined
        ? !!globalSettings.doResolveAfterAdd
        : !!o.doResolveAfterAdd,
    resolveServer:
      o.resolveServer === null || o.resolveServer === undefined || String(o.resolveServer).trim() === ""
        ? normalizeResolveServer(globalSettings.resolveServer)
        : normalizeResolveServer(o.resolveServer),
    requestTimeoutMs:
      o.requestTimeoutMs === null || o.requestTimeoutMs === undefined || Number(o.requestTimeoutMs) <= 0
        ? Number(globalSettings.requestTimeoutMs || 5000)
        : Number(o.requestTimeoutMs)
  };
}

export async function routerFetch(profile, path, options = {}) {
  const timeoutMs = options.timeoutMs || 5000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  const url = normalizeBaseUrl(profile.url) + path;

  try {
    const res = await fetch(url, {
      ...options,
      signal: ctrl.signal,
      headers: {
        "Accept": "application/json",
        ...(options.body ? {"Content-Type": "application/json"} : {}),
        "Authorization": authHeader(profile.login, profile.password),
        ...(options.headers || {})
      }
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, kind: "auth", status: res.status, url };
    }

    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }

    if (!res.ok) {
      return { ok: false, kind: "http", status: res.status, data, url };
    }

    return { ok: true, status: res.status, data, url };
  } catch (err) {
    return { ok: false, kind: classifyFetchError(err), error: String(err), url };
  } finally {
    clearTimeout(timer);
  }
}

export async function getIdentity(profile, timeoutMs) {
  const r = await routerFetch(profile, "/rest/system/identity", {
    method: "GET",
    timeoutMs
  });

  if (!r.ok) return r;

  const name = r.data && typeof r.data === "object" ? r.data.name : null;
  if (!name) return { ok: false, kind: "bad_response", data: r.data };

  return { ok: true, identity: String(name), data: r.data };
}

export function sameEndpointAndCredentials(a, b) {
  return normalizeBaseUrl(a.url) === normalizeBaseUrl(b.url)
    && String(a.login || "") === String(b.login || "")
    && String(a.password || "") === String(b.password || "");
}

export function sameUrl(a, b) {
  return normalizeBaseUrl(a.url) === normalizeBaseUrl(b.url);
}

export function findProfileByExactIdentity(profiles, probeProfile, identity) {
  return profiles.find(p =>
    sameEndpointAndCredentials(p, probeProfile)
    && String(p.expectedIdentity || "") === String(identity || "")
  ) || null;
}

export async function detectRouter(settings, preferredProfileId = null) {
  const profiles = Array.isArray(settings.profiles) ? settings.profiles.map(normalizeProfile) : [];
  if (!profiles.length) {
    return { status: "no_profiles" };
  }

  const tried = new Set();

  const ordered = [];
  const lastId = preferredProfileId || settings.lastProfileId;
  if (lastId) {
    const p = profiles.find(x => x.id === lastId);
    if (p) ordered.push(p);
  }

  if (ordered[0]) {
    profiles
      .filter(p => p.id !== ordered[0].id && sameUrl(p, ordered[0]))
      .forEach(p => ordered.push(p));
  }

  profiles.forEach(p => {
    if (!ordered.some(x => x.id === p.id)) ordered.push(p);
  });

  const attempts = [];

  for (const profile of ordered) {
    if (!profile || tried.has(profile.id)) continue;
    tried.add(profile.id);

    const eff = effectiveProfileSettings(settings, profile);
    const identityResult = await getIdentity(profile, eff.requestTimeoutMs);

    attempts.push({
      profileId: profile.id,
      name: profile.name,
      url: profile.url,
      login: profile.login,
      ok: identityResult.ok,
      kind: identityResult.kind,
      identity: identityResult.identity,
      note: identityResult.ok
        ? "connected"
        : (identityResult.kind === "network" || identityResult.kind === "timeout"
            ? "ip_unreachable_continue_with_other_profiles"
            : "continue_with_other_profiles")
    });

    if (!identityResult.ok) {
      continue;
    }

    const actualIdentity = identityResult.identity;
    const expectedIdentity = String(profile.expectedIdentity || "");

    if (expectedIdentity && actualIdentity === expectedIdentity) {
      return {
        status: "matched",
        profile,
        identity: actualIdentity,
        attempts
      };
    }

    const existingExact = findProfileByExactIdentity(profiles, profile, actualIdentity);
    if (existingExact) {
      return {
        status: "matched_other_identity_profile",
        profile: existingExact,
        probedProfile: profile,
        identity: actualIdentity,
        attempts
      };
    }

    return {
      status: "identity_mismatch",
      profile,
      actualIdentity,
      expectedIdentity,
      draftProfile: {
        ...profile,
        id: makeId(),
        name: `${profile.name || profile.url} / ${actualIdentity}`,
        expectedIdentity: actualIdentity
      },
      attempts
    };
  }

  return {
    status: "not_found",
    attempts
  };
}

export function buildStaticDnsPayload(domain, recordSettings) {
  const record = {
    name: domain,
    type: recordSettings.type || "FWD",
    disabled: "no",
    // Always explicit: leaving it out would make an existing "yes" record look
    // equivalent to a request that asked for "no".
    "match-subdomain": recordSettings.matchSubdomain ? "yes" : "no"
  };

  if (recordSettings.comment) record.comment = recordSettings.comment;

  if (record.type === "A") {
    if (recordSettings.address) record.address = recordSettings.address;
  }

  if (record.type === "FWD") {
    if (recordSettings.forwardTo) record["forward-to"] = recordSettings.forwardTo;
  }

  if (recordSettings.addressList) {
    record["address-list"] = recordSettings.addressList;
  }

  return record;
}

// RouterOS reports booleans as "true"/"false" but accepts "yes"/"no", so the two
// spellings have to compare equal.
function boolish(value) {
  const v = String(value === null || value === undefined ? "" : value).trim().toLowerCase();
  if (v === "yes" || v === "true") return true;
  if (v === "no" || v === "false") return false;
  return null;
}

export function staticDnsFieldMatches(desired, actual) {
  const desiredBool = boolish(desired);
  const actualBool = boolish(actual);

  if (desiredBool !== null && actualBool !== null) return desiredBool === actualBool;

  return String(desired === null || desired === undefined ? "" : desired)
    === String(actual === null || actual === undefined ? "" : actual);
}

// True when the router already holds every field this payload would write.
// Fields the payload does not manage (an operator's own comment, for instance)
// are deliberately ignored.
export function staticDnsRecordMatches(payload, existing) {
  if (!existing || typeof existing !== "object") return false;

  return Object.entries(payload).every(([key, value]) => {
    if (key === "name") return normalizeHost(existing.name) === normalizeHost(value);
    return staticDnsFieldMatches(value, existing[key]);
  });
}

export function staticDnsRecordId(record) {
  return record && (record[".id"] || record.id) ? String(record[".id"] || record.id) : "";
}

export async function fetchStaticDns(profile, timeoutMs) {
  const r = await routerFetch(profile, "/rest/ip/dns/static", { method: "GET", timeoutMs });
  if (!r.ok) return r;

  return { ...r, records: Array.isArray(r.data) ? r.data : [] };
}

// Dynamic entries (DHCP leases, DoH, VPN) show up in the same menu but cannot be
// edited, so they are neither reused nor patched.
export function staticDnsRecordsForDomain(records, domain) {
  const name = normalizeHost(domain);

  return (records || []).filter(record =>
    record
    && normalizeHost(record.name) === name
    && String(record.dynamic || "false").toLowerCase() !== "true");
}

// Idempotent write: reuse an equivalent record, PATCH a stale one, and only PUT
// when the domain is genuinely absent. RouterOS PUT always creates, so calling
// it unconditionally is what produced duplicate static entries.
export async function ensureStaticDns(profile, domain, recordSettings, timeoutMs, existingRecords) {
  const payload = buildStaticDnsPayload(domain, recordSettings);
  const existing = staticDnsRecordsForDomain(existingRecords, domain);

  const equivalent = existing.find(record => staticDnsRecordMatches(payload, record));
  if (equivalent) {
    return {
      ok: true,
      action: "unchanged",
      record: equivalent,
      duplicates: Math.max(0, existing.length - 1)
    };
  }

  const sameType = existing.find(record =>
    staticDnsFieldMatches(payload.type, record.type || "A"));
  const target = sameType || existing[0];
  const targetId = staticDnsRecordId(target);

  if (target && targetId) {
    const r = await routerFetch(profile, `/rest/ip/dns/static/${encodeURIComponent(targetId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
      timeoutMs
    });
    return { ...r, action: r.ok ? "updated" : "", duplicates: Math.max(0, existing.length - 1) };
  }

  const r = await routerFetch(profile, "/rest/ip/dns/static", {
    method: "PUT",
    body: JSON.stringify(payload),
    timeoutMs
  });

  return { ...r, action: r.ok ? "created" : "", duplicates: 0 };
}

export function normalizeResolveServer(server) {
  const v = String(server === null || server === undefined ? "" : server).trim();
  if (!v) return DEFAULT_RESOLVE_SERVER;

  // Only a bare IPv4/IPv6/hostname is meaningful here; anything else could break
  // out of the RouterOS command line, so fall back to the default.
  if (!/^[A-Za-z0-9.:_-]+$/.test(v)) return DEFAULT_RESOLVE_SERVER;

  return v;
}

export function buildResolveScript(domain, server) {
  const name = String(domain).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `:resolve "${name}" server=${normalizeResolveServer(server)}`;
}

export async function resolveViaRouter(profile, domain, timeoutMs, server) {
  const script = buildResolveScript(domain, server);
  return await routerFetch(profile, "/rest/execute", {
    method: "POST",
    body: JSON.stringify({ script }),
    timeoutMs
  });
}


export function isSameOrSubdomain(candidate, domain) {
  const c = normalizeHost(candidate);
  const d = normalizeHost(domain);
  return !!c && !!d && (c === d || c.endsWith("." + d));
}

export function relatedResolveDomains(addedDomains, candidates) {
  const added = uniqueDomains(addedDomains);
  const pool = uniqueDomains(candidates || []);

  const related = [];
  for (const domain of added) {
    related.push(domain);

    for (const candidate of pool) {
      if (isSameOrSubdomain(candidate, domain)) {
        related.push(candidate);
      }
    }
  }

  return uniqueDomains(related);
}

export async function addDomainsUsingDetection(domains, options = {}) {
  const settings = await loadSettings();
  const detection = await detectRouter(settings, options.preferredProfileId || null);

  if (detection.status !== "matched" && detection.status !== "matched_other_identity_profile") {
    return { ok: false, detection };
  }

  const profile = normalizeProfile(detection.profile);
  const eff = effectiveProfileSettings(settings, profile);
  const { valid: unique, invalid: invalidDomains } = partitionDomainInput(domains);

  if (!unique.length) {
    return { ok: false, detection, profile, invalidDomains, reason: "no_valid_domains" };
  }

  // One listing for the whole batch: every add then knows whether it has to
  // create, update, or do nothing at all.
  const existing = await fetchStaticDns(profile, eff.requestTimeoutMs);
  if (!existing.ok) {
    return { ok: false, detection, profile, invalidDomains, reason: "list_failed", list: existing };
  }

  const records = existing.records.slice();

  const results = [];
  for (const domain of unique) {
    const add = await ensureStaticDns(profile, domain, eff.record, eff.requestTimeoutMs, records);

    // Keep the local view current so a repeat within the same batch is a no-op.
    if (add.ok && add.action === "created" && add.data && typeof add.data === "object") {
      records.push(add.data);
    }

    results.push({ domain, add });
  }

  const resolveResults = [];
  let resolveTargets = [];

  if (eff.doResolveAfterAdd) {
    if (eff.record && eff.record.matchSubdomain) {
      resolveTargets = relatedResolveDomains(unique, options.resolveCandidates || []);
    } else {
      resolveTargets = unique;
    }

    for (const domain of resolveTargets) {
      const resolve = await resolveViaRouter(profile, domain, eff.requestTimeoutMs, eff.resolveServer);
      resolveResults.push({ domain, resolve, server: eff.resolveServer });
    }
  }

  await chrome.storage.local.set({ lastProfileId: profile.id });

  return {
    ok: true,
    detection,
    profile,
    identity: detection.identity,
    effectiveSettings: eff,
    invalidDomains,
    results,
    resolveTargets,
    resolveResults,
    resultsLegacyNote: "Since v0.6.1, resolve results are returned in resolveResults."
  };
}

export function routerErrorText(r) {
  if (!r) return "no response";
  if (r.ok) return "";

  if (r.kind === "auth") return `auth ${r.status}`;
  if (r.kind === "timeout") return "timeout";
  if (r.kind === "network") return "network";
  if (r.kind === "bad_response") return "bad response";

  if (r.kind === "http") {
    const d = r.data;
    const message = d && typeof d === "object"
      ? (d.message || d.detail || d.error || "")
      : (typeof d === "string" ? d.slice(0, 160) : "");
    return message ? `${r.status} · ${message}` : `http ${r.status}`;
  }

  return r.kind || "error";
}

export function invalidDomainRows(result) {
  return ((result && result.invalidDomains) || []).map(domain => ({
    domain,
    added: false,
    action: "",
    duplicates: 0,
    invalid: true,
    addError: "",
    resolveState: "none",
    resolveError: "",
    resolveServer: ""
  }));
}

// Flattens an addDomainsUsingDetection() result into one row per domain so the
// UI never has to dig through nested REST responses.
export function addResultRows(result) {
  if (!result || !result.ok) return invalidDomainRows(result);

  const rows = invalidDomainRows(result);
  const byDomain = new Map();

  for (const item of result.results || []) {
    const row = {
      domain: item.domain,
      added: !!(item.add && item.add.ok),
      action: (item.add && item.add.action) || "",
      duplicates: Number((item.add && item.add.duplicates) || 0),
      addError: item.add && item.add.ok ? "" : routerErrorText(item.add),
      resolveState: "none",
      resolveError: "",
      resolveServer: ""
    };
    byDomain.set(item.domain, row);
    rows.push(row);
  }

  for (const item of result.resolveResults || []) {
    let row = byDomain.get(item.domain);

    if (!row) {
      // Related subdomain: resolved because of match-subdomain, never added.
      row = {
        domain: item.domain,
        added: null,
        action: "",
        duplicates: 0,
        addError: "",
        resolveState: "none",
        resolveError: "",
        resolveServer: ""
      };
      byDomain.set(item.domain, row);
      rows.push(row);
    }

    row.resolveState = item.resolve && item.resolve.ok ? "ok" : "fail";
    row.resolveError = item.resolve && item.resolve.ok ? "" : routerErrorText(item.resolve);
    row.resolveServer = item.server || "";
  }

  return rows;
}

export function addResultStats(result) {
  const rows = addResultRows(result);
  const added = rows.filter(r => r.added === true).length;
  const addTotal = rows.filter(r => r.added !== null).length;
  const duplicates = rows.reduce((sum, r) => sum + Number(r.duplicates || 0), 0);
  const resolved = rows.filter(r => r.resolveState === "ok").length;
  const resolveTotal = rows.filter(r => r.resolveState !== "none").length;
  const server = rows.find(r => r.resolveServer)?.resolveServer || "";

  return { rows, added, addTotal, resolved, resolveTotal, server, duplicates };
}

// i18n key describing why an add attempt never reached the router.
export function detectionFailureKey(result) {
  if (result && result.reason === "no_valid_domains") return "statusNoValidDomains";
  if (result && result.reason === "list_failed") return "statusListFailed";

  const d = result && result.detection;
  if (!d) return "statusAddFailed";
  if (d.status === "no_profiles") return "statusNoProfiles";
  if (d.status === "identity_mismatch") return "statusIdentityMismatch";
  return "statusNoRouter";
}

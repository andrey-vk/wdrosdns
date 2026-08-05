import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RECORD,
  buildStaticDnsPayload,
  staticDnsFieldMatches,
  staticDnsRecordMatches,
  staticDnsRecordsForDomain,
  ensureStaticDns,
  buildResolveScript,
  normalizeResolveServer,
  detectRouter,
  effectiveProfileSettings,
  normalizeProfile,
  routerErrorText,
  addResultStats,
  detectionFailureKey,
  redactSecrets
} from "../common.js";

import { stubFetch, restoreFetch, profile } from "./helpers.js";

test.afterEach(() => restoreFetch());

/* --- payload --- */

test("buildStaticDnsPayload always states match-subdomain explicitly", () => {
  const on = buildStaticDnsPayload("example.com", { ...DEFAULT_RECORD, forwardTo: "1.1.1.1" });
  assert.equal(on["match-subdomain"], "yes");
  assert.equal(on["forward-to"], "1.1.1.1");
  assert.equal(on.type, "FWD");
  assert.equal(on.disabled, "no");

  const off = buildStaticDnsPayload("example.com", { ...DEFAULT_RECORD, matchSubdomain: false });
  assert.equal(off["match-subdomain"], "no");
});

test("buildStaticDnsPayload only emits fields for the chosen type", () => {
  const a = buildStaticDnsPayload("example.com", {
    ...DEFAULT_RECORD,
    type: "A",
    address: "10.0.0.1",
    forwardTo: "1.1.1.1"
  });

  assert.equal(a.address, "10.0.0.1");
  assert.equal("forward-to" in a, false);
});

/* --- idempotency --- */

test("staticDnsFieldMatches treats yes/true and no/false as equal", () => {
  assert.equal(staticDnsFieldMatches("yes", "true"), true);
  assert.equal(staticDnsFieldMatches("no", "false"), true);
  assert.equal(staticDnsFieldMatches("yes", "false"), false);
  assert.equal(staticDnsFieldMatches("FWD", "FWD"), true);
  assert.equal(staticDnsFieldMatches("FWD", undefined), false);
});

test("staticDnsRecordMatches ignores fields the payload does not manage", () => {
  const payload = buildStaticDnsPayload("example.com", { ...DEFAULT_RECORD, forwardTo: "1.1.1.1", comment: "" });
  const existing = {
    ".id": "*1",
    name: "example.com",
    type: "FWD",
    "forward-to": "1.1.1.1",
    "match-subdomain": "true",
    disabled: "false",
    comment: "written by the operator",
    ttl: "1d"
  };

  assert.equal(staticDnsRecordMatches(payload, existing), true);
});

test("staticDnsRecordsForDomain normalizes names on both sides", () => {
  const records = [
    { name: "Example.com.", type: "FWD" },
    { name: "other.com", type: "FWD" }
  ];

  assert.equal(staticDnsRecordsForDomain(records, "example.com").length, 1);
});

test("staticDnsRecordsForDomain ignores dynamic entries", () => {
  const records = [
    { ".id": "*1", name: "example.com", type: "A", dynamic: "true" },
    { ".id": "*2", name: "example.com", type: "A", dynamic: "false" }
  ];

  assert.deepEqual(staticDnsRecordsForDomain(records, "example.com").map(r => r[".id"]), ["*2"]);
});

test("ensureStaticDns creates its own record rather than patching a dynamic one", async () => {
  const calls = stubFetch(() => ({ status: 201, body: {} }));

  const existing = [{
    ".id": "*1",
    name: "example.com",
    type: "FWD",
    "forward-to": "1.1.1.1",
    "match-subdomain": "true",
    disabled: "false",
    dynamic: "true"
  }];

  const r = await ensureStaticDns(profile(), "example.com", { ...DEFAULT_RECORD, forwardTo: "1.1.1.1" }, 1000, existing);

  assert.equal(r.action, "created");
  assert.equal(calls[0].method, "PUT");
});

test("ensureStaticDns creates a record when the domain is absent", async () => {
  const calls = stubFetch(() => ({ status: 201, body: { ".id": "*5", name: "example.com" } }));

  const r = await ensureStaticDns(profile(), "example.com", { ...DEFAULT_RECORD, forwardTo: "1.1.1.1" }, 1000, []);

  assert.equal(r.ok, true);
  assert.equal(r.action, "created");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].url, "https://192.168.88.1/rest/ip/dns/static");
});

test("ensureStaticDns does not re-add an identical record", async () => {
  const calls = stubFetch(() => ({ status: 200 }));

  const existing = [{
    ".id": "*1",
    name: "example.com",
    type: "FWD",
    "forward-to": "1.1.1.1",
    "match-subdomain": "true",
    disabled: "false",
    comment: "added-by-edge-extension"
  }];

  const r = await ensureStaticDns(profile(), "example.com", { ...DEFAULT_RECORD, forwardTo: "1.1.1.1" }, 1000, existing);

  assert.equal(r.ok, true);
  assert.equal(r.action, "unchanged");
  assert.equal(calls.length, 0, "an unchanged record must not issue any write");
});

test("ensureStaticDns patches a stale record instead of duplicating it", async () => {
  const calls = stubFetch(() => ({ status: 200, body: {} }));

  const existing = [{
    ".id": "*1",
    name: "example.com",
    type: "FWD",
    "forward-to": "9.9.9.9",
    "match-subdomain": "false",
    disabled: "false"
  }];

  const r = await ensureStaticDns(profile(), "example.com", { ...DEFAULT_RECORD, forwardTo: "1.1.1.1" }, 1000, existing);

  assert.equal(r.ok, true);
  assert.equal(r.action, "updated");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].url, "https://192.168.88.1/rest/ip/dns/static/*1");
  assert.equal(calls[0].body["forward-to"], "1.1.1.1");
  assert.equal(calls[0].body["match-subdomain"], "yes");
});

test("ensureStaticDns prefers a record of the same type and reports duplicates", async () => {
  const calls = stubFetch(() => ({ status: 200, body: {} }));

  const existing = [
    { ".id": "*1", name: "example.com", type: "A", address: "10.0.0.1" },
    { ".id": "*2", name: "example.com", type: "FWD", "forward-to": "9.9.9.9" }
  ];

  const r = await ensureStaticDns(profile(), "example.com", { ...DEFAULT_RECORD, forwardTo: "1.1.1.1" }, 1000, existing);

  assert.equal(r.action, "updated");
  assert.equal(r.duplicates, 1);
  assert.match(calls[0].url, /\*2$/);
});

test("ensureStaticDns reports a failed write instead of claiming success", async () => {
  stubFetch(() => ({ status: 400, body: { message: "no such item" } }));

  const r = await ensureStaticDns(profile(), "example.com", { ...DEFAULT_RECORD }, 1000, []);

  assert.equal(r.ok, false);
  assert.equal(r.action, "");
  assert.equal(routerErrorText(r), "400 · no such item");
});

/* --- resolve --- */

test("buildResolveScript escapes the domain and sanitizes the server", () => {
  assert.equal(buildResolveScript("example.com", "10.0.0.1"), ':resolve "example.com" server=10.0.0.1');
  assert.equal(buildResolveScript('a"b', "10.0.0.1"), ':resolve "a\\"b" server=10.0.0.1');
  assert.equal(buildResolveScript("a\\b", "10.0.0.1"), ':resolve "a\\\\b" server=10.0.0.1');
});

test("normalizeResolveServer refuses anything that could break out of the command", () => {
  assert.equal(normalizeResolveServer(""), "127.0.0.1");
  assert.equal(normalizeResolveServer(null), "127.0.0.1");
  assert.equal(normalizeResolveServer("8.8.8.8"), "8.8.8.8");
  assert.equal(normalizeResolveServer("2001:db8::1"), "2001:db8::1");
  assert.equal(normalizeResolveServer("1.1.1.1; /system reboot"), "127.0.0.1");
});

/* --- profile settings --- */

test("effectiveProfileSettings falls back to global values when overrides are off", () => {
  const global = {
    record: { ...DEFAULT_RECORD, forwardTo: "1.1.1.1" },
    defaultTrimToBaseDomain: true,
    doResolveAfterAdd: true,
    resolveServer: "10.0.0.1",
    requestTimeoutMs: 7000
  };

  const eff = effectiveProfileSettings(global, profile({ overrides: { enabled: false } }));

  assert.equal(eff.record.forwardTo, "1.1.1.1");
  assert.equal(eff.resolveServer, "10.0.0.1");
  assert.equal(eff.requestTimeoutMs, 7000);
});

test("null override fields keep inheriting later global changes", () => {
  const p = profile({
    overrides: {
      enabled: true,
      defaultTrimToBaseDomain: null,
      doResolveAfterAdd: false,
      resolveServer: null,
      requestTimeoutMs: null,
      record: { type: null, forwardTo: "2.2.2.2", address: null, addressList: null, comment: null, matchSubdomain: null }
    }
  });

  const eff = effectiveProfileSettings({
    record: { ...DEFAULT_RECORD, forwardTo: "1.1.1.1", comment: "global-comment", matchSubdomain: false },
    defaultTrimToBaseDomain: false,
    doResolveAfterAdd: true,
    resolveServer: "10.0.0.1",
    requestTimeoutMs: 7000
  }, p);

  // Overridden.
  assert.equal(eff.record.forwardTo, "2.2.2.2");
  assert.equal(eff.doResolveAfterAdd, false);

  // Inherited.
  assert.equal(eff.record.comment, "global-comment");
  assert.equal(eff.record.matchSubdomain, false);
  assert.equal(eff.defaultTrimToBaseDomain, false);
  assert.equal(eff.resolveServer, "10.0.0.1");
  assert.equal(eff.requestTimeoutMs, 7000);
});

test("normalizeProfile keeps unspecified override record fields inheritable", () => {
  const p = normalizeProfile({ url: "192.168.88.1", overrides: { enabled: true, record: { forwardTo: "2.2.2.2" } } });

  assert.equal(p.url, "https://192.168.88.1");
  assert.equal(p.overrides.record.forwardTo, "2.2.2.2");
  assert.equal(p.overrides.record.comment, null);
});

/* --- detection --- */

function identityHandler(byUrl) {
  return call => {
    const host = new URL(call.url).origin;
    const entry = byUrl[host];
    if (!entry) throw new Error("connection refused");
    if (entry.status) return { status: entry.status };
    return { status: 200, body: { name: entry.identity } };
  };
}

test("detectRouter reports no_profiles when nothing is configured", async () => {
  assert.deepEqual(await detectRouter({ profiles: [] }), { status: "no_profiles" });
});

test("detectRouter matches the profile whose identity is confirmed", async () => {
  stubFetch(identityHandler({ "https://192.168.88.1": { identity: "MikroTik" } }));

  const result = await detectRouter({
    profiles: [profile()],
    requestTimeoutMs: 1000
  });

  assert.equal(result.status, "matched");
  assert.equal(result.identity, "MikroTik");
  assert.equal(result.profile.id, "p1");
});

test("detectRouter switches to the profile that owns the identity actually found", async () => {
  stubFetch(identityHandler({ "https://192.168.88.1": { identity: "Home" } }));

  const office = profile({ id: "office", name: "Office", expectedIdentity: "Office" });
  const home = profile({ id: "home", name: "Home", expectedIdentity: "Home" });

  const result = await detectRouter({
    profiles: [office, home],
    lastProfileId: "office",
    requestTimeoutMs: 1000
  });

  assert.equal(result.status, "matched_other_identity_profile");
  assert.equal(result.profile.id, "home", "the operation must run against the matching profile");
  assert.equal(result.probedProfile.id, "office");
});

test("detectRouter offers a draft when the identity is unknown", async () => {
  stubFetch(identityHandler({ "https://192.168.88.1": { identity: "Somewhere-Else" } }));

  const result = await detectRouter({ profiles: [profile()], requestTimeoutMs: 1000 });

  assert.equal(result.status, "identity_mismatch");
  assert.equal(result.actualIdentity, "Somewhere-Else");
  assert.equal(result.draftProfile.expectedIdentity, "Somewhere-Else");
  assert.notEqual(result.draftProfile.id, "p1");
});

test("detectRouter keeps trying other profiles after an unreachable one", async () => {
  stubFetch(identityHandler({ "https://192.168.88.2": { identity: "Second" } }));

  const result = await detectRouter({
    profiles: [
      profile({ id: "a", url: "https://192.168.88.1", expectedIdentity: "First" }),
      profile({ id: "b", url: "https://192.168.88.2", expectedIdentity: "Second" })
    ],
    requestTimeoutMs: 1000
  });

  assert.equal(result.status, "matched");
  assert.equal(result.profile.id, "b");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].note, "ip_unreachable_continue_with_other_profiles");
});

test("detectRouter surfaces auth failures without matching", async () => {
  stubFetch(() => ({ status: 401 }));

  const result = await detectRouter({ profiles: [profile()], requestTimeoutMs: 1000 });

  assert.equal(result.status, "not_found");
  assert.equal(result.attempts[0].kind, "auth");
});

/* --- result shaping --- */

test("addResultStats separates created, updated and unchanged rows", () => {
  const stats = addResultStats({
    ok: true,
    results: [
      { domain: "a.com", add: { ok: true, action: "created" } },
      { domain: "b.com", add: { ok: true, action: "updated", duplicates: 2 } },
      { domain: "c.com", add: { ok: true, action: "unchanged" } },
      { domain: "d.com", add: { ok: false, kind: "timeout" } }
    ],
    resolveResults: [
      { domain: "a.com", resolve: { ok: true }, server: "10.0.0.1" },
      { domain: "cdn.a.com", resolve: { ok: false, kind: "timeout" }, server: "10.0.0.1" }
    ]
  });

  assert.equal(stats.added, 3);
  assert.equal(stats.addTotal, 4);
  assert.equal(stats.duplicates, 2);
  assert.equal(stats.resolved, 1);
  assert.equal(stats.resolveTotal, 2);
  assert.equal(stats.server, "10.0.0.1");

  const related = stats.rows.find(r => r.domain === "cdn.a.com");
  assert.equal(related.added, null, "a resolve-only subdomain is not an add attempt");
});

test("invalid input is reported as rows rather than silently dropped", () => {
  const stats = addResultStats({ ok: true, results: [], invalidDomains: ["exa mple.com"] });

  assert.equal(stats.rows.length, 1);
  assert.equal(stats.rows[0].invalid, true);
  assert.equal(stats.rows[0].domain, "exa mple.com");
});

test("detectionFailureKey explains why the add never reached the router", () => {
  assert.equal(detectionFailureKey({ reason: "no_valid_domains" }), "statusNoValidDomains");
  assert.equal(detectionFailureKey({ reason: "list_failed" }), "statusListFailed");
  assert.equal(detectionFailureKey({ detection: { status: "no_profiles" } }), "statusNoProfiles");
  assert.equal(detectionFailureKey({ detection: { status: "identity_mismatch" } }), "statusIdentityMismatch");
  assert.equal(detectionFailureKey({ detection: { status: "not_found" } }), "statusNoRouter");
  assert.equal(detectionFailureKey(null), "statusAddFailed");
});

test("redactSecrets masks passwords before a result reaches the DOM", () => {
  const raw = redactSecrets({
    profile: profile(),
    detection: { attempts: [{ login: "admin", password: "secret" }] },
    nested: [{ password: "" }]
  });

  assert.equal(raw.profile.password, "***");
  assert.equal(raw.profile.login, "admin");
  assert.equal(raw.detection.attempts[0].password, "***");
  assert.equal(raw.nested[0].password, "");
});

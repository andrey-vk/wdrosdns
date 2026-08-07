import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DOMAIN_COLLECTOR,
  DEFAULT_RECORD,
  normalizeCollectorFilter,
  normalizeDomainCollector,
  activeCollectorFilters,
  networkEntryReasons,
  filterNetworkEntries,
  reconcileSelection,
  addDomainsUsingDetection
} from "../common.js";

import { stubFetch, restoreFetch, stubChromeStorage, profile } from "./helpers.js";

test.afterEach(() => restoreFetch());

/* --- collector settings --- */

test("normalizeCollectorFilter fills in a usable shape", () => {
  const f = normalizeCollectorFilter({ id: "x", kind: "nonsense", from: "400", to: "", enabled: 1 });

  assert.equal(f.kind, "status");
  assert.equal(f.from, 400);
  assert.equal(f.to, null);
  assert.equal(f.enabled, true);
  assert.equal(f.label, "x");
});

test("normalizeDomainCollector clamps limits and restores default filters", () => {
  // Out-of-range values clamp to the nearest sane bound; only missing or
  // unparseable ones fall back to the default.
  assert.equal(normalizeDomainCollector({ maxEntriesPerTab: 0 }).maxEntriesPerTab, 1);
  assert.equal(normalizeDomainCollector({ maxEntriesPerTab: -5 }).maxEntriesPerTab, 1);
  assert.equal(normalizeDomainCollector({}).maxEntriesPerTab, DEFAULT_DOMAIN_COLLECTOR.maxEntriesPerTab);
  assert.equal(normalizeDomainCollector({ maxEntriesPerTab: 10 ** 9 }).maxEntriesPerTab, 100000);
  assert.equal(normalizeDomainCollector({ maxEntriesPerTab: "abc" }).maxEntriesPerTab, DEFAULT_DOMAIN_COLLECTOR.maxEntriesPerTab);
  assert.equal(normalizeDomainCollector({ pendingNoDataMs: -1 }).pendingNoDataMs, 0);

  assert.equal(normalizeDomainCollector({ filters: [] }).filters.length, DEFAULT_DOMAIN_COLLECTOR.filters.length);
  assert.equal(normalizeDomainCollector(null).filters.length, DEFAULT_DOMAIN_COLLECTOR.filters.length);
});

test("activeCollectorFilters returns only enabled filters", () => {
  const active = activeCollectorFilters({
    filters: [
      { id: "a", kind: "status", enabled: true, from: 400, to: 499 },
      { id: "b", kind: "status", enabled: false, from: 500, to: 599 }
    ]
  });

  assert.deepEqual(active.map(f => f.id), ["a"]);
});

/* --- filter evaluation --- */

const collector = {
  pendingNoDataMs: 5000,
  maxEntriesPerTab: 100,
  filters: [
    { id: "s4", label: "4xx", kind: "status", enabled: true, from: 400, to: 499, pattern: "" },
    { id: "s2", label: "2xx", kind: "status", enabled: false, from: 200, to: 299, pattern: "" },
    { id: "refused", label: "refused", kind: "error", enabled: true, from: null, to: null, pattern: "ERR_CONNECTION_REFUSED" },
    { id: "pending", label: "pending", kind: "pendingNoData", enabled: true, from: null, to: null, pattern: "" }
  ]
};

test("networkEntryReasons matches enabled status ranges only", () => {
  const now = 100000;
  const hit = networkEntryReasons({ statusCode: 404, startTime: now }, collector, now);
  assert.deepEqual(hit.map(r => r.id), ["s4"]);

  const miss = networkEntryReasons({ statusCode: 200, startTime: now, completedTime: now }, collector, now);
  assert.deepEqual(miss, []);
});

test("networkEntryReasons matches errors by substring", () => {
  const now = 100000;
  const hit = networkEntryReasons({ error: "net::ERR_CONNECTION_REFUSED", startTime: now }, collector, now);
  assert.deepEqual(hit.map(r => r.id), ["refused"]);

  const other = networkEntryReasons({ error: "net::ERR_ABORTED", startTime: now }, collector, now);
  assert.deepEqual(other, []);
});

test("networkEntryReasons only flags requests still pending without headers", () => {
  const now = 100000;

  const stuck = networkEntryReasons({ startTime: now - 6000 }, collector, now);
  assert.deepEqual(stuck.map(r => r.id), ["pending"]);

  const tooEarly = networkEntryReasons({ startTime: now - 1000 }, collector, now);
  assert.deepEqual(tooEarly, []);

  const gotHeaders = networkEntryReasons({ startTime: now - 6000, responseStartedTime: now - 5000 }, collector, now);
  assert.deepEqual(gotHeaders, []);

  const finished = networkEntryReasons({ startTime: now - 6000, completedTime: now - 5000 }, collector, now);
  assert.deepEqual(finished, []);
});

test("filterNetworkEntries drops non-matching entries unless includeAll is set", () => {
  const now = 100000;
  const entries = [
    { host: "bad.example.com", statusCode: 404, startTime: now, completedTime: now },
    { host: "good.example.com", statusCode: 200, startTime: now, completedTime: now }
  ];

  assert.deepEqual(filterNetworkEntries(entries, collector, false, now).map(e => e.host), ["bad.example.com"]);
  assert.equal(filterNetworkEntries(entries, collector, true, now).length, 2);
  assert.deepEqual(filterNetworkEntries(entries, collector, true, now)[0].reasons[0].kind, "all");
});

/* --- popup selection --- */

test("reconcileSelection selects newly seen domains", () => {
  const selection = new Set();
  const known = new Set();

  reconcileSelection(["a.com", "b.com"], selection, known);
  assert.deepEqual([...selection].sort(), ["a.com", "b.com"]);
});

test("reconcileSelection keeps an explicit deselection across re-renders", () => {
  const selection = new Set();
  const known = new Set();
  const rows = ["a.com", "b.com"];

  reconcileSelection(rows, selection, known);
  selection.delete("a.com");

  // Searching, filtering and re-collecting all rebuild the same rows.
  reconcileSelection(rows, selection, known);
  reconcileSelection(rows.filter(d => d === "b.com"), selection, known);
  reconcileSelection(rows, selection, known);

  assert.deepEqual([...selection], ["b.com"], "deselecting must survive a rebuild");
});

test("reconcileSelection still selects domains that appear later", () => {
  const selection = new Set();
  const known = new Set();

  reconcileSelection(["a.com"], selection, known);
  selection.delete("a.com");
  reconcileSelection(["a.com", "c.com"], selection, known);

  assert.deepEqual([...selection], ["c.com"]);
});

/* --- end-to-end add --- */

function routerHandler(state) {
  return call => {
    if (call.url.endsWith("/rest/system/identity")) {
      return { status: 200, body: { name: "MikroTik" } };
    }

    if (call.url.endsWith("/rest/ip/dns/static") && call.method === "GET") {
      return { status: 200, body: state.records };
    }

    if (call.url.endsWith("/rest/ip/dns/static") && call.method === "PUT") {
      const record = { ".id": `*${state.records.length + 1}`, ...call.body };
      state.records.push(record);
      return { status: 201, body: record };
    }

    if (call.url.includes("/rest/ip/dns/static/") && call.method === "PATCH") {
      const id = decodeURIComponent(call.url.split("/").pop());
      const record = state.records.find(r => r[".id"] === id);
      Object.assign(record, call.body);
      return { status: 200, body: record };
    }

    if (call.url.endsWith("/rest/execute")) {
      return { status: 200, body: [{ ret: "10.0.0.1" }] };
    }

    return { status: 404, body: { message: "no such command" } };
  };
}

test("adding the same domain twice does not create a duplicate record", async () => {
  stubChromeStorage({
    profiles: [profile()],
    lastProfileId: "p1",
    record: { ...DEFAULT_RECORD, forwardTo: "1.1.1.1" },
    doResolveAfterAdd: false
  });

  const state = { records: [] };
  stubFetch(routerHandler(state));

  const first = await addDomainsUsingDetection(["example.com"]);
  assert.equal(first.ok, true);
  assert.equal(first.results[0].add.action, "created");
  assert.equal(state.records.length, 1);

  const second = await addDomainsUsingDetection(["example.com"]);
  assert.equal(second.ok, true);
  assert.equal(second.results[0].add.action, "unchanged");
  assert.equal(state.records.length, 1, "a repeat add must not append another record");
});

test("changing the record settings updates the existing entry in place", async () => {
  stubChromeStorage({
    profiles: [profile()],
    lastProfileId: "p1",
    record: { ...DEFAULT_RECORD, forwardTo: "1.1.1.1" },
    doResolveAfterAdd: false
  });

  const state = { records: [] };
  stubFetch(routerHandler(state));

  await addDomainsUsingDetection(["example.com"]);

  stubChromeStorage({
    profiles: [profile()],
    lastProfileId: "p1",
    record: { ...DEFAULT_RECORD, forwardTo: "8.8.8.8" },
    doResolveAfterAdd: false
  });

  const result = await addDomainsUsingDetection(["example.com"]);

  assert.equal(result.results[0].add.action, "updated");
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0]["forward-to"], "8.8.8.8");
});

test("an add batch reads the static DNS list once, not once per domain", async () => {
  stubChromeStorage({
    profiles: [profile()],
    lastProfileId: "p1",
    record: { ...DEFAULT_RECORD, forwardTo: "1.1.1.1" },
    doResolveAfterAdd: false
  });

  const state = { records: [] };
  const calls = stubFetch(routerHandler(state));

  await addDomainsUsingDetection(["a.com", "b.com", "c.com"]);

  const lists = calls.filter(c => c.method === "GET" && c.url.endsWith("/rest/ip/dns/static"));
  assert.equal(lists.length, 1);
  assert.equal(state.records.length, 3);
});

test("invalid input is rejected before any router write", async () => {
  stubChromeStorage({ profiles: [profile()], lastProfileId: "p1", record: { ...DEFAULT_RECORD } });

  const state = { records: [] };
  const calls = stubFetch(routerHandler(state));

  const result = await addDomainsUsingDetection(["exa mple.com", "a.*.com"]);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_valid_domains");
  assert.deepEqual(result.invalidDomains, ["exa mple.com", "a.*.com"]);
  assert.equal(calls.some(c => c.method === "PUT" || c.method === "PATCH"), false);
});

test("a failed listing aborts the batch instead of blind-writing", async () => {
  stubChromeStorage({ profiles: [profile()], lastProfileId: "p1", record: { ...DEFAULT_RECORD } });

  const calls = stubFetch(call => {
    if (call.url.endsWith("/rest/system/identity")) return { status: 200, body: { name: "MikroTik" } };
    return { status: 500, body: { message: "boom" } };
  });

  const result = await addDomainsUsingDetection(["example.com"]);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "list_failed");
  assert.equal(calls.some(c => c.method === "PUT"), false);
});

test("match-subdomain resolves the added domain and the hosts it now covers", async () => {
  stubChromeStorage({
    profiles: [profile()],
    lastProfileId: "p1",
    record: { ...DEFAULT_RECORD, forwardTo: "1.1.1.1", matchSubdomain: true },
    doResolveAfterAdd: true,
    resolveServer: "10.0.0.1"
  });

  const state = { records: [] };
  stubFetch(routerHandler(state));

  const result = await addDomainsUsingDetection(["example.com"], {
    resolveCandidates: ["cdn.example.com", "unrelated.org"]
  });

  assert.deepEqual(result.resolveTargets, ["example.com", "cdn.example.com"]);
  assert.equal(result.resolveResults.length, 2);
});

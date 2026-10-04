import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RECORD,
  addDomainsUsingDetection,
  buildDnsIndex,
  deleteStaticDns,
  dnsStatusForHost,
  readDnsCache,
  removeDnsCacheRecords,
  slimStaticDnsRecord,
  writeDnsCache
} from "../common.js";

import { stubFetch, restoreFetch, stubChromeStorage, profile } from "./helpers.js";

test.afterEach(() => restoreFetch());

// Router-shaped records as RouterOS returns them: strings, not booleans.
function rec(overrides) {
  return {
    ".id": "*1",
    name: "example.com",
    type: "FWD",
    "forward-to": "1.1.1.1",
    "match-subdomain": "no",
    disabled: "false",
    dynamic: "false",
    comment: "",
    ...overrides
  };
}

function indexOf(...records) {
  return buildDnsIndex(records.map(slimStaticDnsRecord));
}

/* --- presence --- */

test("an enabled record with the exact name is exact", () => {
  const status = dnsStatusForHost(indexOf(rec({ name: "example.com" })), "Example.com.");
  assert.equal(status.state, "exact");
  assert.equal(status.records.length, 1);
});

test("a parent record with match-subdomain covers the subdomain", () => {
  const index = indexOf(rec({ ".id": "*2", name: "example.com", "match-subdomain": "yes" }));
  const status = dnsStatusForHost(index, "api.cdn.example.com");

  assert.equal(status.state, "covered");
  assert.equal(status.coveredBy.id, "*2");
});

test("a parent without match-subdomain does not cover its subdomains", () => {
  const index = indexOf(rec({ name: "example.com", "match-subdomain": "no" }));
  assert.equal(dnsStatusForHost(index, "api.example.com").state, "absent");
});

test("covering stops at label boundaries", () => {
  const index = indexOf(rec({ name: "ample.com", "match-subdomain": "yes" }));
  assert.equal(dnsStatusForHost(index, "example.com").state, "absent");
});

test("an exact enabled record wins over a covering parent", () => {
  const index = indexOf(
    rec({ ".id": "*1", name: "api.example.com" }),
    rec({ ".id": "*2", name: "example.com", "match-subdomain": "yes" })
  );
  assert.equal(dnsStatusForHost(index, "api.example.com").state, "exact");
});

test("only disabled records with the name give disabled", () => {
  const index = indexOf(rec({ name: "example.com", disabled: "true" }));
  const status = dnsStatusForHost(index, "example.com");

  assert.equal(status.state, "disabled");
  assert.equal(status.records.length, 1);
});

test("a disabled exact record does not hide an enabled covering parent", () => {
  const index = indexOf(
    rec({ ".id": "*1", name: "api.example.com", disabled: "true" }),
    rec({ ".id": "*2", name: "example.com", "match-subdomain": "yes" })
  );
  assert.equal(dnsStatusForHost(index, "api.example.com").state, "covered");
});

test("a disabled parent does not cover", () => {
  const index = indexOf(rec({ name: "example.com", "match-subdomain": "yes", disabled: "yes" }));
  assert.equal(dnsStatusForHost(index, "api.example.com").state, "absent");
});

test("dynamic entries are not static records and do not count as presence", () => {
  const index = indexOf(rec({ name: "example.com", dynamic: "true" }));
  assert.equal(dnsStatusForHost(index, "example.com").state, "absent");
});

test("an empty host is absent rather than an error", () => {
  assert.equal(dnsStatusForHost(indexOf(), "").state, "absent");
});

test("slimStaticDnsRecord turns router strings into booleans", () => {
  const slim = slimStaticDnsRecord(rec({ "match-subdomain": "true", disabled: "yes" }));

  assert.equal(slim.matchSubdomain, true);
  assert.equal(slim.disabled, true);
  assert.equal(slim.dynamic, false);
  assert.equal(slim.forwardTo, "1.1.1.1");
});

/* --- cache --- */

test("the cache round-trips and removes only the requested ids", async () => {
  const session = {};
  stubChromeStorage({}, session);

  await writeDnsCache("p1", [rec({ ".id": "*1" }), rec({ ".id": "*2", name: "b.com" })], 1000);

  const cache = await readDnsCache("p1");
  assert.equal(cache.fetchedAt, 1000);
  assert.equal(cache.records.length, 2);

  await removeDnsCacheRecords("p1", ["*1"]);
  const after = await readDnsCache("p1");
  assert.deepEqual(after.records.map(r => r.id), ["*2"]);
  assert.equal(after.fetchedAt, 1000);
});

test("caches are per profile", async () => {
  stubChromeStorage({}, {});

  await writeDnsCache("p1", [rec()]);
  assert.equal(await readDnsCache("p2"), null);
});

/* --- delete --- */

test("deleteStaticDns sends DELETE for the record id", async () => {
  const calls = stubFetch(() => ({ status: 204 }));

  const r = await deleteStaticDns(profile(), "*A1", 5000);

  assert.equal(r.ok, true);
  assert.equal(calls[0].method, "DELETE");
  assert.match(calls[0].url, /\/rest\/ip\/dns\/static\/\*A1$/);
});

test("a refused delete is reported, not thrown", async () => {
  stubFetch(() => ({ status: 500, body: { message: "failure" } }));

  const r = await deleteStaticDns(profile(), "*1", 5000);
  assert.equal(r.ok, false);
  assert.equal(r.kind, "http");
});

/* --- the add flow keeps the cache current --- */

test("an add writes the router's records into the cache", async () => {
  const session = {};
  stubChromeStorage({
    profiles: [profile()],
    lastProfileId: "p1",
    record: { ...DEFAULT_RECORD, forwardTo: "1.1.1.1" },
    doResolveAfterAdd: false
  }, session);

  const state = { records: [] };
  stubFetch(call => {
    if (call.url.endsWith("/rest/system/identity")) return { status: 200, body: { name: "MikroTik" } };
    if (call.url.endsWith("/rest/ip/dns/static") && call.method === "GET") return { status: 200, body: state.records };
    if (call.url.endsWith("/rest/ip/dns/static") && call.method === "PUT") {
      const record = { ".id": "*9", ...call.body };
      state.records.push(record);
      return { status: 201, body: record };
    }
    return { status: 404 };
  });

  await addDomainsUsingDetection(["example.com"]);

  const cache = await readDnsCache("p1");
  assert.deepEqual(cache.records.map(r => [r.id, r.name]), [["*9", "example.com"]]);
});

test("an update in the batch re-reads the list instead of trusting the PATCH reply", async () => {
  const session = {};
  stubChromeStorage({
    profiles: [profile()],
    lastProfileId: "p1",
    record: { ...DEFAULT_RECORD, forwardTo: "9.9.9.9" },
    doResolveAfterAdd: false
  }, session);

  const state = { records: [rec({ ".id": "*1", name: "example.com", "forward-to": "1.1.1.1" })] };
  let lists = 0;
  stubFetch(call => {
    if (call.url.endsWith("/rest/system/identity")) return { status: 200, body: { name: "MikroTik" } };
    if (call.url.endsWith("/rest/ip/dns/static") && call.method === "GET") {
      lists += 1;
      return { status: 200, body: state.records };
    }
    if (call.url.includes("/rest/ip/dns/static/") && call.method === "PATCH") {
      Object.assign(state.records[0], call.body);
      return { status: 200 };
    }
    return { status: 404 };
  });

  const result = await addDomainsUsingDetection(["example.com"]);
  assert.equal(result.results[0].add.action, "updated");
  assert.equal(lists, 2);

  const cache = await readDnsCache("p1");
  assert.equal(cache.records[0].forwardTo, "9.9.9.9");
});

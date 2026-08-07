import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeHost,
  hostnameFromUrl,
  trimToBaseDomain,
  isValidDomainName,
  domainFromInput,
  partitionDomainInput,
  uniqueDomains,
  isSameOrSubdomain,
  relatedResolveDomains
} from "../common.js";

import { publicSuffixOf, registrableDomain, isIpAddress } from "../public-suffix.js";

test("normalizeHost lowercases and strips wildcard and trailing dot", () => {
  assert.equal(normalizeHost("  Example.COM. "), "example.com");
  assert.equal(normalizeHost("*.Example.com"), "example.com");
  assert.equal(normalizeHost(null), "");
});

test("hostnameFromUrl extracts hosts and rejects junk", () => {
  assert.equal(hostnameFromUrl("https://Example.com/path?q=1"), "example.com");
  assert.equal(hostnameFromUrl("not a url"), "");
});

test("trimToBaseDomain handles multi-part public suffixes", () => {
  assert.equal(trimToBaseDomain("www.bbc.co.uk"), "bbc.co.uk");
  assert.equal(trimToBaseDomain("a.b.c.example.com.au"), "example.com.au");
  assert.equal(trimToBaseDomain("shop.example.co.jp"), "example.co.jp");
  assert.equal(trimToBaseDomain("deep.sub.example.com"), "example.com");
});

test("trimToBaseDomain keeps private suffixes the old hard-coded list missed", () => {
  assert.equal(trimToBaseDomain("pages.user.github.io"), "user.github.io");
  assert.equal(trimToBaseDomain("app.herokuapp.com"), "app.herokuapp.com");
  assert.equal(trimToBaseDomain("x.y.s3.amazonaws.com"), "y.s3.amazonaws.com");
});

test("trimToBaseDomain never reduces a host to a bare public suffix", () => {
  assert.equal(trimToBaseDomain("co.uk"), "co.uk");
  assert.equal(trimToBaseDomain("github.io"), "github.io");
  assert.equal(trimToBaseDomain("com"), "com");
});

test("trimToBaseDomain leaves IPs and single labels alone", () => {
  assert.equal(trimToBaseDomain("192.168.88.1"), "192.168.88.1");
  assert.equal(trimToBaseDomain("2001:db8::1"), "2001:db8::1");
  assert.equal(trimToBaseDomain("localhost"), "localhost");
  assert.equal(trimToBaseDomain(""), "");
});

test("trimToBaseDomain works on punycoded IDN hosts", () => {
  // xn--e1afmkfd = пример, xn--p1ai = рф
  assert.equal(trimToBaseDomain("www.xn--e1afmkfd.xn--p1ai"), "xn--e1afmkfd.xn--p1ai");
  assert.equal(trimToBaseDomain("xn--p1ai"), "xn--p1ai");
});

test("public suffix rules honour wildcards and exceptions", () => {
  // "*.kawasaki.jp" with the exception "!city.kawasaki.jp".
  assert.equal(publicSuffixOf("www.something.kawasaki.jp"), "something.kawasaki.jp");
  assert.equal(registrableDomain("www.something.kawasaki.jp"), "www.something.kawasaki.jp");
  assert.equal(publicSuffixOf("www.city.kawasaki.jp"), "kawasaki.jp");
  assert.equal(registrableDomain("www.city.kawasaki.jp"), "city.kawasaki.jp");
});

test("unlisted TLDs fall back to the implicit wildcard rule", () => {
  assert.equal(registrableDomain("host.example.invalidtld"), "example.invalidtld");
});

test("isIpAddress rejects out-of-range IPv4", () => {
  assert.equal(isIpAddress("10.0.0.1"), true);
  assert.equal(isIpAddress("999.1.1.1"), false);
  assert.equal(isIpAddress("::1"), true);
});

test("isValidDomainName rejects malformed labels", () => {
  assert.equal(isValidDomainName("example.com"), true);
  assert.equal(isValidDomainName("xn--e1afmkfd.xn--p1ai"), true);
  assert.equal(isValidDomainName("localhost"), true);
  assert.equal(isValidDomainName("_dmarc.example.com"), true);
  assert.equal(isValidDomainName("my_service.corp.local"), true);
  assert.equal(isValidDomainName("-bad.example.com"), false);
  assert.equal(isValidDomainName("bad-.example.com"), false);
  assert.equal(isValidDomainName("exa mple.com"), false);
  assert.equal(isValidDomainName("a..b.com"), false);
  assert.equal(isValidDomainName(`${"a".repeat(64)}.com`), false);
});

test("domainFromInput accepts hostnames, wildcards and URLs", () => {
  assert.equal(domainFromInput("Example.COM"), "example.com");
  assert.equal(domainFromInput("*.example.com"), "example.com");
  assert.equal(domainFromInput("https://example.com/path?token=abc#x"), "example.com");
  assert.equal(domainFromInput("http://example.com:8443/"), "example.com");
  assert.equal(domainFromInput("example.com."), "example.com");
  assert.equal(domainFromInput("  example.com  "), "example.com");
});

test("domainFromInput punycodes IDN input", () => {
  assert.equal(domainFromInput("пример.рф"), "xn--e1afmkfd.xn--p1ai");
  assert.equal(domainFromInput("https://пример.рф/путь"), "xn--e1afmkfd.xn--p1ai");
});

test("domainFromInput keeps IP literals", () => {
  assert.equal(domainFromInput("192.168.88.1"), "192.168.88.1");
  assert.equal(domainFromInput("::1"), "::1");
  assert.equal(domainFromInput("[2001:db8::1]"), "2001:db8::1");
});

test("domainFromInput rejects what RouterOS could not use", () => {
  for (const bad of [
    "",
    "   ",
    "exa mple.com",
    "a.*.example.com",
    "**.example.com",
    "*",
    "ftp://example.com",
    "javascript:alert(1)",
    "-example.com",
    "http://",
    "example .com"
  ]) {
    assert.equal(domainFromInput(bad), "", `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test("partitionDomainInput separates and de-duplicates", () => {
  const { valid, invalid } = partitionDomainInput([
    "https://example.com/a",
    "example.com",
    "  ",
    "exa mple.com",
    "*.sub.example.org"
  ]);

  assert.deepEqual(valid, ["example.com", "sub.example.org"]);
  assert.deepEqual(invalid, ["exa mple.com"]);
});

test("uniqueDomains normalizes and de-duplicates", () => {
  assert.deepEqual(uniqueDomains(["A.com", "a.com.", "*.a.com", "b.com"]), ["a.com", "b.com"]);
});

test("isSameOrSubdomain only matches real subdomains", () => {
  assert.equal(isSameOrSubdomain("a.example.com", "example.com"), true);
  assert.equal(isSameOrSubdomain("example.com", "example.com"), true);
  assert.equal(isSameOrSubdomain("notexample.com", "example.com"), false);
  assert.equal(isSameOrSubdomain("", "example.com"), false);
});

test("relatedResolveDomains collects added domains plus their subdomains", () => {
  const related = relatedResolveDomains(
    ["example.com"],
    ["cdn.example.com", "example.com", "other.org", "notexample.com"]
  );

  assert.deepEqual(related, ["example.com", "cdn.example.com"]);
});

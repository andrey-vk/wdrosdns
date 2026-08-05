// Validates the extension source (or an unpacked build) against manifest.json.
//
//   node scripts/validate-manifest.mjs
//   node scripts/validate-manifest.mjs --root dist/wdrosdns --tag v0.7.0

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { collectFiles } from "./collect-files.mjs";

function fail(message) {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
}

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

const EXTENSION_VERSION = /^\d+(\.\d+){0,3}$/;

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function main() {
  const root = argValue("--root") || ".";
  const tag = argValue("--tag");
  const rel = p => path.join(root, p);

  let manifest;
  try {
    manifest = await readJson(rel("manifest.json"));
  } catch (err) {
    fail(`manifest.json is not valid JSON: ${err.message}`);
    return;
  }

  if (manifest.manifest_version !== 3) {
    fail("manifest_version must be 3");
  }

  for (const key of ["name", "version", "description"]) {
    if (!manifest[key]) fail(`manifest.json is missing "${key}"`);
  }

  if (manifest.version && !EXTENSION_VERSION.test(manifest.version)) {
    fail(`manifest version "${manifest.version}" is not a valid extension version`);
  }

  // A packaged MV3 extension must be able to start, so every entry point the
  // manifest names has to exist in the tree being validated.
  const entryPoints = [
    manifest.options_page,
    manifest.devtools_page,
    manifest.action && manifest.action.default_popup,
    manifest.background && manifest.background.service_worker
  ].filter(Boolean);

  for (const entry of entryPoints) {
    if (!existsSync(rel(entry))) fail(`manifest entry point not found: ${entry}`);
  }

  if (manifest.background && manifest.background.service_worker && manifest.background.type !== "module") {
    fail('background.type must be "module" for the ES-module service worker');
  }

  const icons = { ...(manifest.icons || {}), ...((manifest.action && manifest.action.default_icon) || {}) };
  for (const [size, iconPath] of Object.entries(icons)) {
    if (!existsSync(rel(iconPath))) fail(`icon for size ${size} not found: ${iconPath}`);
  }

  if (manifest.default_locale && !existsSync(rel(`_locales/${manifest.default_locale}`))) {
    fail(`default_locale "${manifest.default_locale}" has no _locales entry`);
  }

  const localeKeys = new Map();

  if (existsSync(rel("_locales"))) {
    for (const locale of await readdir(rel("_locales"))) {
      const messagesPath = rel(`_locales/${locale}/messages.json`);
      if (!existsSync(messagesPath)) continue;
      try {
        localeKeys.set(locale, Object.keys(await readJson(messagesPath)));
      } catch (err) {
        fail(`_locales/${locale}/messages.json is not valid JSON: ${err.message}`);
      }
    }
  }

  // A key present in one locale but missing from another surfaces as a raw key
  // in the UI, which only shows up at runtime otherwise.
  const base = manifest.default_locale && localeKeys.get(manifest.default_locale);
  if (base) {
    for (const [locale, keys] of localeKeys) {
      if (locale === manifest.default_locale) continue;
      const missing = base.filter(key => !keys.includes(key));
      const extra = keys.filter(key => !base.includes(key));
      if (missing.length) fail(`_locales/${locale} is missing: ${missing.join(", ")}`);
      if (extra.length) fail(`_locales/${locale} has keys absent from ${manifest.default_locale}: ${extra.join(", ")}`);
    }
  }

  // Everything reachable from the manifest must be present in the tree.
  const { missing } = await collectFiles(root);
  for (const file of missing) fail(`referenced but missing from ${root}: ${file}`);

  // Versions must agree all the way through: git tag → manifest → package.json.
  if (existsSync(rel("package.json"))) {
    const pkg = await readJson(rel("package.json"));
    if (pkg.version !== manifest.version) {
      fail(`package.json version ${pkg.version} does not match manifest.json ${manifest.version}`);
    }
  }

  if (tag) {
    const tagVersion = tag.replace(/^v/, "");
    if (tagVersion !== manifest.version) {
      fail(`git tag ${tag} does not match manifest.json version ${manifest.version}`);
    }
  }

  if (process.exitCode) {
    console.error("Manifest validation failed.");
  } else {
    console.log(`✓ ${root}: manifest, entry points, locales and versions look valid.`);
  }
}

main();

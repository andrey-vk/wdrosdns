// Prints every file the packaged extension needs, one per line, derived from
// manifest.json and the HTML/JS reference graph. The release workflow packages
// exactly this list instead of a hand-maintained `cp` line that silently goes
// stale when a file is added.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const HTML_REF = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
const JS_IMPORT = /\bfrom\s*["'](\.[^"']+)["']|\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g;
const ASSET_STRING = /["']([\w./-]+\.(?:html|js|css|png|svg|json))["']/g;

function isLocal(ref) {
  return ref && !/^([a-z]+:)?\/\//i.test(ref) && !ref.startsWith("data:") && !ref.startsWith("#");
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

async function references(file) {
  const dir = path.dirname(file);
  const refs = [];

  if (file.endsWith(".html")) {
    const text = await readFile(file, "utf8");
    for (const m of text.matchAll(HTML_REF)) {
      if (isLocal(m[1])) refs.push(path.normalize(path.join(dir, m[1].split(/[?#]/)[0])));
    }
    return refs;
  }

  if (file.endsWith(".js")) {
    const text = await readFile(file, "utf8");
    for (const m of text.matchAll(JS_IMPORT)) {
      const ref = m[1] || m[2];
      if (isLocal(ref)) refs.push(path.normalize(path.join(dir, ref)));
    }

    // Extension APIs take plain paths too, e.g. devtools.panels.create(...,
    // "devtools-panel.html", ...). Only strings that resolve to a real file are
    // treated as references.
    for (const m of text.matchAll(ASSET_STRING)) {
      const candidate = path.normalize(path.join(dir, m[1]));
      if (isLocal(m[1]) && existsSync(candidate)) refs.push(candidate);
    }
  }

  return refs;
}

export async function collectFiles(root = ".") {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));

  const seeds = ["manifest.json"];
  const push = value => { if (value) seeds.push(value); };

  push(manifest.options_page);
  push(manifest.devtools_page);
  push(manifest.action && manifest.action.default_popup);
  push(manifest.background && manifest.background.service_worker);

  for (const icon of Object.values(manifest.icons || {})) push(icon);
  for (const icon of Object.values((manifest.action && manifest.action.default_icon) || {})) push(icon);
  for (const script of manifest.content_scripts || []) {
    for (const js of script.js || []) push(js);
    for (const css of script.css || []) push(css);
  }

  // Locales are data, not references: ship every messages.json there is.
  if (existsSync(path.join(root, "_locales"))) {
    for (const file of walk(path.join(root, "_locales"))) {
      seeds.push(path.relative(root, file));
    }
  }

  const seen = new Set();
  const queue = seeds.slice();
  const missing = [];

  while (queue.length) {
    const rel = path.normalize(queue.shift());
    if (seen.has(rel) || rel.startsWith("..")) continue;

    const full = path.join(root, rel);
    if (!existsSync(full)) {
      missing.push(rel);
      continue;
    }

    seen.add(rel);
    // references() already returns paths rooted at `root`.
    for (const ref of await references(full)) {
      queue.push(path.relative(root, ref));
    }
  }

  return { files: Array.from(seen).sort(), missing: Array.from(new Set(missing)).sort() };
}

// Checks that the release workflow actually packages everything the manifest
// reaches. A hand-maintained `cp` list goes stale the moment a module is added,
// and the result is a ZIP that fails to load with no build-time signal at all.
//
// Returns { derived: true } when the workflow delegates to the build script, in
// which case there is no list to go stale.
export function workflowPackagingGaps(workflowText, files) {
  const text = String(workflowText || "");

  if (/npm run build|build-package\.mjs/.test(text)) return { derived: true, missing: [] };

  // Fold shell line continuations so a wrapped `cp` reads as one command.
  const joined = text.replace(/\\\r?\n/g, " ");
  const copied = new Set();

  for (const line of joined.split(/\r?\n/)) {
    const match = line.match(/^\s*cp\s+(.*)$/);
    if (!match) continue;

    const args = match[1].split(/\s+/).filter(arg => arg && !arg.startsWith("-"));
    args.pop(); // destination
    for (const arg of args) copied.add(arg.replace(/\/+$/, ""));
  }

  if (!copied.size) return { derived: false, unknown: true, missing: [] };

  const missing = files.filter(file =>
    !copied.has(file) && !Array.from(copied).some(dir => file.startsWith(`${dir}/`)));

  return { derived: false, missing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] || ".";
  const { files, missing } = await collectFiles(root);

  if (missing.length) {
    console.error(`✗ referenced but missing: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log(files.join("\n"));
}

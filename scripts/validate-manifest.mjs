import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";

function fail(message) {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
}

async function main() {
  const manifestRaw = await readFile("manifest.json", "utf8");
  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
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

  for (const [size, path] of Object.entries(manifest.icons || {})) {
    if (!existsSync(path)) fail(`icon for size ${size} not found: ${path}`);
  }

  if (manifest.default_locale) {
    const localeDir = `_locales/${manifest.default_locale}`;
    if (!existsSync(localeDir)) {
      fail(`default_locale "${manifest.default_locale}" has no _locales entry`);
    }
  }

  if (existsSync("_locales")) {
    for (const locale of await readdir("_locales")) {
      const messagesPath = `_locales/${locale}/messages.json`;
      if (!existsSync(messagesPath)) continue;
      try {
        JSON.parse(await readFile(messagesPath, "utf8"));
      } catch (err) {
        fail(`${messagesPath} is not valid JSON: ${err.message}`);
      }
    }
  }

  if (process.exitCode) {
    console.error("Manifest validation failed.");
  } else {
    console.log("✓ manifest.json and locale files look valid.");
  }
}

main();

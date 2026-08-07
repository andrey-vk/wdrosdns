// Validates the produced ZIP rather than the source tree: unpacks it and checks
// that what a browser would actually load is a complete, consistent MV3
// extension.
//
//   node scripts/validate-package.mjs wdrosdns-v0.7.0.zip [--tag v0.7.0]

import { execFileSync } from "node:child_process";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectFiles } from "./collect-files.mjs";

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

const zip = process.argv[2];

if (!zip || !existsSync(zip)) {
  console.error(`✗ usage: node scripts/validate-package.mjs <zip> [--tag vX.Y.Z]`);
  process.exit(1);
}

const work = await mkdtemp(path.join(tmpdir(), "wdrosdns-pkg-"));

try {
  execFileSync("unzip", ["-q", zip, "-d", work], { stdio: "inherit" });

  // The archive holds a single top-level directory: the unpacked extension.
  const entries = await readdir(work);
  const roots = entries.filter(name => existsSync(path.join(work, name, "manifest.json")));

  if (roots.length !== 1) {
    console.error(`✗ expected exactly one extension directory in ${zip}, found ${roots.length}`);
    process.exit(1);
  }

  const root = path.join(work, roots[0]);

  // Nothing the extension references may be missing from the archive, and
  // nothing unrelated should have been swept into it.
  const packaged = await collectFiles(root);
  const source = await collectFiles(".");

  const missingFromZip = source.files.filter(file => !existsSync(path.join(root, file)));
  if (missingFromZip.length) {
    console.error(`✗ missing from ${zip}: ${missingFromZip.join(", ")}`);
    process.exit(1);
  }

  if (packaged.missing.length) {
    console.error(`✗ broken references inside ${zip}: ${packaged.missing.join(", ")}`);
    process.exit(1);
  }

  const tag = argValue("--tag");
  const args = ["scripts/validate-manifest.mjs", "--root", root];
  if (tag) args.push("--tag", tag);

  try {
    execFileSync(process.execPath, args, { stdio: "inherit" });
  } catch {
    console.error(`✗ ${zip}: manifest validation failed`);
    process.exit(1);
  }

  console.log(`✓ ${zip}: loadable MV3 extension with ${source.files.length} files`);
} finally {
  await rm(work, { recursive: true, force: true });
}

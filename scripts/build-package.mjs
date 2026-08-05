// Builds the unpacked extension into dist/wdrosdns from the manifest's own file
// graph, so a newly added module can never be left out of a release.
//
//   node scripts/build-package.mjs [outDir]

import { mkdir, copyFile, rm } from "node:fs/promises";
import path from "node:path";

import { collectFiles } from "./collect-files.mjs";

const out = process.argv[2] || "dist/wdrosdns";

const { files, missing } = await collectFiles(".");

if (missing.length) {
  console.error(`✗ referenced but missing: ${missing.join(", ")}`);
  process.exit(1);
}

await rm(out, { recursive: true, force: true });

for (const file of files) {
  const target = path.join(out, file);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(file, target);
}

console.log(`✓ ${out}: ${files.length} files`);

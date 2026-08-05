import test from "node:test";
import assert from "node:assert/strict";

import { workflowPackagingGaps } from "../scripts/collect-files.mjs";

const FILES = ["manifest.json", "common.js", "public-suffix.js", "_locales/en/messages.json", "icons/icon16.png"];

test("a workflow that delegates to the build script has no list to go stale", () => {
  const gaps = workflowPackagingGaps(`
      - name: Package extension
        run: |
          npm run build
          cd dist
          zip -r ../out.zip wdrosdns
  `, FILES);

  assert.equal(gaps.derived, true);
  assert.deepEqual(gaps.missing, []);
});

test("a complete cp list passes", () => {
  const gaps = workflowPackagingGaps(`
        run: |
          mkdir -p dist/wdrosdns
          cp manifest.json common.js public-suffix.js dist/wdrosdns/
          cp -r _locales icons dist/wdrosdns/
  `, FILES);

  assert.deepEqual(gaps.missing, []);
});

test("a stale cp list reports exactly what it would drop", () => {
  const gaps = workflowPackagingGaps(`
        run: |
          cp manifest.json common.js dist/wdrosdns/
          cp -r _locales icons dist/wdrosdns/
  `, FILES);

  assert.deepEqual(gaps.missing, ["public-suffix.js"]);
});

test("line continuations are folded before the list is read", () => {
  const gaps = workflowPackagingGaps(`
        run: |
          cp manifest.json common.js \\
             public-suffix.js dist/wdrosdns/
          cp -r _locales icons dist/wdrosdns/
  `, FILES);

  assert.deepEqual(gaps.missing, []);
});

test("flags are not mistaken for file names", () => {
  const gaps = workflowPackagingGaps(`
        run: |
          cp -v manifest.json common.js public-suffix.js dist/wdrosdns/
          cp -r _locales icons dist/wdrosdns/
  `, FILES);

  assert.deepEqual(gaps.missing, []);
});

test("a workflow with no recognisable packaging step is flagged as unknown", () => {
  const gaps = workflowPackagingGaps("run: echo nothing to see", FILES);

  assert.equal(gaps.unknown, true);
  assert.deepEqual(gaps.missing, []);
});

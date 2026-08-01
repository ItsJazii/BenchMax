import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  listBoundedZipEntries,
  MAX_BOUNDED_ZIP_ENTRIES,
  MAX_BOUNDED_ZIP_SELECTED_BYTES,
  readBoundedZipEntry,
} from "../lib/security/bounded-zip";

test("bounded ZIP inspection lists metadata without inflating every file", () => {
  const archive = zipSync({
    "index.html": strToU8("<main>Ready</main>"),
    "assets/app.js": strToU8("console.log('ready')"),
  });
  assert.deepEqual(listBoundedZipEntries(archive).sort(), [
    "assets/app.js",
    "index.html",
  ]);
  assert.equal(
    new TextDecoder().decode(readBoundedZipEntry(archive, "index.html")!),
    "<main>Ready</main>",
  );
  assert.equal(readBoundedZipEntry(archive, "missing.txt"), null);
});

test("bounded ZIP inspection rejects entry-count and selected-output abuse", () => {
  const tooManyEntries: Record<string, Uint8Array> = {};
  for (let index = 0; index <= MAX_BOUNDED_ZIP_ENTRIES; index += 1) {
    tooManyEntries[`file-${index}.txt`] = new Uint8Array();
  }
  assert.throws(() => listBoundedZipEntries(zipSync(tooManyEntries)));

  const oversized = zipSync(
    { "large.bin": new Uint8Array(MAX_BOUNDED_ZIP_SELECTED_BYTES + 1) },
    { level: 0 },
  );
  assert.throws(() => readBoundedZipEntry(oversized, "large.bin"));
});

import { unzipSync, type UnzipFileInfo } from "fflate";

export const MAX_BOUNDED_ZIP_COMPRESSED_BYTES = 20 * 1024 * 1024;
export const MAX_BOUNDED_ZIP_EXPANDED_BYTES = 64 * 1024 * 1024;
export const MAX_BOUNDED_ZIP_SELECTED_BYTES = 16 * 1024 * 1024;
export const MAX_BOUNDED_ZIP_ENTRIES = 2_000;

type ZipBudget = {
  entryCount: number;
  expandedBytes: number;
  names: Set<string>;
};

export function listBoundedZipEntries(bytes: Uint8Array) {
  assertArchiveSize(bytes);
  const names: string[] = [];
  const budget = createBudget();
  unzipSync(bytes, {
    filter(file) {
      consumeEntryBudget(budget, file);
      names.push(file.name);
      return false;
    },
  });
  return names;
}

export function readBoundedZipEntry(bytes: Uint8Array, entryName: string) {
  assertArchiveSize(bytes);
  if (!entryName || entryName.length > 512 || entryName.includes("\0")) {
    throw new BoundedZipError("invalid_entry_name");
  }
  const budget = createBudget();
  let selectedName: string | null = null;
  const files = unzipSync(bytes, {
    filter(file) {
      consumeEntryBudget(budget, file);
      if (file.name !== entryName) return false;
      if (selectedName !== null) {
        throw new BoundedZipError("duplicate_selected_entry");
      }
      if (file.originalSize > MAX_BOUNDED_ZIP_SELECTED_BYTES) {
        throw new BoundedZipError("selected_entry_too_large");
      }
      selectedName = file.name;
      return true;
    },
  });
  return selectedName === null ? null : files[selectedName] ?? null;
}

function createBudget(): ZipBudget {
  return { entryCount: 0, expandedBytes: 0, names: new Set() };
}

function consumeEntryBudget(budget: ZipBudget, file: UnzipFileInfo) {
  budget.entryCount += 1;
  if (budget.entryCount > MAX_BOUNDED_ZIP_ENTRIES) {
    throw new BoundedZipError("too_many_entries");
  }
  if (
    !file.name ||
    file.name.length > 512 ||
    file.name.includes("\0") ||
    budget.names.has(file.name)
  ) {
    throw new BoundedZipError("invalid_or_duplicate_entry_name");
  }
  budget.names.add(file.name);
  if (
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    !Number.isSafeInteger(file.originalSize) ||
    file.originalSize < 0
  ) {
    throw new BoundedZipError("invalid_entry_size");
  }
  budget.expandedBytes += file.originalSize;
  if (
    !Number.isSafeInteger(budget.expandedBytes) ||
    budget.expandedBytes > MAX_BOUNDED_ZIP_EXPANDED_BYTES
  ) {
    throw new BoundedZipError("expanded_archive_too_large");
  }
}

function assertArchiveSize(bytes: Uint8Array) {
  if (
    bytes.byteLength < 1 ||
    bytes.byteLength > MAX_BOUNDED_ZIP_COMPRESSED_BYTES
  ) {
    throw new BoundedZipError("compressed_archive_too_large");
  }
}

export class BoundedZipError extends Error {
  constructor(readonly code: string) {
    super("The ZIP archive exceeds the bounded inspection policy.");
    this.name = "BoundedZipError";
  }
}

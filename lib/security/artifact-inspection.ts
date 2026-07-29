import { unzipSync, type UnzipFileInfo } from "fflate";
import { detectSecretLabels, sha256Hex } from "./policy";

const MAX_ARCHIVE_ENTRIES = 5_000;
const MAX_ARCHIVE_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_SINGLE_ARCHIVE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_ENTRY_BYTES = 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;

const textExtensions = new Set([
  "c",
  "conf",
  "cpp",
  "css",
  "env",
  "go",
  "h",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "md",
  "mjs",
  "py",
  "rs",
  "sh",
  "sql",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
]);

const blockedArchiveExtensions = new Set([
  "bat",
  "bin",
  "cmd",
  "com",
  "cpl",
  "dll",
  "dmg",
  "exe",
  "hta",
  "iso",
  "jar",
  "lnk",
  "msi",
  "msp",
  "pif",
  "ps1",
  "reg",
  "scr",
  "sys",
  "vbe",
  "vbs",
  "wsf",
]);

export type ScanResult = {
  checks: string[];
  findings: string[];
  sha256: string | null;
  status: "approved" | "blocked" | "scanning";
};

export async function inspectZipArchive(
  bytes: Uint8Array,
): Promise<ScanResult> {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return {
      status: "blocked",
      sha256: null,
      checks: ["zip-signature"],
      findings: ["Source archive does not have a ZIP signature."],
    };
  }

  let entryCount = 0;
  let expandedBytes = 0;
  const selectedTextPaths = new Set<string>();
  const filter = (file: UnzipFileInfo) => {
    entryCount += 1;
    expandedBytes += file.originalSize;
    validateArchiveEntry(file, entryCount, expandedBytes);
    const extension = extensionOf(file.name);
    if (
      textExtensions.has(extension) &&
      file.originalSize <= MAX_TEXT_ENTRY_BYTES
    ) {
      selectedTextPaths.add(file.name);
      return true;
    }
    return false;
  };

  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(bytes, { filter });
  } catch (error) {
    return {
      status: "blocked",
      sha256: await sha256Hex(bytes.slice().buffer),
      checks: ["zip-signature", "archive-structure", "expansion-bounds"],
      findings: [
        error instanceof Error
          ? `Archive rejected: ${safeScannerMessage(error.message)}`
          : "Archive structure is invalid.",
      ],
    };
  }

  const secretLabels = new Set<string>();
  for (const path of selectedTextPaths) {
    const content = unpacked[path];
    if (!content) continue;
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      continue;
    }
    for (const label of detectSecretLabels(text)) {
      secretLabels.add(label);
    }
  }

  return {
    status: secretLabels.size > 0 ? "blocked" : "approved",
    sha256: await sha256Hex(bytes.slice().buffer),
    checks: [
      "zip-signature",
      "archive-paths",
      "entry-count",
      "expansion-ratio",
      "executable-blocklist",
      "secret-patterns",
      "content-sha256",
    ],
    findings: [...secretLabels].map(
      (label) => `Potential ${label} detected in source.`,
    ),
  };
}

export function matchesMagicBytes(
  contentType: string,
  bytes: Uint8Array,
): boolean {
  if (contentType === "image/png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (contentType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/webp") {
    return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
  }
  if (contentType === "video/mp4") {
    return ascii(bytes, 4, 4) === "ftyp";
  }
  if (contentType === "video/webm") {
    return (
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3
    );
  }
  return false;
}

function validateArchiveEntry(
  file: UnzipFileInfo,
  entryCount: number,
  expandedBytes: number,
) {
  const path = file.name.normalize("NFKC");
  const pathSegments = path.replaceAll("\\", "/").split("/");
  if (
    !path ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[a-zA-Z]:/.test(path) ||
    path.includes("\0") ||
    pathSegments.some((segment) => segment === "..")
  ) {
    throw new Error("unsafe archive path");
  }
  if (entryCount > MAX_ARCHIVE_ENTRIES) throw new Error("too many entries");
  if (expandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) {
    throw new Error("expanded archive is too large");
  }
  if (file.originalSize > MAX_SINGLE_ARCHIVE_FILE_BYTES) {
    throw new Error("archive entry is too large");
  }
  if (file.compression !== 0 && file.compression !== 8) {
    throw new Error("unsupported compression method");
  }
  const ratio = file.originalSize / Math.max(file.size, 1);
  if (ratio > MAX_COMPRESSION_RATIO) throw new Error("unsafe compression ratio");
  if (blockedArchiveExtensions.has(extensionOf(path))) {
    throw new Error("executable file type is not allowed");
  }
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function extensionOf(path: string): string {
  const fileName = path.replaceAll("\\", "/").split("/").pop() ?? "";
  return fileName.includes(".")
    ? (fileName.split(".").pop() ?? "").toLowerCase()
    : "";
}

function safeScannerMessage(message: string): string {
  return message.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 120);
}

import { canonicalJson } from "./canonical";
import { sha256Hex } from "./policy";

const FORMAT_VERSION = 1;
const IV_BYTES = 12;

export async function encryptProvenanceEnvelope(
  runId: string,
  envelope: unknown,
): Promise<{ bytes: Uint8Array; sha256: string }> {
  const key = await loadEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(canonicalJson(envelope));
  const additionalData = new TextEncoder().encode(
    `benchmax:provenance:v1:${runId}`,
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData, tagLength: 128 },
      key,
      plaintext,
    ),
  );
  const bytes = new Uint8Array(1 + IV_BYTES + ciphertext.length);
  bytes[0] = FORMAT_VERSION;
  bytes.set(iv, 1);
  bytes.set(ciphertext, 1 + IV_BYTES);
  return { bytes, sha256: await sha256Hex(bytes.buffer) };
}

async function loadEncryptionKey(): Promise<CryptoKey> {
  const encoded = process.env.PROVENANCE_ENCRYPTION_KEY;
  if (!encoded) throw new ProvenanceConfigurationError();
  let raw: Uint8Array;
  try {
    raw = Uint8Array.from(atob(encoded), (character) =>
      character.charCodeAt(0),
    );
  } catch {
    throw new ProvenanceConfigurationError();
  }
  if (raw.byteLength !== 32) throw new ProvenanceConfigurationError();
  const keyBytes = new Uint8Array(raw.byteLength);
  keyBytes.set(raw);
  return crypto.subtle.importKey("raw", keyBytes.buffer, "AES-GCM", false, [
    "encrypt",
  ]);
}

export class ProvenanceConfigurationError extends Error {
  readonly status = 503;
  constructor() {
    super("Private provenance encryption is not configured.");
    this.name = "ProvenanceConfigurationError";
  }
}

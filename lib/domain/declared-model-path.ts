const MODEL_PATH_PREFIX = "m1-";
const MODEL_PATH_PATTERN = /^m1-(?:[0-9a-f]{2})+$/u;

export function declaredModelPathKey(label: string): string {
  if (!label) throw new TypeError("A declared model label is required.");
  const encoded = new TextEncoder().encode(label);
  const hex = Array.from(encoded, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${MODEL_PATH_PREFIX}${hex}`;
}

export function declaredModelLabelFromPathKey(key: string): string | null {
  if (!MODEL_PATH_PATTERN.test(key)) return null;
  try {
    const hex = key.slice(MODEL_PATH_PREFIX.length);
    const bytes = new Uint8Array(hex.length / 2);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    }
    const label = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return label && declaredModelPathKey(label) === key ? label : null;
  } catch {
    return null;
  }
}

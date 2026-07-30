export function uploadObjectKeys(input: {
  fileName: string;
  sessionId: string;
  userId: string;
}) {
  const safeSegment = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return {
    evidence:
      `evidence/${input.userId}/${input.sessionId}/${encodeURIComponent(input.fileName)}`,
    quarantine:
      `quarantine/${input.userId}/${input.sessionId}/${safeSegment}`,
  };
}

export function isExpectedUploadObjectKey(
  objectKey: string,
  input: {
    fileName: string;
    sessionId: string;
    userId: string;
  },
) {
  const keys = uploadObjectKeys(input);
  return objectKey === keys.quarantine || objectKey === keys.evidence;
}

export function planExpiredUploadCleanup(input: {
  artifactExists: boolean;
  fileName: string;
  objectKey: string;
  sessionId: string;
  status: "created" | "uploading" | "uploaded" | "expired" | "cancelled";
  userId: string;
}):
  | { deleteKeys: string[]; nextStatus: "expired" | "uploaded" | null }
  | null {
  const keys = uploadObjectKeys(input);
  if (input.artifactExists) {
    return { deleteKeys: [keys.quarantine], nextStatus: "uploaded" };
  }
  if (!isExpectedUploadObjectKey(input.objectKey, input)) return null;
  return {
    deleteKeys: [
      ...new Set([input.objectKey, keys.quarantine, keys.evidence]),
    ],
    nextStatus:
      input.status === "created" || input.status === "uploading"
        ? "expired"
        : null,
  };
}

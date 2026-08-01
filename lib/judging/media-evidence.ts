export const MAX_JUDGE_IMAGE_COUNT = 8;
export const MAX_JUDGE_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_JUDGE_IMAGE_TOTAL_BYTES = 24 * 1024 * 1024;
export const MAX_JUDGE_VIDEO_COUNT = 2;
export const MAX_JUDGE_VIDEO_BYTES = 500 * 1024 * 1024;
export const MAX_JUDGE_VIDEO_TOTAL_BYTES = 500 * 1024 * 1024;

export const judgeImageContentTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export const judgeVideoContentTypes = ["video/mp4", "video/webm"] as const;

export type JudgeImageContentType = (typeof judgeImageContentTypes)[number];
export type JudgeVideoContentType = (typeof judgeVideoContentTypes)[number];

export type JudgeMediaArtifact = {
  byteSize: number;
  contentType: string;
  createdAt: Date;
  id: string;
  kind: string;
  objectKey: string;
  sha256: string;
};

export type PlannedJudgeImage = JudgeMediaArtifact & {
  contentType: JudgeImageContentType;
  kind: "screenshot";
};

export type PlannedJudgeVideo = JudgeMediaArtifact & {
  contentType: JudgeVideoContentType;
  kind: "video";
};

export type JudgeMediaOmissionReason =
  | "unsupported_media_type"
  | "invalid_byte_size"
  | "per_file_byte_limit"
  | "count_limit"
  | "total_byte_limit";

export type JudgeMediaPlan = {
  images: PlannedJudgeImage[];
  videos: PlannedJudgeVideo[];
  manifest: {
    imageCount: number;
    imageBytes: number;
    videoCount: number;
    videoBytes: number;
    omitted: Array<{
      byteSize: number;
      contentType: string;
      kind: string;
      ordinal: number;
      reason: JudgeMediaOmissionReason;
    }>;
  };
};

const imageTypes = new Set<string>(judgeImageContentTypes);
const videoTypes = new Set<string>(judgeVideoContentTypes);

export function planJudgeMedia(
  artifacts: readonly JudgeMediaArtifact[],
): JudgeMediaPlan {
  const images: PlannedJudgeImage[] = [];
  const videos: PlannedJudgeVideo[] = [];
  const omitted: JudgeMediaPlan["manifest"]["omitted"] = [];
  let imageBytes = 0;
  let videoBytes = 0;

  const ordered = [...artifacts].sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id.localeCompare(right.id),
  );
  for (const [ordinal, artifact] of ordered.entries()) {
    if (artifact.kind !== "screenshot" && artifact.kind !== "video") continue;
    if (!Number.isSafeInteger(artifact.byteSize) || artifact.byteSize <= 0) {
      omitted.push(omission(artifact, ordinal, "invalid_byte_size"));
      continue;
    }
    if (artifact.kind === "screenshot") {
      if (!imageTypes.has(artifact.contentType)) {
        omitted.push(omission(artifact, ordinal, "unsupported_media_type"));
      } else if (artifact.byteSize > MAX_JUDGE_IMAGE_BYTES) {
        omitted.push(omission(artifact, ordinal, "per_file_byte_limit"));
      } else if (images.length >= MAX_JUDGE_IMAGE_COUNT) {
        omitted.push(omission(artifact, ordinal, "count_limit"));
      } else if (
        imageBytes + artifact.byteSize >
        MAX_JUDGE_IMAGE_TOTAL_BYTES
      ) {
        omitted.push(omission(artifact, ordinal, "total_byte_limit"));
      } else {
        images.push(artifact as PlannedJudgeImage);
        imageBytes += artifact.byteSize;
      }
      continue;
    }
    if (!videoTypes.has(artifact.contentType)) {
      omitted.push(omission(artifact, ordinal, "unsupported_media_type"));
    } else if (artifact.byteSize > MAX_JUDGE_VIDEO_BYTES) {
      omitted.push(omission(artifact, ordinal, "per_file_byte_limit"));
    } else if (videos.length >= MAX_JUDGE_VIDEO_COUNT) {
      omitted.push(omission(artifact, ordinal, "count_limit"));
    } else if (
      videoBytes + artifact.byteSize >
      MAX_JUDGE_VIDEO_TOTAL_BYTES
    ) {
      omitted.push(omission(artifact, ordinal, "total_byte_limit"));
    } else {
      videos.push(artifact as PlannedJudgeVideo);
      videoBytes += artifact.byteSize;
    }
  }

  return {
    images,
    videos,
    manifest: {
      imageCount: images.length,
      imageBytes,
      videoCount: videos.length,
      videoBytes,
      omitted,
    },
  };
}

export function imageDataUrl(
  bytes: Uint8Array,
  contentType: JudgeImageContentType,
) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_JUDGE_IMAGE_BYTES) {
    throw new RangeError("Judge image evidence is outside the byte limit.");
  }
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

function omission(
  artifact: JudgeMediaArtifact,
  ordinal: number,
  reason: JudgeMediaOmissionReason,
) {
  return {
    byteSize: artifact.byteSize,
    contentType: artifact.contentType,
    kind: artifact.kind,
    ordinal: ordinal + 1,
    reason,
  };
}

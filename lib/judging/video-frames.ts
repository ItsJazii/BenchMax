import { createHash } from "node:crypto";
import { Sandbox } from "e2b";
import { matchesMagicBytes } from "@/lib/security/artifact-inspection";
import { constantTimeEqualHex } from "@/lib/security/policy";
import {
  buildSandboxSpendRecord,
  recordResultSpend,
  sandboxRateFromEnv,
} from "@/lib/data/result-spend";
import { imageDataUrl, type PlannedJudgeVideo } from "./media-evidence";

const VIDEO_SANDBOX_TIMEOUT_MS = 120_000;
const VIDEO_FILE_TRANSFER_TIMEOUT_MS = 90_000;
const VIDEO_COMMAND_TIMEOUT_MS = 15_000;
const VIDEO_READ_TIMEOUT_MS = 15_000;
const VIDEO_SANDBOX_CREATE_TIMEOUT_MS = 30_000;
const VIDEO_SANDBOX_KILL_TIMEOUT_MS = 10_000;
const MAX_VIDEO_FRAME_BYTES = 2 * 1024 * 1024;
const fallbackFrameOffsetsSeconds = [0.25, 5, 15] as const;
const MAX_INSPECTED_VIDEO_DURATION_SECONDS = 6 * 60 * 60;

type StoredVideoObject = {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
  size: number;
};

export type JudgeVideoSandbox = {
  commands: {
    run(
      command: string,
      options: { timeoutMs: number },
    ): Promise<{ exitCode: number; stderr?: string }>;
  };
  files: {
    read(
      path: string,
      options?: { format?: "bytes"; requestTimeoutMs?: number },
    ): Promise<string | Uint8Array>;
    write(
      path: string,
      data: ReadableStream,
      options: { requestTimeoutMs: number },
    ): Promise<unknown>;
  };
  kill(options?: { requestTimeoutMs: number }): Promise<boolean>;
};

type VideoExtractionDependencies = {
  createSandbox?: () => Promise<JudgeVideoSandbox>;
  expectedBuildHash?: string;
};

export type ExtractedVideoEvidence = {
  images: string[];
  inspection: Array<{
    extractedFrameCount: number;
    inspectedOffsetsSeconds: number[];
    sourceByteSize: number;
    sourceContentType: string;
    videoOrdinal: number;
  }>;
};

export async function extractVideoEvidence(input: {
  evaluationVersionId?: string;
  getObject(objectKey: string): Promise<StoredVideoObject | null>;
  runId: string;
  videos: readonly PlannedJudgeVideo[];
}, dependencies: VideoExtractionDependencies = {}): Promise<ExtractedVideoEvidence> {
  if (input.videos.length === 0) return { images: [], inspection: [] };
  const sandboxRate = dependencies.createSandbox ? null : sandboxRateFromEnv();
  const sandboxAttemptKey = `sandbox:${input.runId}:video-inspection:${crypto.randomUUID()}`;
  const sandboxStartedAt = Date.now();
  const expectedBuildHash =
    dependencies.expectedBuildHash ??
    requiredSha256("E2B_TEMPLATE_BUILD_HASH");
  const sandbox = dependencies.createSandbox
    ? await dependencies.createSandbox()
    : ((await Sandbox.create(requiredSecret("E2B_TEMPLATE_ID"), {
        apiKey: requiredSecret("E2B_API_KEY"),
        allowInternetAccess: false,
        secure: true,
        timeoutMs: VIDEO_SANDBOX_TIMEOUT_MS,
        requestTimeoutMs: VIDEO_SANDBOX_CREATE_TIMEOUT_MS,
        lifecycle: { onTimeout: "kill" },
        metadata: {
          benchmaxRunId: input.runId,
          purpose: "video-frame-inspection",
        },
      })) as unknown as JudgeVideoSandbox);
  let sandboxStatus: "completed" | "failed" = "failed";
  try {
    const buildHashFile = await sandbox.files.read(
      "/opt/benchmax/environment.sha256",
      { requestTimeoutMs: VIDEO_READ_TIMEOUT_MS },
    );
    const actualBuildHash =
      typeof buildHashFile === "string" ? buildHashFile.trim() : "";
    if (actualBuildHash !== expectedBuildHash) {
      throw new JudgeMediaError("video_environment_hash_mismatch");
    }
    const images: string[] = [];
    const inspection: ExtractedVideoEvidence["inspection"] = [];
    for (const [videoIndex, video] of input.videos.entries()) {
      const object = await input.getObject(video.objectKey);
      if (
        !object ||
        object.size !== video.byteSize ||
        object.httpMetadata?.contentType !== video.contentType
      ) {
        throw new JudgeMediaError("video_evidence_integrity_mismatch");
      }
      const extension = video.contentType === "video/mp4" ? "mp4" : "webm";
      const inputPath = `/workspace/input/judge-video-${videoIndex + 1}.${extension}`;
      const [uploadBody, verificationBody] = object.body.tee();
      const [verification] = await Promise.all([
        hashMediaStream(verificationBody),
        sandbox.files.write(inputPath, uploadBody, {
          requestTimeoutMs: VIDEO_FILE_TRANSFER_TIMEOUT_MS,
        }),
      ]);
      if (
        !matchesMagicBytes(video.contentType, verification.prefix) ||
        !constantTimeEqualHex(verification.sha256, video.sha256)
      ) {
        throw new JudgeMediaError("video_evidence_integrity_mismatch");
      }
      const probe = await sandbox.commands.run(
        buildVideoProbeCommand(inputPath),
        { timeoutMs: VIDEO_COMMAND_TIMEOUT_MS },
      );
      const offsetsSeconds = videoFrameOffsets(
        parseVideoDurationSeconds(probe.stderr ?? ""),
      );
      const inspectedOffsetsSeconds: number[] = [];
      for (const [frameIndex, offsetSeconds] of offsetsSeconds.entries()) {
        const outputPath = `/workspace/output/judge-video-${videoIndex + 1}-frame-${frameIndex + 1}.jpg`;
        const command = buildVideoFrameCommand({
          inputPath,
          offsetSeconds,
          outputPath,
        });
        const result = await sandbox.commands.run(command, {
          timeoutMs: VIDEO_COMMAND_TIMEOUT_MS,
        });
        if (result.exitCode !== 0) continue;
        const frameFile = await sandbox.files
          .read(outputPath, {
            format: "bytes",
            requestTimeoutMs: VIDEO_READ_TIMEOUT_MS,
          })
          .catch(() => null);
        const frame = frameFile instanceof Uint8Array ? frameFile : null;
        if (
          !frame ||
          frame.byteLength === 0 ||
          frame.byteLength > MAX_VIDEO_FRAME_BYTES ||
          !matchesMagicBytes("image/jpeg", frame.subarray(0, 64))
        ) {
          continue;
        }
        images.push(imageDataUrl(frame, "image/jpeg"));
        inspectedOffsetsSeconds.push(offsetSeconds);
      }
      if (inspectedOffsetsSeconds.length === 0) {
        throw new JudgeMediaError("video_frame_extraction_failed");
      }
      inspection.push({
        extractedFrameCount: inspectedOffsetsSeconds.length,
        inspectedOffsetsSeconds,
        sourceByteSize: video.byteSize,
        sourceContentType: video.contentType,
        videoOrdinal: videoIndex + 1,
      });
    }
    sandboxStatus = "completed";
    return { images, inspection };
  } finally {
    await sandbox
      .kill({ requestTimeoutMs: VIDEO_SANDBOX_KILL_TIMEOUT_MS })
      .catch(() => false);
    if (sandboxRate !== null) {
      await recordResultSpend(
        await buildSandboxSpendRecord(
          {
            attemptKey: sandboxAttemptKey,
            durationMs: Math.max(0, Date.now() - sandboxStartedAt),
            evaluationVersionId: input.evaluationVersionId ?? null,
            operation: "video-inspection",
            runId: input.runId,
            status: sandboxStatus,
          },
          sandboxRate,
        ),
      );
    }
  }
}

export function buildVideoFrameCommand(input: {
  inputPath: string;
  offsetSeconds: number;
  outputPath: string;
}) {
  if (
    !/^\/workspace\/input\/judge-video-[1-2]\.(?:mp4|webm)$/.test(
      input.inputPath,
    ) ||
    !/^\/workspace\/output\/judge-video-[1-2]-frame-[1-3]\.jpg$/.test(
      input.outputPath,
    ) ||
    !Number.isFinite(input.offsetSeconds) ||
    input.offsetSeconds < 0 ||
    input.offsetSeconds > MAX_INSPECTED_VIDEO_DURATION_SECONDS
  ) {
    throw new JudgeMediaError("video_frame_command_invalid");
  }
  return [
    "/usr/local/bin/benchmax-ffmpeg",
    "-nostdin",
    "-hide_banner",
    "-loglevel error",
    `-ss ${input.offsetSeconds}`,
    `-i ${input.inputPath}`,
    "-frames:v 1",
    '-vf "scale=960:-2:force_original_aspect_ratio=decrease"',
    "-q:v 4",
    "-y",
    input.outputPath,
  ].join(" ");
}

export function buildVideoProbeCommand(inputPath: string) {
  if (!/^\/workspace\/input\/judge-video-[1-2]\.(?:mp4|webm)$/.test(inputPath)) {
    throw new JudgeMediaError("video_probe_command_invalid");
  }
  return [
    "/usr/local/bin/benchmax-ffmpeg",
    "-nostdin",
    "-hide_banner",
    `-i ${inputPath}`,
    "-t 0",
    "-f null",
    "-",
  ].join(" ");
}

export function parseVideoDurationSeconds(stderr: string) {
  const match = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return null;
  const duration =
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(duration) &&
    duration > 0 &&
    duration <= MAX_INSPECTED_VIDEO_DURATION_SECONDS
    ? duration
    : null;
}

export function videoFrameOffsets(durationSeconds: number | null) {
  if (!durationSeconds) return [...fallbackFrameOffsetsSeconds];
  return [0.1, 0.5, 0.9].map((position) =>
    Number((durationSeconds * position).toFixed(3)),
  );
}

async function hashMediaStream(body: ReadableStream) {
  const hash = createHash("sha256");
  const prefix = new Uint8Array(64);
  let prefixLength = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!(value instanceof Uint8Array)) {
      throw new JudgeMediaError("video_evidence_stream_invalid");
    }
    hash.update(value);
    if (prefixLength < prefix.length) {
      const chunk = value.subarray(0, prefix.length - prefixLength);
      prefix.set(chunk, prefixLength);
      prefixLength += chunk.length;
    }
  }
  return {
    prefix: prefix.subarray(0, prefixLength),
    sha256: hash.digest("hex"),
  };
}

function requiredSecret(name: string) {
  const value = process.env[name]?.trim();
  if (!value || value.length > 4096) {
    throw new JudgeMediaConfigurationError(name);
  }
  return value;
}

function requiredSha256(name: string) {
  const value = requiredSecret(name);
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new JudgeMediaConfigurationError(name);
  }
  return value;
}

export class JudgeMediaConfigurationError extends Error {
  readonly code = "judge_media_configuration_error";

  constructor(readonly key: string) {
    super("The pinned media inspection environment is not configured.");
    this.name = "JudgeMediaConfigurationError";
  }
}

export class JudgeMediaError extends Error {
  constructor(readonly code: string) {
    super("The bounded judge media inspection did not complete.");
    this.name = "JudgeMediaError";
  }
}

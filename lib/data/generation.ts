import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import {
  benchmarkVersions,
  configurations,
  generationRecords,
  harnesses,
  providers,
  runArtifacts,
  runs,
} from "@/db/schema";
import type {
  GenerationContract,
  WebAgentGenerationResult,
} from "@/lib/generation/web-agent";
import { canonicalSha256 } from "@/lib/security/canonical";
import { encryptProvenanceEnvelope } from "@/lib/security/provenance";
import { transitionRun } from "./runs";

const filePolicySchema = z
  .object({
    maxFiles: z.number().int().min(1).max(1000),
    maxFileBytes: z.number().int().min(1).max(10 * 1024 * 1024),
    maxProjectBytes: z.number().int().min(1).max(100 * 1024 * 1024),
  })
  .passthrough();

export async function getGenerationContract(
  runId: string,
): Promise<(GenerationContract & { credentialMode: "byok" | "platform-credit" }) | null> {
  const [row] = await getDb()
    .select({
      runId: runs.id,
      configurationId: configurations.id,
      credentialMode: runs.credentialMode,
      benchmarkPrompt: benchmarkVersions.canonicalPrompt,
      environmentHash: runs.environmentHash,
      harnessContractHash: runs.harnessContractHash,
      endpointOrigin: providers.endpointOrigin,
      apiStyle: providers.apiStyle,
      providerModelId: configurations.providerModelId,
      samplingSettingsJson: configurations.samplingSettingsJson,
      turnLimit: harnesses.turnLimit,
      filePolicyJson: harnesses.filePolicyJson,
    })
    .from(runs)
    .innerJoin(
      configurations,
      eq(runs.configurationId, configurations.id),
    )
    .innerJoin(providers, eq(configurations.providerId, providers.id))
    .innerJoin(harnesses, eq(configurations.harnessId, harnesses.id))
    .innerJoin(
      benchmarkVersions,
      eq(runs.benchmarkVersionId, benchmarkVersions.id),
    )
    .where(
      and(
        eq(runs.id, runId),
        eq(configurations.status, "active"),
        eq(providers.status, "active"),
        eq(harnesses.status, "active"),
      ),
    )
    .limit(1);
  if (!row) return null;
  let rawPolicy: unknown;
  try {
    rawPolicy = JSON.parse(row.filePolicyJson);
  } catch {
    throw new GenerationContractCorruptError();
  }
  const policy = filePolicySchema.safeParse(rawPolicy);
  if (!policy.success) throw new GenerationContractCorruptError();
  return {
    runId: row.runId,
    configurationId: row.configurationId,
    credentialMode: row.credentialMode,
    benchmarkPrompt: row.benchmarkPrompt,
    environmentHash: row.environmentHash,
    harnessContractHash: row.harnessContractHash,
    endpointOrigin: row.endpointOrigin,
    apiStyle: row.apiStyle,
    providerModelId: row.providerModelId,
    samplingSettingsJson: row.samplingSettingsJson,
    turnLimit: row.turnLimit,
    maxFiles: policy.data.maxFiles,
    maxFileBytes: policy.data.maxFileBytes,
    maxProjectBytes: policy.data.maxProjectBytes,
  };
}

export async function persistSuccessfulGeneration(input: {
  result: WebAgentGenerationResult;
  runId: string;
  startedAt: number;
}) {
  const existing = await getDb()
    .select({ id: generationRecords.id })
    .from(generationRecords)
    .where(eq(generationRecords.runId, input.runId))
    .limit(1);
  if (existing.length > 0) return;

  const provenanceHash = await canonicalSha256({
    runId: input.runId,
    requestHash: input.result.requestHash,
    responseHash: input.result.responseHash,
    sourceSha256: input.result.sourceSha256,
  });
  const encrypted = await encryptProvenanceEnvelope(
    input.runId,
    input.result.transcriptEnvelope,
  );
  const provenanceObjectKey = `private/provenance/${input.runId}/${provenanceHash}.bin`;
  const sourceObjectKey = `runs/${input.runId}/generated/${input.result.sourceSha256}.zip`;
  await env.UPLOADS.put(provenanceObjectKey, encrypted.bytes, {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: {
      benchmaxRun: input.runId,
      envelopeVersion: "1",
    },
  });
  await env.UPLOADS.put(sourceObjectKey, input.result.sourceBytes, {
    httpMetadata: { contentType: "application/zip" },
    customMetadata: {
      benchmaxRun: input.runId,
      sha256: input.result.sourceSha256,
    },
  });

  const now = new Date();
  await getDb().insert(generationRecords).values({
    id: crypto.randomUUID(),
    runId: input.runId,
    requestHash: input.result.requestHash,
    responseHash: input.result.responseHash,
    provenanceHash,
    encryptedEnvelopeObjectKey: provenanceObjectKey,
    encryptedEnvelopeSha256: encrypted.sha256,
    redactedTranscript: input.result.redactedTranscript,
    providerRequestId: input.result.providerRequestId,
    inputTokens: input.result.inputTokens,
    outputTokens: input.result.outputTokens,
    durationMs: Math.max(0, Date.now() - input.startedAt),
    harnessTurnCount: input.result.turnCount,
    createdAt: now,
  });
  await getDb().insert(runArtifacts).values({
    id: crypto.randomUUID(),
    runId: input.runId,
    kind: "generated-source",
    objectKey: sourceObjectKey,
    contentType: "application/zip",
    byteSize: input.result.sourceBytes.byteLength,
    sha256: input.result.sourceSha256,
    public: true,
    createdAt: now,
  });
  await transitionRun({
    id: input.runId,
    from: "generating",
    to: "generated",
    patch: {
      outputContentHash: input.result.sourceSha256,
      generatedAt: now,
    },
  });
}

export async function markGenerationFailed(
  runId: string,
  code: string,
  summary: string,
) {
  await transitionRun({
    id: runId,
    from: "generating",
    to: "generation_failed",
    patch: {
      failureCode: safeCode(code),
      failureSummary: summary.slice(0, 300),
    },
  });
}

function safeCode(value: string): string {
  return /^[a-z0-9_:-]{1,80}$/.test(value) ? value : "generation_failed";
}

export class GenerationContractCorruptError extends Error {
  constructor() {
    super("The frozen generation contract is invalid.");
    this.name = "GenerationContractCorruptError";
  }
}

import { env } from "cloudflare:workers";
import { Sandbox } from "e2b";
import { z } from "zod";
import { EVALUATION_ENVIRONMENT_V1 } from "@/lib/domain/ranked-catalog";
import {
  persistShowcaseEnrichmentArtifact,
  readShowcaseEnrichmentContract,
  recordShowcaseEnrichmentSpend,
} from "@/lib/data/showcase-enrichment";
import { evaluatorReportContractError } from "@/lib/evaluation/report-contract";
import { hasRunnableStaticEntryPoint } from "@/lib/evaluation/community-static";
import {
  buildShowcasePreviewSpec,
  PREVIEW_CHECKS,
} from "@/lib/evaluation/preview-spec";
import { canonicalJson } from "@/lib/security/canonical";
import { constantTimeEqualHex, sha256Hex } from "@/lib/security/policy";

const previewReportSchema = z
  .object({
    protocolVersion: z.literal("frontend-static-evaluator-v1"),
    templateBuildHash: z.string().regex(/^[a-f0-9]{64}$/),
    weightedScoreBps: z.number().int().min(0).max(10_000),
    objectiveResults: z
      .array(
        z.object({
          checkKey: z.string().min(1).max(120),
          kind: z.string().min(1).max(80),
          status: z.enum(["pass", "fail", "error"]),
          scoreBps: z.number().int().min(0).max(10_000),
          weightBps: z.number().int().min(1).max(10_000),
          metric: z.record(z.string(), z.unknown()),
        }),
      )
      .min(1)
      .max(50),
    consoleErrors: z.array(z.string().max(500)).max(100),
    serverLog: z.string().max(20_000),
    videoCaptureMs: z.literal(5_000),
    videoDurationMs: z.number().int().min(4_950).max(5_050),
  })
  .strict();

export async function executeShowcasePreviewEnrichment(
  enrichmentId: string,
): Promise<
  | { outcome: "completed"; templateBuildHash: string }
  | { outcome: "not_applicable" }
> {
  const contract = await readShowcaseEnrichmentContract(enrichmentId);
  if (!contract?.sourceSha256) {
    throw new ShowcasePreviewEnrichmentError("preview_contract_unavailable");
  }
  const sourceObject = await env.UPLOADS.get(contract.sourceObjectKey);
  if (
    !sourceObject ||
    sourceObject.size !== contract.sourceByteSize ||
    sourceObject.httpMetadata?.contentType !== contract.sourceContentType ||
    sourceObject.customMetadata?.immutableEvidence !== "true"
  ) {
    throw new ShowcasePreviewEnrichmentError("preview_source_unavailable");
  }
  const sourceBytes = new Uint8Array(await sourceObject.arrayBuffer());
  const sourceSha256 = await sha256Hex(sourceBytes.slice().buffer);
  if (!constantTimeEqualHex(sourceSha256, contract.sourceSha256)) {
    throw new ShowcasePreviewEnrichmentError("preview_source_hash_mismatch");
  }
  if (!hasRunnableStaticEntryPoint(sourceBytes)) {
    return { outcome: "not_applicable" };
  }

  const templateId = requiredSecret("E2B_TEMPLATE_ID");
  const templateBuildHash = requiredSha256("E2B_TEMPLATE_BUILD_HASH");
  const attemptKey = `sandbox:${enrichmentId}:preview:${crypto.randomUUID()}`;
  const startedAt = Date.now();
  let sandbox: Sandbox | null = null;
  let spendStatus: "completed" | "failed" = "failed";
  try {
    sandbox = await Sandbox.create(templateId, {
      apiKey: requiredSecret("E2B_API_KEY"),
      allowInternetAccess: false,
      secure: true,
      timeoutMs: EVALUATION_ENVIRONMENT_V1.wallClockSeconds * 1_000,
      lifecycle: { onTimeout: "kill" },
      metadata: {
        benchmaxEnrichmentId: enrichmentId,
        sourceSha256,
      },
    });
    const specJson = canonicalJson(buildShowcasePreviewSpec(sourceSha256));
    await sandbox.files.write(
      "/workspace/input/source.zip",
      sourceBytes.slice().buffer as ArrayBuffer,
    );
    await sandbox.files.write("/workspace/input/spec.json", specJson);
    const extract = await sandbox.commands.run(
      "unzip -qq /workspace/input/source.zip -d /workspace/project",
      { timeoutMs: 20_000 },
    );
    if (extract.exitCode !== 0) {
      throw new ShowcasePreviewEnrichmentError("preview_source_extract_failed");
    }
    const command = await sandbox.commands.run(
      "PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright node /opt/benchmax/evaluate.mjs",
      { timeoutMs: EVALUATION_ENVIRONMENT_V1.wallClockSeconds * 1_000 },
    );
    if (command.exitCode !== 0) {
      throw new ShowcasePreviewEnrichmentError("preview_evaluator_failed");
    }
    const reportText = await sandbox.files.read("/workspace/output/report.json");
    const report = previewReportSchema.parse(JSON.parse(reportText));
    if (report.templateBuildHash !== templateBuildHash) {
      throw new ShowcasePreviewEnrichmentError(
        "preview_environment_hash_mismatch",
      );
    }
    const contractError = evaluatorReportContractError({
      checks: PREVIEW_CHECKS,
      objectiveResults: report.objectiveResults,
      weightedScoreBps: report.weightedScoreBps,
    });
    if (contractError) {
      throw new ShowcasePreviewEnrichmentError(contractError);
    }
    const screenshot = await sandbox.files
      .read("/workspace/output/milestone.png", { format: "bytes" })
      .catch(() => null);
    const video = await sandbox.files
      .read("/workspace/output/milestone.webm", { format: "bytes" })
      .catch(() => null);
    if (
      !screenshot ||
      screenshot.byteLength === 0 ||
      !video ||
      video.byteLength === 0
    ) {
      throw new ShowcasePreviewEnrichmentError("preview_evidence_missing");
    }
    await persistShowcaseEnrichmentArtifact({
      bytes: screenshot,
      enrichmentId,
      kind: "screenshot",
      contentType: "image/png",
    });
    await persistShowcaseEnrichmentArtifact({
      bytes: video,
      enrichmentId,
      kind: "video",
      contentType: "video/webm",
    });
    await persistShowcaseEnrichmentArtifact({
      bytes: new TextEncoder().encode(
        canonicalJson({
          consoleErrors: report.consoleErrors,
          protocolVersion: report.protocolVersion,
        }),
      ),
      enrichmentId,
      kind: "console",
      contentType: "application/json",
    });
    await persistShowcaseEnrichmentArtifact({
      bytes: new TextEncoder().encode(
        canonicalJson({
          objectiveResults: report.objectiveResults.filter(
            (result) => result.kind === "accessibility",
          ),
          protocolVersion: report.protocolVersion,
        }),
      ),
      enrichmentId,
      kind: "accessibility",
      contentType: "application/json",
    });
    spendStatus = "completed";
    return { outcome: "completed", templateBuildHash };
  } finally {
    await sandbox?.kill().catch(() => false);
    await recordShowcaseEnrichmentSpend({
      attemptKey,
      durationMs: Math.max(0, Date.now() - startedAt),
      enrichmentId,
      status: spendStatus,
    }).catch((error) => {
      console.error("Benchmax preview enrichment spend recording failed", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
    });
  }
}

function requiredSecret(name: string) {
  const value = process.env[name]?.trim();
  if (!value || value.length > 4_096) {
    throw new ShowcasePreviewEnrichmentError(
      "preview_evaluator_not_configured",
    );
  }
  return value;
}

function requiredSha256(name: string) {
  const value = requiredSecret(name).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new ShowcasePreviewEnrichmentError(
      "preview_evaluator_not_configured",
    );
  }
  return value;
}

export class ShowcasePreviewEnrichmentError extends Error {
  constructor(readonly code: string) {
    super("Automated preview enrichment could not complete.");
    this.name = "ShowcasePreviewEnrichmentError";
  }
}

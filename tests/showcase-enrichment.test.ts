import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PREVIEW_CHECKS } from "../lib/evaluation/preview-spec";
import {
  isShowcaseEnrichmentMessage,
  showcaseEnrichmentMessage,
} from "../lib/pipeline/enrichment-messages";
import {
  enrichmentRetryDelaySeconds,
  sanitizeEnrichmentFailureCode,
} from "../lib/pipeline/enrichment-policy";
import {
  configuredDailyEnrichmentBudget,
  EnrichmentBudgetConfigurationError,
  enrichmentBudgetConfigurationDeferralAuditId,
  enrichmentBudgetDeferralAuditId,
  enrichmentBudgetWindow,
  isEnrichmentBudgetExhausted,
  projectedEnrichmentAttemptMicrousd,
  SHOWCASE_ENRICHMENT_SANDBOX_MAX_DURATION_MS,
} from "../lib/pipeline/enrichment-budget";
import {
  usercontentWorker,
  type UsercontentEnv,
} from "../usercontent/worker";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const enrichmentId = "11111111-2222-4333-8444-555555555555";
const artifactId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const sha256 = "a".repeat(64);

test("preview enrichment messages are distinct, bounded, and versioned", () => {
  const message = showcaseEnrichmentMessage(enrichmentId);
  assert.deepEqual(message, {
    enrichmentId,
    stage: "enrich-preview",
    stageVersion: "1",
  });
  assert.equal(isShowcaseEnrichmentMessage(message), true);
  assert.equal(
    isShowcaseEnrichmentMessage({
      runId: enrichmentId,
      stage: "evaluate",
      stageVersion: "1",
    }),
    false,
  );
  assert.equal(
    isShowcaseEnrichmentMessage({
      enrichmentId,
      stage: "enrich-preview",
      stageVersion: "../../judge",
    }),
    false,
  );
  assert.throws(() => showcaseEnrichmentMessage("not-a-uuid"));
});

test("preview failure codes and lease retry delays are safe for private storage", () => {
  assert.equal(
    sanitizeEnrichmentFailureCode("preview_source_hash_mismatch"),
    "preview_source_hash_mismatch",
  );
  assert.equal(
    sanitizeEnrichmentFailureCode("secret details / user source"),
    "preview_enrichment_failed",
  );
  assert.equal(
    enrichmentRetryDelaySeconds(new Date(115_000), 100_000),
    15,
  );
  assert.equal(
    enrichmentRetryDelaySeconds(new Date(99_000), 100_000),
    5,
  );
  assert.equal(
    enrichmentRetryDelaySeconds(new Date(900_000), 100_000),
    300,
  );
});

test("generic preview checks are complete but never become a judge rubric", () => {
  assert.equal(
    PREVIEW_CHECKS.reduce((total, check) => total + check.weightBps, 0),
    10_000,
  );
  assert.deepEqual(
    PREVIEW_CHECKS.map((check) => check.kind),
    [
      "page-load",
      "console-errors",
      "accessibility",
      "performance",
      "frame-rate",
    ],
  );
});

test("preview enrichment has an explicit UTC daily spend cap and stable audit dedupe", () => {
  assert.equal(configuredDailyEnrichmentBudget("31200"), 31_200);
  assert.equal(SHOWCASE_ENRICHMENT_SANDBOX_MAX_DURATION_MS, 120_000);
  assert.equal(projectedEnrichmentAttemptMicrousd(117_000), 3_900);
  assert.equal(isEnrichmentBudgetExhausted(27_300, 3_900, 31_200), false);
  assert.equal(isEnrichmentBudgetExhausted(27_301, 3_900, 31_200), true);
  for (const value of [undefined, "", "0", "-1", "1.5", "1000000001", "nope"]) {
    assert.throws(
      () => configuredDailyEnrichmentBudget(value),
      EnrichmentBudgetConfigurationError,
    );
  }

  const beforeReset = enrichmentBudgetWindow(
    new Date("2026-08-12T23:59:59.999Z"),
  );
  assert.equal(beforeReset.dayStartedAt.toISOString(), "2026-08-12T00:00:00.000Z");
  assert.equal(beforeReset.nextDayStartedAt.toISOString(), "2026-08-13T00:00:00.000Z");
  assert.equal(
    enrichmentBudgetDeferralAuditId(enrichmentId, beforeReset.dayStartedAt),
    enrichmentBudgetDeferralAuditId(
      enrichmentId,
      new Date("2026-08-12T00:00:00.000Z"),
    ),
  );
  assert.notEqual(
    enrichmentBudgetDeferralAuditId(enrichmentId, beforeReset.dayStartedAt),
    enrichmentBudgetDeferralAuditId(enrichmentId, beforeReset.nextDayStartedAt),
  );
  assert.notEqual(
    enrichmentBudgetConfigurationDeferralAuditId(
      enrichmentId,
      beforeReset.dayStartedAt,
    ),
    enrichmentBudgetDeferralAuditId(enrichmentId, beforeReset.dayStartedAt),
  );
});

test("the enrichment core stays independent from runs and the judge budget", async () => {
  const [dataModule, evaluatorModule] = await Promise.all([
    readFile(
      path.join(projectRoot, "lib", "data", "showcase-enrichment.ts"),
      "utf8",
    ),
    readFile(
      path.join(projectRoot, "lib", "evaluation", "showcase-preview.ts"),
      "utf8",
    ),
  ]);
  const implementation = `${dataModule}\n${evaluatorModule}`;
  for (const forbidden of [
    "JUDGE_QUEUE",
    "claimJudgeBudget",
    "enqueueJudge",
    "evaluationVersions",
    "resultConfigurations",
    "runArtifacts",
    "runs.",
  ]) {
    assert.doesNotMatch(implementation, new RegExp(forbidden));
  }
  assert.match(dataModule, /showcase\.preview_enrichment_budget_deferred/);
  assert.match(
    dataModule,
    /showcase\.preview_enrichment_budget_configuration_deferred/,
  );
  assert.match(dataModule, /onConflictDoNothing\(\{ target: auditEvents\.id \}\)/);
  assert.match(dataModule, /status: "queued", leaseExpiresAt: null/);
  assert.match(
    dataModule,
    /eq\(showcaseEnrichments\.status, "queued"\),[\s\S]*?lte\(showcaseEnrichments\.updatedAt, now\)/,
  );
  assert.match(
    dataModule,
    /set\(\{ status: "queued", leaseExpiresAt: null, updatedAt: retryAt \}\)/,
  );
  assert.match(
    dataModule,
    /error instanceof EnrichmentBudgetConfigurationError[\s\S]*?action: "defer"/,
  );
  assert.equal(
    (dataModule.match(/dayStartedAt\.getTime\(\)/g) ?? []).length,
    2,
  );
  assert.equal(
    (dataModule.match(/nextDayStartedAt\.getTime\(\)/g) ?? []).length,
    2,
  );
  assert.match(
    dataModule,
    /count\(\*\) \* \$\{projectedAttemptMicrousd\}[\s\S]*?lease_expires_at > \$\{now\.getTime\(\)\}[\s\S]*?\+ \$\{projectedAttemptMicrousd\} <= \$\{dailyBudgetMicrousd\}/,
  );
  assert.match(
    dataModule,
    /eq\(showcaseEnrichments\.id, enrichmentId\),[\s\S]*?lte\(showcaseEnrichments\.updatedAt, now\),[\s\S]*?eq\(showcaseEnrichments\.status, "queued"\)/,
  );
  assert.match(
    evaluatorModule,
    /sandboxStartedAt = Date\.now\(\)[\s\S]*?durationMs:[\s\S]*?SHOWCASE_ENRICHMENT_SANDBOX_MAX_DURATION_MS/,
  );
});

test("staging and deploy preparation require the enrichment spend cap", async () => {
  const [config, envExample, preflight, prepare] = await Promise.all([
    readFile(path.join(projectRoot, "wrangler.jsonc"), "utf8"),
    readFile(path.join(projectRoot, ".env.example"), "utf8"),
    readFile(path.join(projectRoot, "scripts", "phase2-preflight.mjs"), "utf8"),
    readFile(path.join(projectRoot, "scripts", "prepare-main-deploy.mjs"), "utf8"),
  ]);
  for (const source of [config, envExample, preflight, prepare]) {
    assert.match(source, /BENCHMAX_ENRICHMENT_DAILY_MICROUSD_BUDGET/);
  }
  assert.match(config, /"BENCHMAX_ENRICHMENT_DAILY_MICROUSD_BUDGET": "31200"/);
  assert.match(prepare, /environmentName === "staging"/);
  assert.match(prepare, /environment\.routes\?\.length/);
  assert.equal(
    (preflight.match(/MAX_DAILY_ENRICHMENT_BUDGET_MICROUSD/g) ?? []).length,
    2,
  );
  assert.equal(
    (prepare.match(/MAX_DAILY_ENRICHMENT_BUDGET_MICROUSD/g) ?? []).length,
    2,
  );
});

test("completed derived evidence is served only through every public safety gate", async () => {
  const { env, queries } = derivedArtifactEnv({ includeMetadata: true });
  const response = await usercontentWorker.fetch(
    new Request(
      `https://evidence.benchmax.test/results/example-test/artifacts/${artifactId}`,
    ),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "derived preview");
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.match(response.headers.get("content-security-policy") ?? "", /sandbox/);

  assert.equal(queries.length, 2);
  const sql = queries[1].replace(/\s+/g, " ");
  assert.match(sql, /s\.status = 'published'/);
  assert.match(sql, /s\.safety_status = 'approved'/);
  assert.match(sql, /enrichment\.status = 'completed'/);
  assert.match(sql, /showcase_enrichment_artifacts/);
});

test("derived evidence fails closed without immutable enrichment metadata", async () => {
  const { env } = derivedArtifactEnv({ includeMetadata: false });
  const response = await usercontentWorker.fetch(
    new Request(
      `https://evidence.benchmax.test/results/example-test/artifacts/${artifactId}`,
    ),
    env,
  );
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Not found.");
});

test("the additive migration preserves separate durable enrichment state", async () => {
  const sql = await readFile(
    path.join(projectRoot, "drizzle", "0023_overrated_leader.sql"),
    "utf8",
  );
  assert.match(sql, /CREATE TABLE `showcase_enrichments`/);
  assert.match(sql, /CREATE TABLE `showcase_enrichment_artifacts`/);
  assert.match(sql, /CREATE TABLE `showcase_enrichment_spend_records`/);
  assert.match(sql, /UNIQUE INDEX `showcase_enrichments_showcase_uidx`/);
  assert.match(sql, /'queued', 'running', 'completed', 'failed', 'not_applicable'/);
});

function derivedArtifactEnv(options: { includeMetadata: boolean }) {
  const body = new TextEncoder().encode("derived preview");
  const queries: string[] = [];
  const row = {
    object_key: `enrichments/${enrichmentId}/screenshot.png`,
    kind: "screenshot",
    content_type: "image/png",
    byte_size: body.byteLength,
    sha256,
    origin: "enrichment" as const,
  };
  const env = {
    BENCHMAX_APP_ORIGIN: "https://benchmax.test",
    DB: {
      prepare(sql: string) {
        queries.push(sql);
        return {
          bind() {
            return this;
          },
          async first<T>() {
            return (sql.includes("showcase_enrichment_artifacts")
              ? row
              : null) as T | null;
          },
        };
      },
    } as unknown as D1Database,
    UPLOADS: {
      async get(key: string) {
        if (key !== row.object_key) return null;
        return {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(body);
              controller.close();
            },
          }),
          customMetadata: options.includeMetadata
            ? {
                automatedEnrichment: "true",
                enrichmentId,
                sha256,
              }
            : {},
          httpMetadata: { contentType: row.content_type },
          size: row.byte_size,
        } as unknown as R2ObjectBody;
      },
    } as unknown as R2Bucket,
  } satisfies UsercontentEnv;
  return { env, queries };
}

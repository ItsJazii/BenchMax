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

test("the independent enrichment core has no run, judge, or budget dependency", async () => {
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

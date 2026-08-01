import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { unstable_dev } from "wrangler";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerCli = resolve(projectRoot, "node_modules/wrangler/bin/wrangler.js");
const configPath = resolve(
  projectRoot,
  "tests/fixtures/wrangler.community-lifecycle.jsonc",
);
const workerScript = resolve(
  projectRoot,
  "tests/fixtures/community-lifecycle-worker.ts",
);

test(
  "unknown model result becomes rankable only after publish, judge, and catalog approval",
  async () => {
    const stateDir = mkdtempSync(
      join(tmpdir(), "benchmax-community-lifecycle-"),
    );
    let worker;
    try {
      const migration = spawnSync(
        process.execPath,
        [
          wranglerCli,
          "d1",
          "migrations",
          "apply",
          "DB",
          "--local",
          "--persist-to",
          stateDir,
          "--config",
          configPath,
        ],
        {
          cwd: projectRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            WRANGLER_LOG_PATH: resolve(stateDir, "wrangler.log"),
            WRANGLER_WRITE_LOGS: "false",
          },
          maxBuffer: 10 * 1024 * 1024,
          timeout: 120_000,
        },
      );
      assert.equal(
        migration.status,
        0,
        `${migration.stdout ?? ""}\n${migration.stderr ?? ""}`,
      );

      worker = await unstable_dev(workerScript, {
        config: configPath,
        local: true,
        logLevel: "none",
        persistTo: stateDir,
        vars: {
          BENCHMAX_JUDGE_DAILY_SAMPLE_BUDGET: "100",
          BENCHMAX_JUDGE_INPUT_MICROUSD_PER_MILLION_TOKENS: "1",
          BENCHMAX_JUDGE_OUTPUT_MICROUSD_PER_MILLION_TOKENS: "1",
          JUDGE_API_KEY: "lifecycle-test-key",
        },
      });
      const response = await worker.fetch("http://lifecycle.test/lifecycle");
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));

      assert.deepEqual(body.beforePublish, {
        catalogStatus: "pending",
        requestKind: "model-version",
        requestStatus: "pending",
      });
      assert.deepEqual(body.published, {
        judgeStatus: "queued",
        status: "published",
      });
      assert.deepEqual(body.queued, {
        judgeQueueDeferred: false,
        runStatus: "judging",
      });
      assert.deepEqual(body.judged, {
        evidenceSufficient: true,
        judgeStatus: "scored",
        rankingStatus: "catalog_pending",
        rankEligible: false,
        runStatus: "scored",
        sampleCount: 1,
        scoreBps: 9000,
      });
      assert.equal(body.approvedState.catalogStatus, "canonical");
      assert.match(body.approvedState.modelVersionId, /^model-version-/);
      assert.deepEqual(
        {
          rankEligible: body.approvedState.rankEligible,
          rankingStatus: body.approvedState.rankingStatus,
          requestStatus: body.approvedState.requestStatus,
          runStatus: body.approvedState.runStatus,
        },
        {
          rankEligible: true,
          rankingStatus: "eligible",
          requestStatus: "mapped",
          runStatus: "scored",
        },
      );

      // Sweep end-to-end coverage against the same migrated database:
      // terminally failed results must never be re-selected by the top-ten
      // sweep, and frozen-evaluation disputes must terminate instead of loop.
      const sweepResponse = await worker.fetch("http://lifecycle.test/sweeps");
      const sweeps = await sweepResponse.json();
      assert.equal(sweepResponse.status, 200, JSON.stringify(sweeps));
      assert.deepEqual(sweeps.firstTopTen, [
        "sweep-frozen-topten-run",
        "sweep-live-run",
      ]);
      assert.ok(
        !sweeps.secondTopTen.includes("sweep-failed-run"),
        "terminally failed run re-selected by the top-ten sweep",
      );
      assert.ok(
        !sweeps.secondTopTen.includes("sweep-frozen-topten-run"),
        "frozen-evaluation top-ten run with a scored showcase re-selected after termination",
      );
      assert.equal(sweeps.failedShowcaseJudgeStatus, "failed");
      assert.equal(sweeps.frozenTopTenShowcaseJudgeStatus, "failed");
      assert.equal(sweeps.frozenTopTenRunStatus, "evaluation_failed");
      assert.deepEqual(sweeps.firstDispute, ["sweep-dispute-run"]);
      assert.deepEqual(
        sweeps.secondDispute,
        [],
        "frozen-evaluation dispute did not terminate after one sweep pass",
      );
      assert.equal(sweeps.disputeShowcaseJudgeStatus, "failed");
      assert.equal(sweeps.disputeRunStatus, "evaluation_failed");
    } finally {
      if (worker) await worker.stop();
      try {
        rmSync(stateDir, {
          force: true,
          maxRetries: 10,
          recursive: true,
          retryDelay: 250,
        });
      } catch (error) {
        console.warn(
          `community-lifecycle: temp state dir not removed (${error?.code ?? error})`,
        );
      }
    }
  },
);

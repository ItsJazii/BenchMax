import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const wranglerCli = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);
const port = 4300 + (process.pid % 500);
const baseUrl = `http://127.0.0.1:${port}`;
let server;
let serverOutput = "";
let stateDir;

before(async () => {
  stateDir = mkdtempSync(join(tmpdir(), "benchmax-rendered-html-"));
  const migration = spawnSync(
    process.execPath,
    [
      wranglerCli,
      "d1",
      "migrations",
      "apply",
      "DB",
      "--config",
      "dist/server/wrangler.json",
      "--local",
      "--persist-to",
      stateDir,
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: join(stateDir, "wrangler-migrations.log"),
        WRANGLER_WRITE_LOGS: "false",
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  const migrationOutput = `${migration.stdout ?? ""}\n${migration.stderr ?? ""}`;
  assert.equal(
    migration.status,
    0,
    `Failed to migrate the rendered-test D1 state.\n${migrationOutput}`,
  );

  server = spawn(
    process.execPath,
    [
      wranglerCli,
      "dev",
      "--config",
      "dist/server/wrangler.json",
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
      "--local",
      "--persist-to",
      stateDir,
      "--log-level",
      "error",
      "--show-interactive-dev-session=false",
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: join(stateDir, "wrangler-dev.log"),
        WRANGLER_WRITE_LOGS: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Production server exited early.\n${serverOutput}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The port is not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Production server did not start.\n${serverOutput}`);
});

after(async () => {
  if (server && server.exitCode === null) {
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 5_000);
      server.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      if (process.platform === "win32" && server.pid) {
        const termination = spawnSync(
          "taskkill.exe",
          ["/pid", String(server.pid), "/T", "/F"],
          {
            encoding: "utf8",
            windowsHide: true,
          },
        );
        if (termination.status !== 0 && server.exitCode === null) {
          server.kill();
        }
      } else {
        server.kill();
      }
    });
  }
  if (stateDir) {
    try {
      rmSync(stateDir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 250,
      });
    } catch (error) {
      // On Windows the killed server can hold handles in the temp state dir
      // past our retries; the OS temp cleaner will remove it. Assertions have
      // already run, so a failed cleanup must not fail the suite.
      console.warn(`rendered-html: temp state dir not removed (${error?.code ?? error})`);
    }
  }
});

async function render(path = "/", init = {}) {
  return fetch(`${baseUrl}${path}`, {
    headers: { accept: "text/html", ...init.headers },
    ...init,
  });
}

function assertSecurityHeaders(response, defaultSource = "'self'") {
  const csp = response.headers.get("content-security-policy") ?? "";
  assert.match(csp, new RegExp(`default-src ${defaultSource}`));
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
}

test("root and /tests server-render the All Tests public feed", async () => {
  const [home, testsPage] = await Promise.all([render(), render("/tests")]);
  for (const response of [home, testsPage]) {
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    assertSecurityHeaders(response);
    const html = await response.text();
    assert.match(html, /<title>(?:All Tests[^<]*|Benchmax[^<]*)<\/title>/i);
    assert.match(html, /ALL TESTS/i);
    assert.match(html, /See what people tested and what the model produced/i);
    assert.match(html, /Safe Tests appear here as Awaiting review/i);
    assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
  }
});

test("Submit Test renders the free-text setup and publish-before-review flow", async () => {
  const response = await render("/submit");
  assert.equal(response.status, 200);
  assertSecurityHeaders(response);
  const html = await response.text();
  const wizardAsset = html.match(
    /href="(\/assets\/UploadWizard-[^"]+\.js)"/i,
  )?.[1];
  assert.ok(wizardAsset, "Submit Test must ship the upload wizard client bundle.");
  const wizardResponse = await fetch(`${baseUrl}${wizardAsset}`);
  assert.equal(wizardResponse.status, 200);
  const shippedSubmitSurface = `${html}\n${await wizardResponse.text()}`;
  for (const phrase of [
    "Prompt",
    "Model family",
    "Exact model version",
    "Harness or tool",
    "Reasoning",
  ]) {
    assert.match(shippedSubmitSurface, new RegExp(phrase, "i"));
  }
  assert.match(html, /Safe Tests publish as\s*(?:<!-- -->)?\s*Awaiting review/i);
  assert.match(
    shippedSubmitSurface,
    /Your safe Test appears immediately as Awaiting review/i,
  );
});

test("Models groups declared names and fails honestly when the catalog is empty", async () => {
  const response = await render("/models");
  assert.equal(response.status, 200);
  assertSecurityHeaders(response);
  const html = await response.text();
  assert.match(html, /Tests grouped by declared model/i);
  assert.match(html, /not independently verified/i);
  assert.match(
    html,
    /No public Tests yet|Models are temporarily unavailable/i,
  );
  assert.doesNotMatch(
    html,
    /Opus 4\.6|GPT coding model|@maya|@niko|2h ago|Yesterday/,
  );
});

test("Leaderboards ships an honest no-ranking-yet state", async () => {
  const response = await render("/leaderboards");
  assert.equal(response.status, 200);
  assertSecurityHeaders(response);
  const html = await response.text();
  assert.match(html, /Rankings come after trustworthy reviews/i);
  assert.match(html, /No ranked Tests yet/i);
  assert.match(html, /top-rated submissions across different prompts/i);
  assert.match(html, /not a scientific like-for-like model benchmark/i);
});

test("Methodology states the safety, enrichment, and additive-review contract", async () => {
  const response = await render("/methodology");
  assert.equal(response.status, 200);
  assertSecurityHeaders(response);
  const html = await response.text();
  assert.match(html, /Mandatory evidence checks happen before publication/i);
  assert.match(html, /A safe Test becomes public as Awaiting review/i);
  assert.match(html, /Compatible source ZIPs receive non-blocking enrichment/i);
  assert.match(html, /Enrichment failure never removes the Test/i);
  assert.match(html, /Reviews add context without changing the submission/i);
  assert.match(html, /Declared by contributor\s*(?:<!-- -->)?\s*—\s*(?:<!-- -->)?\s*not independently verified/i);
});

for (const [path, phrase] of [
  ["/tests", "See what people tested"],
  ["/models", "Tests grouped by declared model"],
  ["/methodology", "Publish the evidence. Review it later"],
  ["/submit", "Share the Test you ran"],
  ["/security", "Untrusted by default"],
  ["/report", "Report unsafe or dishonest content"],
  ["/leaderboards", "Rankings come after trustworthy reviews"],
  ["/dashboard", "Your Tests"],
  ["/terms", "Rights before reach"],
  ["/privacy", "Public evidence, minimal account data"],
  ["/proposals/new", "Propose the next benchmark"],
  ["/disputes/new", "Challenge a benchmark run"],
  ["/moderation", "Moderation queue"],
  ["/operations", "Pipeline health and review state"],
]) {
  test(`server-renders ${path}`, async () => {
    const response = await render(path);
    assert.equal(response.status, 200);
    assertSecurityHeaders(response);
    assert.match(await response.text(), new RegExp(phrase, "i"));
  });
}

test("empty public feed never renders fabricated evidence or legacy workflow copy", async () => {
  const [home, models, testsPage, submit, methodology] = await Promise.all([
    render("/"),
    render("/models"),
    render("/tests"),
    render("/submit"),
    render("/methodology"),
  ]);
  for (const response of [home, models, testsPage, submit, methodology]) {
    assert.equal(response.status, 200);
    assertSecurityHeaders(response);
  }

  const homeHtml = await home.text();
  const modelsHtml = await models.text();
  const testsHtml = await testsPage.text();
  const submitHtml = await submit.text();
  const methodologyHtml = await methodology.text();
  const publicHtml = `${homeHtml}\n${modelsHtml}\n${testsHtml}`;
  const coreHtml = `${publicHtml}\n${submitHtml}\n${methodologyHtml}`;

  assert.doesNotMatch(
    publicHtml,
    /Opus 4\.6|GPT coding model|@maya|@niko|2h ago|Yesterday/,
  );
  assert.match(modelsHtml, /No public Tests yet|temporarily unavailable/i);
  assert.match(testsHtml, /No public Tests yet|temporarily unavailable/i);
  assert.doesNotMatch(
    coreHtml,
    /Add the tests that matter|Turn a real prompt into a shared benchmark|Choose a frozen test|frozen prompt|approve (?:the )?rubric|pending AI review|AI judging and ranking may take up to 24 hours|review target:\s*24 hours|One leaderboard per test/i,
  );
});

test("All Tests pagination preserves model, harness, query, and status filters", async () => {
  const response = await render(
    "/tests?page=2&model=example&harness=cursor&q=needle&status=ranked",
  );
  assert.equal(response.status, 200);
  assertSecurityHeaders(response);

  const html = await response.text();
  assert.match(html, /page\s*(?:<!-- -->)?\s*2/i);
  assert.match(html, /rel="prev"/i);
  assert.match(
    html,
    /href="\/tests\?harness=cursor(?:&|&amp;)model=example(?:&|&amp;)q=needle(?:&|&amp;)status=ranked"/i,
  );
});

test("legacy discovery and detail routes redirect to canonical Tests URLs", async () => {
  for (const [path, pathname] of [
    ["/explore?model=example&harness=cursor", "/tests"],
    ["/results/example-test?view=evidence", "/tests/example-test"],
    ["/showcases/example-test", "/tests/example-test"],
  ]) {
    const response = await render(path, { redirect: "manual" });
    assert.equal(response.status, 308);
    assertSecurityHeaders(response);
    const location = response.headers.get("location");
    assert.ok(location);
    assert.equal(new URL(location, baseUrl).pathname, pathname);
  }
});

test("unknown result and contributor records return 404", async () => {
  for (const path of [
    "/results/not-a-real-public-record",
    "/runs/not-a-real-public-record",
    "/contributors/not-a-real-contributor",
  ]) {
    const response = await render(path);
    assert.equal(response.status, 404);
    assertSecurityHeaders(response);
  }
});

test("unknown public result API records fail closed as JSON", async () => {
  const response = await render("/api/public/results/not-a-real-public-record", {
    headers: { accept: "application/json" },
  });
  assert.equal(response.status, 404);
  assertSecurityHeaders(response, "'none'");
  assert.deepEqual(await response.json(), { error: "Result not found." });
});

test("public artifact downloads fail closed without a valid published run", async () => {
  const response = await render(
    "/api/public/runs/not-a-run/artifacts/not-an-artifact",
    { headers: { accept: "application/octet-stream" } },
  );
  const body = await response.text();
  assert.equal(response.status, 404, `${body}\n${serverOutput}`);
  assertSecurityHeaders(response);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body, "Not found.");
});

test("main app artifact compatibility route redirects to the cookieless origin", async () => {
  const artifactId = "01234567-89ab-cdef-0123-456789abcdef";
  const response = await render(
    `/api/public/results/example-result/artifacts/${artifactId}`,
    {
      headers: { accept: "application/octet-stream" },
      redirect: "manual",
    },
  );
  const configuredOrigin = process.env.NEXT_PUBLIC_USERCONTENT_ORIGIN;
  if (configuredOrigin) {
    assert.equal(response.status, 307);
    assert.equal(
      response.headers.get("location"),
      `${configuredOrigin}/results/example-result/artifacts/${artifactId}`,
    );
    assert.equal(await response.text(), "");
  } else {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("location"), null);
    assert.equal(await response.text(), "User-content origin unavailable.");
  }
});

test("write API fails closed when authentication is not configured", async () => {
  const response = await render("/api/reports", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      url: "https://benchmax.test/results/example",
      reason: "fraud",
      details: "This report contains enough detail.",
    }),
  });
  assert.equal(response.status, 401);
  assertSecurityHeaders(response, "'none'");
  assert.deepEqual(await response.json(), { error: "Authentication required." });
});

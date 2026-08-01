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

test("server-renders the Benchmax public home with the publication and judge states visible", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assertSecurityHeaders(response);

  const html = await response.text();
  assert.match(html, /<title>Benchmax[^<]*<\/title>/i);
  assert.match(html, /Share what a model/);
  assert.match(html, /actually produced/);
  assert.match(html, /Visible before ranking/);
  assert.match(html, /Publish first\. Judge carefully/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
});

test("public trust copy states declared provenance and best-of-N risk", async () => {
  const [leaderboards, methodology, models] = await Promise.all([
    render("/leaderboards"),
    render("/methodology"),
    render("/models"),
  ]);
  for (const response of [leaderboards, methodology, models]) {
    assert.equal(response.status, 200);
    assertSecurityHeaders(response);
  }
  assert.match(await leaderboards.text(), /declared, unverified/i);
  const methodologyHtml = await methodology.text();
  assert.match(methodologyHtml, /declared,\s*(?:<!-- -->)?\s*unverified/i);
  assert.match(methodologyHtml, /best-of-N cherry-picking/i);
  assert.match(await models.text(), /declared, unverified/i);
});

for (const [path, phrase] of [
  ["/explore", "Every submitted result stays visible"],
  ["/tests", "Add the tests that matter"],
  ["/benchmarks", "Add the tests that matter"],
  ["/models", "A model name is not a configuration"],
  ["/methodology", "Evidence first. Ranking second"],
  ["/submit", "Put your model test result on the record"],
  ["/upload", "Put your model test result on the record"],
  ["/security", "Untrusted by default"],
  ["/report", "Report unsafe or dishonest content"],
  ["/leaderboards", "One leaderboard per test"],
  ["/compare", "One leaderboard per test"],
  ["/run", "Put your model test result on the record"],
  ["/dashboard", "Your tests and submitted results"],
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

test("empty public catalogs never render fabricated evidence or launch counts", async () => {
  const [home, explore, models, testsPage] = await Promise.all([
    render("/"),
    render("/explore"),
    render("/models"),
    render("/tests"),
  ]);
  for (const response of [home, explore, models, testsPage]) {
    assert.equal(response.status, 200);
    assertSecurityHeaders(response);
  }

  const homeHtml = await home.text();
  const exploreHtml = await explore.text();
  const modelsHtml = await models.text();
  const testsHtml = await testsPage.text();
  const publicHtml = `${homeHtml}\n${exploreHtml}\n${modelsHtml}`;

  assert.doesNotMatch(
    publicHtml,
    /Opus 4\.6|GPT coding model|@maya|@niko|2h ago|Yesterday/,
  );
  assert.doesNotMatch(testsHtml, /[45] launch definitions/);
  assert.match(
    modelsHtml,
    /No eligible configuration summaries yet|configuration summaries are temporarily unavailable/i,
  );
  assert.match(testsHtml, /Turn a real prompt into a shared benchmark/i);
});

test("explore pagination preserves active filters in page links", async () => {
  const response = await render(
    "/explore?page=2&model=example&q=needle&status=ranked",
  );
  assert.equal(response.status, 200);
  assertSecurityHeaders(response);

  const html = await response.text();
  assert.match(html, /page\s*(?:<!-- -->)?\s*2/i);
  assert.match(html, /rel="prev"/i);
  assert.match(
    html,
    /href="\/explore\?model=example(?:&|&amp;)q=needle(?:&|&amp;)status=ranked"/i,
  );
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

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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

before(async () => {
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
      ".wrangler/test-state",
      "--log-level",
      "error",
      "--show-interactive-dev-session=false",
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: ".wrangler/test.log",
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

after(() => {
  server?.kill();
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

test("server-renders the Benchmax public home with the trust boundary visible", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assertSecurityHeaders(response);

  const html = await response.text();
  assert.match(html, /<title>Benchmax[^<]*<\/title>/i);
  assert.match(html, /See what models/);
  assert.match(html, /actually built/);
  assert.match(html, /Community showcase/);
  assert.match(html, /Not ranked/);
  assert.match(html, /Rankings without the hand-waving/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
});

for (const [path, phrase] of [
  ["/explore", "Explore what models built"],
  ["/benchmarks", "A benchmark is a contract"],
  ["/models", "Models are versions, not vibes"],
  ["/methodology", "Trust comes from the protocol"],
  ["/upload", "Put your model test on the record"],
  ["/security", "Untrusted by default"],
  ["/report", "Report unsafe or dishonest content"],
  ["/leaderboards", "Frontend leaderboard"],
  ["/compare", "Compare like with like"],
  ["/run", "Launch one honest attempt"],
  ["/dashboard", "Your tests and runs"],
  ["/terms", "Rights before reach"],
  ["/privacy", "The key is not a record"],
  ["/proposals/new", "Propose the next benchmark"],
  ["/disputes/new", "Challenge a benchmark run"],
  ["/moderation", "Moderation queue"],
  ["/operations", "Pipeline health and spend"],
]) {
  test(`server-renders ${path}`, async () => {
    const response = await render(path);
    assert.equal(response.status, 200);
    assertSecurityHeaders(response);
    assert.match(await response.text(), new RegExp(phrase, "i"));
  });
}

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

test("write API fails closed when authentication is not configured", async () => {
  const response = await render("/api/reports", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      url: "https://benchmax.test/showcases/example",
      reason: "fraud",
      details: "This report contains enough detail.",
    }),
  });
  assert.equal(response.status, 401);
  assertSecurityHeaders(response, "'none'");
  assert.deepEqual(await response.json(), { error: "Authentication required." });
});

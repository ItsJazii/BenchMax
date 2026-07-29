import { spawn } from "node:child_process";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import axe from "axe-core";

const inputDir = "/workspace/input";
const outputDir = "/workspace/output";
const projectDir = "/workspace/project";
const reportPath = `${outputDir}/report.json`;
const screenshotPath = `${outputDir}/milestone.png`;
const spec = JSON.parse(await readFile(`${inputDir}/spec.json`, "utf8"));
const server = spawn(
  "python3",
  ["-m", "http.server", "4173", "--bind", "127.0.0.1", "--directory", projectDir],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let serverLog = "";
server.stdout.on("data", (chunk) => (serverLog += chunk.toString()));
server.stderr.on("data", (chunk) => (serverLog += chunk.toString()));

const checks = new Map();
const consoleErrors = [];
const interactionFailures = [];
let browser;
let pageLoadMs = null;
let accessibilityCritical = null;
let sampledFps = null;

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: spec.viewport,
    serviceWorkers: "block",
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.port === "4173"
    ) {
      await route.continue();
    } else {
      await route.abort("blockedbyclient");
    }
  });
  await context.addInitScript(
    ({ fixedClock, seed }) => {
      const fixed = new Date(fixedClock).getTime();
      const RealDate = Date;
      class FixedDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [fixed]));
        }
        static now() {
          return fixed;
        }
      }
      Object.defineProperty(globalThis, "Date", { value: FixedDate });
      let state = seed >>> 0;
      Math.random = () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
      };
    },
    { fixedClock: spec.fixedClock, seed: spec.seed },
  );
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500));
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message.slice(0, 500));
  });

  const startedAt = performance.now();
  const response = await page.goto("http://127.0.0.1:4173/index.html", {
    waitUntil: "networkidle",
    timeout: 15_000,
  });
  pageLoadMs = Math.round(performance.now() - startedAt);
  checks.set("page-load", Boolean(response?.ok()));

  for (const step of spec.interactionSteps) {
    try {
      const locator = page.locator(step.target).first();
      if (step.action === "assert-visible") {
        await locator.waitFor({ state: "visible", timeout: 5_000 });
      } else if (step.action === "click") {
        await locator.click({ timeout: 5_000 });
      } else if (step.action === "fill") {
        await locator.fill(step.value ?? "", { timeout: 5_000 });
      } else if (step.action === "press") {
        await locator.press(step.value ?? "Enter", { timeout: 5_000 });
      }
    } catch {
      interactionFailures.push(`${step.action}:${step.target}`);
    }
  }
  await page.screenshot({ path: screenshotPath, fullPage: true });
  sampledFps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        const started = performance.now();
        const sample = (now) => {
          frames += 1;
          if (now - started >= 2000) {
            resolve(Math.round((frames * 1000) / (now - started)));
          } else {
            requestAnimationFrame(sample);
          }
        };
        requestAnimationFrame(sample);
      }),
  );
  await page.addScriptTag({ content: axe.source });
  const axeResult = await page.evaluate(async () => globalThis.axe.run(document));
  accessibilityCritical = axeResult.violations.filter(
    (violation) => violation.impact === "critical",
  ).length;
  checks.set("console-errors", consoleErrors.length === 0);
  checks.set("accessibility-critical", accessibilityCritical === 0);
  for (const check of spec.checks) {
    if (check.kind === "interaction") {
      checks.set(check.key, interactionFailures.length === 0);
    }
  }
} catch (error) {
  checks.set("page-load", false);
  consoleErrors.push(
    error instanceof Error ? error.message.slice(0, 500) : "evaluation_error",
  );
} finally {
  await browser?.close().catch(() => undefined);
  server.kill("SIGTERM");
}

const bundleBytes = await directoryBytes(projectDir);
for (const check of spec.checks) {
  if (check.kind === "bundle-size") {
    checks.set(check.key, bundleBytes <= check.threshold);
  }
  if (check.kind === "performance") {
    checks.set(
      check.key,
      pageLoadMs !== null && pageLoadMs <= check.threshold,
    );
  }
  if (check.kind === "frame-rate") {
    checks.set(
      check.key,
      sampledFps !== null && sampledFps >= check.threshold,
    );
  }
}

const objectiveResults = spec.checks.map((check) => {
  const passed = checks.get(check.key) === true;
  let metric = { passed };
  if (check.kind === "console-errors") metric = { passed, consoleErrors };
  if (check.kind === "accessibility") {
    metric = { passed, criticalViolations: accessibilityCritical };
  }
  if (check.kind === "performance") metric = { passed, pageLoadMs };
  if (check.kind === "bundle-size") metric = { passed, bundleBytes };
  if (check.kind === "interaction") {
    metric = { passed, failures: interactionFailures };
  }
  if (check.kind === "frame-rate") metric = { passed, sampledFps };
  return {
    checkKey: check.key,
    kind: check.kind,
    status: passed ? "pass" : "fail",
    scoreBps: passed ? 10_000 : 0,
    weightBps: check.weightBps,
    metric,
  };
});
const weightedScoreBps = Math.round(
  objectiveResults.reduce(
    (sum, result) => sum + result.scoreBps * result.weightBps,
    0,
  ) / 10_000,
);
await writeFile(
  reportPath,
  JSON.stringify({
    protocolVersion: "frontend-static-evaluator-v1",
    environmentHash: spec.environmentHash,
    objectiveResults,
    weightedScoreBps,
    consoleErrors,
    serverLog: serverLog.slice(0, 20_000),
  }),
);

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:4173/index.html");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Local evaluator server did not become ready.");
}

async function directoryBytes(path) {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) total += await directoryBytes(child);
    else if (entry.isFile()) total += (await stat(child)).size;
  }
  return total;
}

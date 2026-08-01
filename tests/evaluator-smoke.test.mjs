import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const evaluatorDir = path.join(projectRoot, "sandbox", "browser-web-v1");
const evaluatorPath = path.join(evaluatorDir, "evaluate.mjs");
const fixtureDir = path.join(projectRoot, "tests", "fixtures", "evaluator-project");

test("the frozen browser evaluator executes a fixture project end to end", async (t) => {
  const prerequisites = await resolveEvaluatorPrerequisites();
  if (!prerequisites.ok) {
    const message = [
      "Evaluator smoke prerequisites are unavailable.",
      ...prerequisites.missing.map((item) => `- ${item}`),
      "Run npm ci in sandbox/browser-web-v1 and npx playwright install chromium ffmpeg.",
    ].join("\n");
    if (process.env.BENCHMAX_REQUIRE_EVALUATOR_SMOKE === "1") {
      assert.fail(message);
    }
    t.skip(message);
    return;
  }

  const workspace = await mkdtemp(path.join(os.tmpdir(), "benchmax-evaluator-"));
  const inputDir = path.join(workspace, "input");
  const outputDir = path.join(workspace, "output");
  const projectDir = path.join(workspace, "project");
  await Promise.all([
    mkdir(inputDir, { recursive: true }),
    mkdir(outputDir, { recursive: true }),
    cp(fixtureDir, projectDir, { recursive: true }),
  ]);

  const templateBuildHash = "a".repeat(64);
  await writeFile(
    path.join(inputDir, "spec.json"),
    JSON.stringify({
      checks: [
        { key: "page-load", kind: "page-load", weightBps: 2_500 },
        { key: "console-errors", kind: "console-errors", weightBps: 2_500 },
        {
          key: "accessibility-critical",
          kind: "accessibility",
          threshold: 0,
          weightBps: 2_500,
        },
        { key: "fixture-flow", kind: "interaction", weightBps: 2_500 },
      ],
      fixedClock: "2026-07-29T09:00:00.000Z",
      interactionSteps: [
        { action: "assert-visible", target: "#intentionally-missing" },
        { action: "assert-visible", target: "#verify" },
        { action: "click", target: "#verify" },
        { action: "assert-visible", target: "[data-verified=true]" },
      ],
      seed: 41021,
      viewport: { width: 1280, height: 800 },
    }),
  );

  const port = await reservePort();
  try {
    const result = await runEvaluator({
      BENCHMAX_CHROMIUM_EXECUTABLE_PATH: prerequisites.executablePath,
      BENCHMAX_EVALUATOR_TEMPLATE_BUILD_HASH: templateBuildHash,
      BENCHMAX_EVALUATOR_PORT: String(port),
      BENCHMAX_EVALUATOR_WORKSPACE: workspace,
      BENCHMAX_FFMPEG: prerequisites.ffmpegPath,
      BENCHMAX_PYTHON: prerequisites.pythonCommand,
    });
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(
      await readFile(path.join(outputDir, "report.json"), "utf8"),
    );
    assert.equal(report.templateBuildHash, templateBuildHash);
    assert.equal(
      report.weightedScoreBps,
      9_375,
      JSON.stringify(report, null, 2),
    );
    assert.deepEqual(
      report.objectiveResults.map((item) => [item.checkKey, item.status]),
      [
        ["page-load", "pass"],
        ["console-errors", "pass"],
        ["accessibility-critical", "pass"],
        ["fixture-flow", "fail"],
      ],
    );
    const interaction = report.objectiveResults.find(
      (item) => item.checkKey === "fixture-flow",
    );
    assert.equal(interaction.scoreBps, 7_500);
    assert.equal(interaction.metric.passedSteps, 3);
    assert.equal(interaction.metric.totalSteps, 4);
    assert.deepEqual(
      interaction.metric.steps.map((step) => step.status),
      ["fail", "pass", "pass", "pass"],
    );
    const consoleCheck = report.objectiveResults.find(
      (item) => item.checkKey === "console-errors",
    );
    assert.match(consoleCheck.metric.pageText, /Verified/);
    assert.equal(
      consoleCheck.metric.pageTitle,
      "Benchmax evaluator fixture",
    );
    assert.equal((await stat(path.join(outputDir, "milestone.png"))).size > 0, true);
    assert.equal((await stat(path.join(outputDir, "milestone.webm"))).size > 0, true);
    assert.equal(report.videoCaptureMs, 5_000);
    assert.equal(Math.abs(report.videoDurationMs - 5_000) <= 50, true);
  } finally {
    await rm(workspace, {
      force: true,
      maxRetries: 8,
      recursive: true,
      retryDelay: 125,
    });
  }
});

test("the evaluator bounds a page that stalls frame sampling", async (t) => {
  const prerequisites = await resolveEvaluatorPrerequisites();
  if (!prerequisites.ok) {
    const message = [
      "Evaluator smoke prerequisites are unavailable.",
      ...prerequisites.missing.map((item) => `- ${item}`),
    ].join("\n");
    if (process.env.BENCHMAX_REQUIRE_EVALUATOR_SMOKE === "1") {
      assert.fail(message);
    }
    t.skip(message);
    return;
  }

  const workspace = await mkdtemp(path.join(os.tmpdir(), "benchmax-stalled-raf-"));
  const inputDir = path.join(workspace, "input");
  const outputDir = path.join(workspace, "output");
  const projectDir = path.join(workspace, "project");
  await Promise.all([
    mkdir(inputDir, { recursive: true }),
    mkdir(outputDir, { recursive: true }),
    mkdir(projectDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(projectDir, "index.html"),
      [
        "<!doctype html><html><head><title>Stalled frame fixture</title></head>",
        "<body><main>Rendered, but animation frames are stalled.</main>",
        "<script>window.requestAnimationFrame = () => 0;</script></body></html>",
      ].join(""),
    ),
    writeFile(
      path.join(inputDir, "spec.json"),
      JSON.stringify({
        checks: [
          { key: "page-load", kind: "page-load", weightBps: 5_000 },
          {
            key: "frame-rate",
            kind: "frame-rate",
            threshold: 30,
            weightBps: 5_000,
          },
        ],
        fixedClock: "2026-07-29T09:00:00.000Z",
        interactionSteps: [],
        seed: 41021,
        viewport: { width: 1280, height: 800 },
      }),
    ),
  ]);

  const port = await reservePort();
  try {
    const result = await runEvaluator(
      {
        BENCHMAX_CHROMIUM_EXECUTABLE_PATH: prerequisites.executablePath,
        BENCHMAX_EVALUATOR_TEMPLATE_BUILD_HASH: "b".repeat(64),
        BENCHMAX_EVALUATOR_PORT: String(port),
        BENCHMAX_EVALUATOR_WORKSPACE: workspace,
        BENCHMAX_FFMPEG: prerequisites.ffmpegPath,
        BENCHMAX_PYTHON: prerequisites.pythonCommand,
      },
      30_000,
    );
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(
      await readFile(path.join(outputDir, "report.json"), "utf8"),
    );
    const frameRate = report.objectiveResults.find(
      (item) => item.checkKey === "frame-rate",
    );
    assert.equal(frameRate.status, "fail");
    assert.equal(frameRate.scoreBps, 0);
    assert.equal(frameRate.metric.sampledFps, 0);
    assert.ok(
      report.consoleErrors.includes("frame_rate:frame_rate_timeout"),
      JSON.stringify(report, null, 2),
    );
  } finally {
    await rm(workspace, {
      force: true,
      maxRetries: 8,
      recursive: true,
      retryDelay: 125,
    });
  }
});

async function resolveEvaluatorPrerequisites() {
  const missing = [];
  const playwrightPath = path.join(evaluatorDir, "node_modules", "playwright");
  try {
    await stat(playwrightPath);
  } catch {
    missing.push("Evaluator npm dependencies are missing.");
    return { missing, ok: false };
  }

  let executablePath = process.env.BENCHMAX_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (!executablePath) {
    try {
      const playwright = await import(
        pathToFileURL(path.join(playwrightPath, "index.mjs")).href
      );
      executablePath = playwright.chromium.executablePath();
    } catch {
      missing.push("Playwright Chromium could not be resolved.");
    }
  }
  if (executablePath) {
    try {
      await stat(executablePath);
    } catch {
      missing.push(`Playwright Chromium is missing at ${executablePath}.`);
    }
  }

  const pythonCommand = await resolveCommand([
    process.env.BENCHMAX_PYTHON,
    process.platform === "win32" ? "python" : "python3",
    process.platform === "win32" ? "python3" : "python",
  ]);
  if (!pythonCommand) missing.push("Python 3 is not available on PATH.");

  const ffmpegPath = await resolveFfmpegPath();
  if (!ffmpegPath) missing.push("Playwright FFmpeg is not installed.");

  return missing.length > 0
    ? { missing, ok: false }
    : {
        executablePath,
        ffmpegPath,
        missing,
        ok: true,
        pythonCommand,
      };
}

async function resolveFfmpegPath() {
  const configured = process.env.BENCHMAX_FFMPEG?.trim();
  if (configured) {
    try {
      await stat(configured);
      return configured;
    } catch {
      return null;
    }
  }
  const browserRegistry = JSON.parse(
    await readFile(
      path.join(
        evaluatorDir,
        "node_modules",
        "playwright-core",
        "browsers.json",
      ),
      "utf8",
    ),
  );
  const revision = browserRegistry.browsers.find(
    (browser) => browser.name === "ffmpeg",
  )?.revision;
  if (!revision) return null;
  const cacheRoot = resolvePlaywrightCacheRoot();
  const executableName =
    process.platform === "win32"
      ? "ffmpeg-win64.exe"
      : process.platform === "darwin"
        ? "ffmpeg-mac"
        : "ffmpeg-linux";
  const executablePath = path.join(
    cacheRoot,
    `ffmpeg-${revision}`,
    executableName,
  );
  try {
    await stat(executablePath);
    return executablePath;
  } catch {
    return (await resolveCommand(["ffmpeg"])) ?? null;
  }
}

function resolvePlaywrightCacheRoot() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    return process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
      "ms-playwright",
    );
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  }
  return path.join(os.homedir(), ".cache", "ms-playwright");
}

async function resolveCommand(candidates) {
  for (const command of [...new Set(candidates.filter(Boolean))]) {
    const result = await probeCommand(command);
    if (result) return command;
  }
  return null;
}

function probeCommand(command) {
  return new Promise((resolve) => {
    const child = spawn(command, ["--version"], {
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

function runEvaluator(environment, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [evaluatorPath], {
      cwd: evaluatorDir,
      env: Object.fromEntries(
        Object.entries({ ...process.env, ...environment }).filter(
          ([, value]) => value !== undefined,
        ),
      ),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Evaluator exceeded ${timeoutMs}ms.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stderr, stdout });
    });
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port === null) reject(new Error("Could not reserve a test port."));
        else resolve(port);
      });
    });
  });
}

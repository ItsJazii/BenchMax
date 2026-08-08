import { spawn } from "node:child_process";
import { readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import axe from "axe-core";

const VIDEO_CAPTURE_MS = 5_000;
const VIDEO_DURATION_TOLERANCE_MS = 50;
const IN_PAGE_OPERATION_TIMEOUT_MS = 5_000;
const workspaceDir = process.env.BENCHMAX_EVALUATOR_WORKSPACE || "/workspace";
const inputDir = `${workspaceDir}/input`;
const outputDir = `${workspaceDir}/output`;
const projectDir = `${workspaceDir}/project`;
const reportPath = `${outputDir}/report.json`;
const screenshotPath = `${outputDir}/milestone.png`;
const videoPath = `${outputDir}/milestone.webm`;
const rawVideoPath = `${outputDir}/milestone.raw.webm`;
const serverPort = parseServerPort(process.env.BENCHMAX_EVALUATOR_PORT);
const serverOrigin = `http://127.0.0.1:${serverPort}`;
const chromiumExecutablePath =
  process.env.BENCHMAX_CHROMIUM_EXECUTABLE_PATH ||
  ((await stat("/usr/local/bin/benchmax-chromium").catch(() => null))?.isFile()
    ? "/usr/local/bin/benchmax-chromium"
    : undefined);
const spec = JSON.parse(await readFile(`${inputDir}/spec.json`, "utf8"));
const templateBuildHash = await readTemplateBuildHash();
const server = spawn(
  process.env.BENCHMAX_PYTHON || "python3",
  [
    "-m",
    "http.server",
    String(serverPort),
    "--bind",
    "127.0.0.1",
    "--directory",
    projectDir,
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let serverLog = "";
server.stdout.on("data", (chunk) => (serverLog += chunk.toString()));
server.stderr.on("data", (chunk) => (serverLog += chunk.toString()));

const checkOutcomes = new Map();
const consoleErrors = [];
const interactionResults = [];
let browser;
let context;
let recordedVideo;
let pageLoadMs = null;
let accessibilityCritical = null;
let sampledFps = null;
let pageRuntimeStarted = false;
let pageText = "";
let pageTitle = "";
let captureWindowCompleted = false;
let videoDurationMs = null;

try {
  await waitForServer();
  browser = await chromium.launch({
    executablePath: chromiumExecutablePath,
    headless: true,
  });
  context = await browser.newContext({
    recordVideo: {
      dir: `${outputDir}/video`,
      size: spec.viewport,
    },
    viewport: spec.viewport,
    serviceWorkers: "block",
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.port === String(serverPort)
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
      const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
      const monotonicNow = globalThis.performance.now.bind(globalThis.performance);
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
      Object.defineProperty(globalThis, "__benchmaxSampleFrameRate", {
        configurable: false,
        writable: false,
        value: () =>
          new Promise((resolve) => {
            let settled = false;
            let frames = 0;
            const started = monotonicNow();
            const finish = (result) => {
              if (settled) return;
              settled = true;
              resolve(result);
            };
            nativeSetTimeout(
              () => finish({ fps: 0, timedOut: true }),
              4_000,
            );
            const scheduleFrame = globalThis.requestAnimationFrame.bind(globalThis);
            const sample = (now) => {
              frames += 1;
              if (now - started >= 2_000) {
                finish({
                  fps: Math.round((frames * 1_000) / (now - started)),
                  timedOut: false,
                });
              } else {
                scheduleFrame(sample);
              }
            };
            scheduleFrame(sample);
          }),
      });
    },
    { fixedClock: spec.fixedClock, seed: spec.seed },
  );
  const page = await context.newPage();
  recordedVideo = page.video();
  pageRuntimeStarted = true;
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500));
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message.slice(0, 500));
  });

  const startedAt = performance.now();
  try {
    const response = await page.goto(`${serverOrigin}/index.html`, {
      waitUntil: "networkidle",
      timeout: 15_000,
    });
    pageLoadMs = Math.round(performance.now() - startedAt);
    checkOutcomes.set(
      "page-load",
      booleanOutcome(Boolean(response?.ok()), { pageLoadMs }),
    );
  } catch (error) {
    pageLoadMs = Math.round(performance.now() - startedAt);
    const errorCode = normalizeErrorCode(error);
    consoleErrors.push(`navigation:${errorCode}`);
    checkOutcomes.set("page-load", {
      metric: { errorCode, pageLoadMs, passed: false },
      scoreBps: 0,
      status: "fail",
    });
  }

  for (const [index, step] of spec.interactionSteps.entries()) {
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
      interactionResults.push({
        action: step.action,
        index,
        status: "pass",
        target: step.target,
      });
    } catch (error) {
      interactionResults.push({
        action: step.action,
        errorCode: normalizeErrorCode(error),
        index,
        status: "fail",
        target: step.target,
      });
    }
  }
  try {
    await withTimeout(
      page.screenshot({
        path: screenshotPath,
        fullPage: true,
        timeout: IN_PAGE_OPERATION_TIMEOUT_MS,
      }),
      IN_PAGE_OPERATION_TIMEOUT_MS,
      "screenshot_timeout",
    );
  } catch (error) {
    consoleErrors.push(operationErrorCode("screenshot", error));
    await writeFallbackScreenshot();
  }
  try {
    pageTitle = (
      await withTimeout(
        page.title(),
        IN_PAGE_OPERATION_TIMEOUT_MS,
        "page_title_timeout",
      )
    ).slice(0, 1_000);
  } catch (error) {
    consoleErrors.push(operationErrorCode("page_title", error));
  }
  try {
    pageText = (
      await withTimeout(
        page.locator("body").innerText({
          timeout: IN_PAGE_OPERATION_TIMEOUT_MS,
        }),
        IN_PAGE_OPERATION_TIMEOUT_MS,
        "page_text_timeout",
      )
    ).slice(0, 50_000);
  } catch (error) {
    consoleErrors.push(operationErrorCode("page_text", error));
  }
  try {
    const frameSample = await withTimeout(
      page.evaluate(() => globalThis.__benchmaxSampleFrameRate()),
      IN_PAGE_OPERATION_TIMEOUT_MS,
      "frame_rate_timeout",
    );
    if (frameSample.timedOut) {
      const error = new Error("frame_rate_timeout");
      error.code = "frame_rate_timeout";
      throw error;
    }
    sampledFps = frameSample.fps;
  } catch (error) {
    sampledFps = 0;
    consoleErrors.push(operationErrorCode("frame_rate", error));
  }
  try {
    await withTimeout(
      page.addScriptTag({ content: axe.source }),
      IN_PAGE_OPERATION_TIMEOUT_MS,
      "accessibility_setup_timeout",
    );
    const axeResult = await withTimeout(
      page.evaluate(async () => globalThis.axe.run(document)),
      IN_PAGE_OPERATION_TIMEOUT_MS,
      "accessibility_scan_timeout",
    );
    accessibilityCritical = axeResult.violations.filter(
      (violation) => violation.impact === "critical",
    ).length;
  } catch (error) {
    accessibilityCritical = 1;
    consoleErrors.push(operationErrorCode("accessibility", error));
  }
  checkOutcomes.set(
    "console-errors",
    booleanOutcome(consoleErrors.length === 0, {
      consoleErrors,
      pageText,
      pageTitle,
    }),
  );
  checkOutcomes.set(
    "accessibility-critical",
    booleanOutcome(accessibilityCritical === 0, {
      criticalViolations: accessibilityCritical,
    }),
  );
  for (const check of spec.checks) {
    if (check.kind === "interaction") {
      const total = spec.interactionSteps.length;
      const passed = interactionResults.filter(
        (result) => result.status === "pass",
      ).length;
      checkOutcomes.set(check.key, {
        metric: {
          passedSteps: passed,
          steps: interactionResults,
          totalSteps: total,
        },
        scoreBps: total === 0 ? 0 : Math.round((passed * 10_000) / total),
        status: total > 0 && passed === total ? "pass" : "fail",
      });
    }
  }
  // The evidence window is deliberately fixed and part of the evaluator
  // protocol. Setup/navigation happen before this window.
  await page.waitForTimeout(VIDEO_CAPTURE_MS);
  captureWindowCompleted = true;
} catch (error) {
  if (!checkOutcomes.has("page-load")) {
    checkOutcomes.set("page-load", errorOutcome("page_runtime_not_completed"));
  }
  consoleErrors.push(
    error instanceof Error ? error.message.slice(0, 500) : "evaluation_error",
  );
} finally {
  await withTimeout(
    context?.close() ?? Promise.resolve(),
    IN_PAGE_OPERATION_TIMEOUT_MS,
    "context_close_timeout",
  ).catch(() => undefined);
  await recordedVideo?.saveAs(rawVideoPath).catch(() => undefined);
  await withTimeout(
    browser?.close() ?? Promise.resolve(),
    IN_PAGE_OPERATION_TIMEOUT_MS,
    "browser_close_timeout",
  ).catch(() => undefined);
  server.kill("SIGTERM");
  if (captureWindowCompleted) {
    await createFixedDurationVideo(rawVideoPath, videoPath);
    videoDurationMs = await readVideoDurationMs(videoPath);
    if (
      videoDurationMs === null ||
      Math.abs(videoDurationMs - VIDEO_CAPTURE_MS) >
        VIDEO_DURATION_TOLERANCE_MS
    ) {
      throw new Error(`video_duration_invalid:${videoDurationMs ?? "missing"}`);
    }
  }
  await unlink(rawVideoPath).catch(() => undefined);
}

const bundleBytes = await directoryBytes(projectDir);
for (const check of spec.checks) {
  if (check.kind === "bundle-size") {
    checkOutcomes.set(
      check.key,
      booleanOutcome(bundleBytes <= check.threshold, { bundleBytes }),
    );
  }
  if (check.kind === "performance") {
    checkOutcomes.set(
      check.key,
      pageLoadMs === null
        ? errorOutcome("page_load_not_measured")
        : booleanOutcome(pageLoadMs <= check.threshold, { pageLoadMs }),
    );
  }
  if (check.kind === "frame-rate") {
    checkOutcomes.set(
      check.key,
      sampledFps === null
        ? failureOutcome("frame_rate_not_measured")
        : booleanOutcome(sampledFps >= check.threshold, { sampledFps }),
    );
  }
}

const objectiveResults = spec.checks.map((check) => {
  const outcome =
    checkOutcomes.get(check.key) ??
    (pageRuntimeStarted
      ? failureOutcome("check_not_completed")
      : errorOutcome("page_runtime_not_started"));
  return {
    checkKey: check.key,
    kind: check.kind,
    status: outcome.status,
    scoreBps: outcome.scoreBps,
    weightBps: check.weightBps,
    metric: outcome.metric,
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
    templateBuildHash,
    objectiveResults,
    weightedScoreBps,
    consoleErrors,
    serverLog: serverLog.slice(0, 20_000),
    videoCaptureMs: VIDEO_CAPTURE_MS,
    videoDurationMs,
  }),
);

function booleanOutcome(passed, metric) {
  return {
    metric: { passed, ...metric },
    scoreBps: passed ? 10_000 : 0,
    status: passed ? "pass" : "fail",
  };
}

function errorOutcome(errorCode) {
  return {
    metric: { errorCode, notRun: true },
    scoreBps: 0,
    status: "error",
  };
}

function failureOutcome(errorCode) {
  return {
    metric: { errorCode, passed: false },
    scoreBps: 0,
    status: "fail",
  };
}

function operationErrorCode(operation, error) {
  return `${operation}:${normalizeErrorCode(error)}`.slice(0, 500);
}

function withTimeout(promise, timeoutMs, errorCode) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(errorCode);
        error.code = errorCode;
        reject(error);
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function writeFallbackScreenshot() {
  // Valid 1x1 transparent PNG. A model-caused capture failure remains visible
  // as failed runtime evidence instead of being misclassified as infrastructure.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await writeFile(screenshotPath, png);
}

function normalizeErrorCode(error) {
  const name =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : error && typeof error === "object" && "name" in error
        ? String(error.name)
      : "interaction_error";
  return name.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 80);
}

async function readTemplateBuildHash() {
  const configured = process.env.BENCHMAX_EVALUATOR_TEMPLATE_BUILD_HASH?.trim();
  const value =
    configured ||
    (
      await readFile("/opt/benchmax/environment.sha256", "utf8")
    ).trim();
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("Evaluator environment fingerprint is invalid.");
  }
  return value;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${serverOrigin}/index.html`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Local evaluator server did not become ready.");
}

function parseServerPort(value) {
  if (!value) return 4173;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("BENCHMAX_EVALUATOR_PORT must be an unprivileged TCP port.");
  }
  return port;
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

async function createFixedDurationVideo(inputPath, outputPath) {
  await runProcess(
    process.env.BENCHMAX_FFMPEG || "/usr/local/bin/benchmax-ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-sseof",
      `-${VIDEO_CAPTURE_MS / 1000}`,
      "-i",
      inputPath,
      "-an",
      "-r",
      "25",
      "-c:v",
      "vp8",
      "-b:v",
      "1M",
      "-t",
      String(VIDEO_CAPTURE_MS / 1000),
      outputPath,
    ],
  );
}

async function readVideoDurationMs(inputPath) {
  const result = await runProcess(
    process.env.BENCHMAX_FFMPEG || "/usr/local/bin/benchmax-ffmpeg",
    ["-hide_banner", "-i", inputPath],
    new Set([0, 1]),
  );
  const match = /Duration:\s+(\d{2}):(\d{2}):(\d{2})\.(\d{2})/.exec(
    result.stderr,
  );
  if (!match) return null;
  const [, hours, minutes, seconds, centiseconds] = match;
  return (
    (Number(hours) * 60 * 60 +
      Number(minutes) * 60 +
      Number(seconds)) *
      1000 +
    Number(centiseconds) * 10
  );
}

async function runProcess(command, args, acceptedExitCodes = new Set([0])) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const append = (current, chunk) =>
      `${current}${chunk.toString()}`.slice(-200_000);
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== null && acceptedExitCodes.has(code)) {
        resolve({ stderr, stdout });
      } else {
        reject(
          new Error(
            `media_process_failed:${code ?? "signal"}:${stderr.slice(-500)}`,
          ),
        );
      }
    });
  });
}

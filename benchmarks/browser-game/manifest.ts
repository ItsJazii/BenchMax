import type { FrontendBenchmarkDefinition } from "../frontend/manifest";

const gameChecks = [
  { key: "page-load", kind: "page-load", weightBps: 1400 },
  { key: "console-errors", kind: "console-errors", weightBps: 1400 },
  { key: "input-flow", kind: "interaction", weightBps: 3600 },
  { key: "frame-rate", kind: "frame-rate", threshold: 30, weightBps: 1600 },
  {
    key: "accessibility-critical",
    kind: "accessibility",
    threshold: 0,
    weightBps: 1000,
  },
  {
    key: "bundle-size",
    kind: "bundle-size",
    threshold: 2_000_000,
    weightBps: 1000,
  },
] as const;

const gameRubric = [
  {
    key: "functional-completeness",
    title: "Functional completeness",
    mechanism: "objective",
    weightBps: 3500,
    judgeSourceRequired: false,
  },
  {
    key: "game-feel",
    title: "Game feel and feedback",
    mechanism: "judge",
    weightBps: 2500,
    judgeSourceRequired: false,
  },
  {
    key: "visual-quality",
    title: "Visual quality",
    mechanism: "judge",
    weightBps: 2000,
    judgeSourceRequired: false,
  },
  {
    key: "resilience",
    title: "Runtime and input resilience",
    mechanism: "hybrid",
    weightBps: 2000,
    judgeSourceRequired: true,
  },
] as const;

export const browserGameBenchmarks = [
  {
    id: "browser-game-arcade-survival-v1",
    slug: "arcade-survival-loop",
    title: "Arcade survival loop",
    version: 1,
    canonicalPrompt:
      "Build a complete browser arcade survival game using only local HTML, CSS, and JavaScript. Include keyboard controls, enemies, score, health, escalating difficulty, pause, restart, clear onboarding, visible feedback, and a deterministic seeded start. It must be playable immediately with no external assets or network requests.",
    viewport: { width: 1280, height: 800 },
    fixedClock: "2026-07-29T09:00:00.000Z",
    seed: 55011,
    interactionSteps: [
      { action: "assert-visible", target: "canvas" },
      { action: "press", target: "body", value: "ArrowRight" },
      { action: "press", target: "body", value: "Space" },
    ],
    checks: gameChecks,
    rubric: gameRubric,
  },
  {
    id: "browser-game-puzzle-grid-v1",
    slug: "puzzle-grid",
    title: "Puzzle grid",
    version: 1,
    canonicalPrompt:
      "Build a polished browser puzzle game with a visible grid, deterministic starting board, keyboard and pointer controls, move counter, timer, win condition, restart, undo, instructions, and responsive layout. Keep every asset local and make the full loop playable without a build step.",
    viewport: { width: 1280, height: 800 },
    fixedClock: "2026-07-29T09:00:00.000Z",
    seed: 55012,
    interactionSteps: [
      { action: "assert-visible", target: "main" },
      { action: "press", target: "body", value: "ArrowUp" },
      { action: "press", target: "body", value: "ArrowLeft" },
    ],
    checks: gameChecks,
    rubric: gameRubric,
  },
  {
    id: "browser-game-platformer-v1",
    slug: "single-screen-platformer",
    title: "Single-screen platformer",
    version: 1,
    canonicalPrompt:
      "Build a single-screen browser platformer with responsive movement, jumping, platforms, hazards, collectibles, score, lives, a finish state, restart, keyboard controls, and clear visual feedback. Use deterministic local content, no external libraries, and no network requests.",
    viewport: { width: 1280, height: 800 },
    fixedClock: "2026-07-29T09:00:00.000Z",
    seed: 55013,
    interactionSteps: [
      { action: "assert-visible", target: "canvas" },
      { action: "press", target: "body", value: "ArrowRight" },
      { action: "press", target: "body", value: "Space" },
    ],
    checks: gameChecks,
    rubric: gameRubric,
  },
  {
    id: "browser-game-tower-defense-v1",
    slug: "compact-tower-defense",
    title: "Compact tower defense",
    version: 1,
    canonicalPrompt:
      "Build a compact browser tower-defense game with a visible path, tower placement, enemy waves, currency, health, upgrades, start-wave control, loss and win states, restart, onboarding, and responsive UI. Use only deterministic local code and assets.",
    viewport: { width: 1280, height: 800 },
    fixedClock: "2026-07-29T09:00:00.000Z",
    seed: 55014,
    interactionSteps: [
      { action: "assert-visible", target: "main" },
      { action: "click", target: "button" },
      { action: "press", target: "body", value: "Enter" },
    ],
    checks: gameChecks,
    rubric: gameRubric,
  },
  {
    id: "browser-game-driving-v1",
    slug: "top-down-driving",
    title: "Top-down driving challenge",
    version: 1,
    canonicalPrompt:
      "Build a top-down browser driving challenge with steering, acceleration, track boundaries, checkpoints, lap timing, collision feedback, pause, restart, instructions, and responsive presentation. Use seeded local content only, with no external assets or network requests.",
    viewport: { width: 1280, height: 800 },
    fixedClock: "2026-07-29T09:00:00.000Z",
    seed: 55015,
    interactionSteps: [
      { action: "assert-visible", target: "canvas" },
      { action: "press", target: "body", value: "ArrowUp" },
      { action: "press", target: "body", value: "ArrowRight" },
    ],
    checks: gameChecks,
    rubric: gameRubric,
  },
] as const satisfies ReadonlyArray<FrontendBenchmarkDefinition>;

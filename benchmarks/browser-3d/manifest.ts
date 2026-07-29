import type { FrontendBenchmarkDefinition } from "../frontend/manifest";

const sceneChecks = [
  { key: "page-load", kind: "page-load", weightBps: 1500 },
  { key: "console-errors", kind: "console-errors", weightBps: 1500 },
  { key: "navigation-flow", kind: "interaction", weightBps: 2500 },
  { key: "frame-rate", kind: "frame-rate", threshold: 24, weightBps: 2500 },
  {
    key: "accessibility-critical",
    kind: "accessibility",
    threshold: 0,
    weightBps: 1000,
  },
  {
    key: "bundle-size",
    kind: "bundle-size",
    threshold: 3_000_000,
    weightBps: 1000,
  },
] as const;

const sceneRubric = [
  {
    key: "functional-completeness",
    title: "Functional completeness",
    mechanism: "objective",
    weightBps: 3500,
    judgeSourceRequired: false,
  },
  {
    key: "spatial-design",
    title: "Spatial design",
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
    key: "navigation-resilience",
    title: "Navigation and runtime resilience",
    mechanism: "hybrid",
    weightBps: 2000,
    judgeSourceRequired: true,
  },
] as const;

export const browser3dBenchmarks = [
  {
    id: "browser-3d-product-gallery-v1",
    slug: "interactive-product-gallery",
    title: "Interactive product gallery",
    version: 1,
    canonicalPrompt:
      "Build a browser-native interactive 3D product gallery with at least three selectable products, orbit and zoom controls, material or color switching, labels, reset view, loading state, keyboard alternatives, and responsive UI. Use only local code and procedural assets; no network requests.",
    viewport: { width: 1440, height: 900 },
    fixedClock: "2026-07-29T09:00:00.000Z",
    seed: 66011,
    interactionSteps: [
      { action: "assert-visible", target: "canvas" },
      { action: "press", target: "body", value: "ArrowRight" },
      { action: "press", target: "body", value: "r" },
    ],
    checks: sceneChecks,
    rubric: sceneRubric,
  },
  {
    id: "browser-3d-architectural-tour-v1",
    slug: "architectural-tour",
    title: "Architectural walkthrough",
    version: 1,
    canonicalPrompt:
      "Build a navigable browser 3D architectural walkthrough with multiple spaces, keyboard and pointer navigation, collision-aware boundaries, orientation help, labeled points of interest, reset, loading state, and responsive controls. Use local procedural assets and no network requests.",
    viewport: { width: 1440, height: 900 },
    fixedClock: "2026-07-29T09:00:00.000Z",
    seed: 66012,
    interactionSteps: [
      { action: "assert-visible", target: "canvas" },
      { action: "press", target: "body", value: "w" },
      { action: "press", target: "body", value: "d" },
    ],
    checks: sceneChecks,
    rubric: sceneRubric,
  },
  {
    id: "browser-3d-data-landscape-v1",
    slug: "data-landscape",
    title: "Interactive data landscape",
    version: 1,
    canonicalPrompt:
      "Build an interactive browser 3D data landscape from deterministic local data. Include labeled geometry, orbit and keyboard navigation, selection details, category filtering, reset view, readable legend, loading state, and responsive fallback UI. No external assets or requests.",
    viewport: { width: 1440, height: 900 },
    fixedClock: "2026-07-29T09:00:00.000Z",
    seed: 66013,
    interactionSteps: [
      { action: "assert-visible", target: "canvas" },
      { action: "press", target: "body", value: "ArrowLeft" },
      { action: "press", target: "body", value: "Enter" },
    ],
    checks: sceneChecks,
    rubric: sceneRubric,
  },
  {
    id: "browser-3d-space-station-v1",
    slug: "space-station-scene",
    title: "Navigable space station",
    version: 1,
    canonicalPrompt:
      "Build a navigable browser 3D space-station scene with distinct areas, first-person or orbit controls, interactive doors or consoles, objective markers, reset, loading feedback, instructions, and stable responsive rendering. Use procedural local assets and no network requests.",
    viewport: { width: 1440, height: 900 },
    fixedClock: "2026-07-29T09:00:00.000Z",
    seed: 66014,
    interactionSteps: [
      { action: "assert-visible", target: "canvas" },
      { action: "press", target: "body", value: "w" },
      { action: "press", target: "body", value: "e" },
    ],
    checks: sceneChecks,
    rubric: sceneRubric,
  },
] as const satisfies ReadonlyArray<FrontendBenchmarkDefinition>;

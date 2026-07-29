export type FrontendCheck = {
  key: string;
  kind:
    | "page-load"
    | "console-errors"
    | "interaction"
    | "accessibility"
    | "bundle-size"
    | "performance"
    | "frame-rate";
  target?: string;
  threshold?: number;
  weightBps: number;
};

export type FrontendBenchmarkDefinition = {
  id: string;
  slug: string;
  title: string;
  version: 1;
  canonicalPrompt: string;
  viewport: { height: number; width: number };
  fixedClock: string;
  seed: number;
  interactionSteps: ReadonlyArray<{
    action: "click" | "fill" | "press" | "assert-visible";
    target: string;
    value?: string;
  }>;
  checks: ReadonlyArray<FrontendCheck>;
  rubric: ReadonlyArray<{
    key: string;
    title: string;
    mechanism: "objective" | "judge" | "hybrid";
    weightBps: number;
    judgeSourceRequired: boolean;
  }>;
};

const sharedChecks = [
  { key: "page-load", kind: "page-load", weightBps: 1800 },
  { key: "console-errors", kind: "console-errors", weightBps: 1400 },
  {
    key: "accessibility-critical",
    kind: "accessibility",
    threshold: 0,
    weightBps: 1200,
  },
  {
    key: "bundle-size",
    kind: "bundle-size",
    threshold: 1_500_000,
    weightBps: 600,
  },
  {
    key: "load-performance",
    kind: "performance",
    threshold: 2500,
    weightBps: 1000,
  },
] as const satisfies ReadonlyArray<FrontendCheck>;

export const frontendBenchmarks = [
  {
    id: "frontend-command-center-v1",
    slug: "operations-command-center",
    title: "Operations command center",
    version: 1,
    canonicalPrompt:
      "Build a responsive operations command center for a fictional logistics company. Include a collapsible navigation rail, shipment KPI cards, a searchable and sortable exceptions table, a detail drawer, a seven-day trend visualization, realistic loading and empty states, and complete keyboard navigation. Use only local data and make the result production-quality at desktop and mobile widths.",
    viewport: { width: 1440, height: 1000 },
    fixedClock: "2026-07-29T09:00:00.000Z",
    seed: 41021,
    interactionSteps: [
      { action: "assert-visible", target: "main" },
      { action: "fill", target: "input[type=search]", value: "delayed" },
      { action: "press", target: "input[type=search]", value: "Enter" },
      { action: "click", target: "[data-testid=exception-row]" },
      { action: "assert-visible", target: "[role=dialog]" },
    ],
    checks: [
      ...sharedChecks,
      {
        key: "exception-flow",
        kind: "interaction",
        target: "[role=dialog]",
        weightBps: 4000,
      },
    ],
    rubric: [
      {
        key: "functional-completeness",
        title: "Functional completeness",
        mechanism: "objective",
        weightBps: 3500,
        judgeSourceRequired: false,
      },
      {
        key: "information-design",
        title: "Information design",
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
        key: "usability",
        title: "Usability and accessibility",
        mechanism: "hybrid",
        weightBps: 2000,
        judgeSourceRequired: false,
      },
    ],
  },
  {
    id: "frontend-product-configurator-v1",
    slug: "product-configurator",
    title: "Product configurator",
    version: 1,
    canonicalPrompt:
      "Build a polished product configurator for a fictional modular desk. Users must be able to choose size, finish, frame color, and accessories; see price and configuration changes immediately; review a sticky summary; and add the configured item to a local cart. Include invalid-combination guidance, mobile behavior, keyboard support, and no external assets or network requests.",
    viewport: { width: 1365, height: 900 },
    fixedClock: "2026-07-29T09:00:00.000Z",
    seed: 88291,
    interactionSteps: [
      { action: "assert-visible", target: "main" },
      { action: "click", target: "[data-testid=finish-option]" },
      { action: "click", target: "[data-testid=accessory-option]" },
      { action: "click", target: "[data-testid=add-to-cart]" },
      { action: "assert-visible", target: "[data-testid=cart-count]" },
    ],
    checks: [
      ...sharedChecks,
      {
        key: "configuration-flow",
        kind: "interaction",
        target: "[data-testid=cart-count]",
        weightBps: 4000,
      },
    ],
    rubric: [
      {
        key: "functional-completeness",
        title: "Functional completeness",
        mechanism: "objective",
        weightBps: 3500,
        judgeSourceRequired: false,
      },
      {
        key: "interaction-clarity",
        title: "Interaction clarity",
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
        title: "Responsive and invalid-state resilience",
        mechanism: "hybrid",
        weightBps: 2000,
        judgeSourceRequired: true,
      },
    ],
  },
  {
    id: "frontend-planning-board-v1",
    slug: "collaborative-planning-board",
    title: "Collaborative planning board",
    version: 1,
    canonicalPrompt:
      "Build a local-first planning board for a small product team. It needs four workflow columns, draggable task cards with a keyboard alternative, filters, quick add, task editing in a modal, due-date and priority indicators, undo for moves, useful empty states, and responsive behavior. Use deterministic local seed data and no external services.",
    viewport: { width: 1440, height: 960 },
    fixedClock: "2026-07-29T09:00:00.000Z",
    seed: 77304,
    interactionSteps: [
      { action: "assert-visible", target: "main" },
      { action: "click", target: "[data-testid=quick-add]" },
      { action: "fill", target: "[name=task-title]", value: "Review evidence" },
      { action: "click", target: "[data-testid=save-task]" },
      { action: "assert-visible", target: "[data-testid=task-card]" },
    ],
    checks: [
      ...sharedChecks,
      {
        key: "task-create-flow",
        kind: "interaction",
        target: "[data-testid=task-card]",
        weightBps: 4000,
      },
    ],
    rubric: [
      {
        key: "functional-completeness",
        title: "Functional completeness",
        mechanism: "objective",
        weightBps: 3500,
        judgeSourceRequired: false,
      },
      {
        key: "workflow-usability",
        title: "Workflow usability",
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
        key: "accessibility",
        title: "Accessible interactions",
        mechanism: "hybrid",
        weightBps: 2000,
        judgeSourceRequired: true,
      },
    ],
  },
  {
    id: "frontend-research-explorer-v1",
    slug: "research-data-explorer",
    title: "Research data explorer",
    version: 1,
    canonicalPrompt:
      "Build an interactive research data explorer for a fictional climate dataset. Include a clear metric overview, linked line and bar views, region and time filters, a comparison drawer, a data table, explanatory annotations, CSV export generated in the browser, loading and no-result states, keyboard accessibility, and a responsive small-screen layout. Use local deterministic data only.",
    viewport: { width: 1440, height: 1000 },
    fixedClock: "2026-07-29T09:00:00.000Z",
    seed: 90017,
    interactionSteps: [
      { action: "assert-visible", target: "main" },
      { action: "click", target: "[data-testid=region-filter]" },
      { action: "click", target: "[data-testid=region-option]" },
      { action: "click", target: "[data-testid=compare-toggle]" },
      { action: "assert-visible", target: "[data-testid=comparison-drawer]" },
    ],
    checks: [
      ...sharedChecks,
      {
        key: "linked-filter-flow",
        kind: "interaction",
        target: "[data-testid=comparison-drawer]",
        weightBps: 4000,
      },
    ],
    rubric: [
      {
        key: "functional-completeness",
        title: "Functional completeness",
        mechanism: "objective",
        weightBps: 3500,
        judgeSourceRequired: false,
      },
      {
        key: "data-communication",
        title: "Data communication",
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
        key: "usability",
        title: "Usability and accessibility",
        mechanism: "hybrid",
        weightBps: 2000,
        judgeSourceRequired: false,
      },
    ],
  },
  {
    id: "frontend-support-inbox-v1",
    slug: "support-inbox",
    title: "Support inbox",
    version: 1,
    canonicalPrompt:
      "Build a keyboard-friendly support inbox for a fictional SaaS product. Include queue counts, search and status filters, a conversation list, message thread, customer context, internal notes, assignment, status transitions, reply drafting, optimistic local updates, and convincing loading, error, and empty states. Keep all data local and make desktop and mobile workflows complete.",
    viewport: { width: 1440, height: 960 },
    fixedClock: "2026-07-29T09:00:00.000Z",
    seed: 22761,
    interactionSteps: [
      { action: "assert-visible", target: "main" },
      { action: "click", target: "[data-testid=conversation-row]" },
      { action: "fill", target: "[data-testid=reply-box]", value: "Thanks — we are checking this now." },
      { action: "click", target: "[data-testid=send-reply]" },
      { action: "assert-visible", target: "[data-testid=sent-message]" },
    ],
    checks: [
      ...sharedChecks,
      {
        key: "reply-flow",
        kind: "interaction",
        target: "[data-testid=sent-message]",
        weightBps: 4000,
      },
    ],
    rubric: [
      {
        key: "functional-completeness",
        title: "Functional completeness",
        mechanism: "objective",
        weightBps: 3500,
        judgeSourceRequired: false,
      },
      {
        key: "workflow-usability",
        title: "Workflow usability",
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
        key: "state-design",
        title: "State and resilience design",
        mechanism: "hybrid",
        weightBps: 2000,
        judgeSourceRequired: true,
      },
    ],
  },
] as const satisfies ReadonlyArray<FrontendBenchmarkDefinition>;

export function getFrontendBenchmarkDefinition(id: string) {
  return frontendBenchmarks.find((benchmark) => benchmark.id === id) ?? null;
}

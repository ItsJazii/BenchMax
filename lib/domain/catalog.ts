export type Category = "frontend" | "browser-game" | "browser-3d" | "other";

export type ShowcaseCard = {
  category: Category;
  contributor: string;
  description: string;
  evidence: string[];
  harness: string;
  id: string;
  model: string;
  published: string;
  reasoning: string;
  slug: string;
  title: string;
  trust: "Platform Generated" | "Platform Replayed" | "Community Showcase";
};

export const categoryLabels: Record<Category, string> = {
  frontend: "Frontend",
  "browser-game": "Browser games",
  "browser-3d": "Browser 3D",
  other: "Other tests",
};

export const showcaseFeed: ShowcaseCard[] = [
  {
    id: "showcase-k3-voxel",
    slug: "k3-voxel-world-one-shot",
    title: "K3 built a playable voxel world from one prompt",
    description:
      "A Minecraft-style browser experiment with terrain generation, block interaction, and a complete first-person loop.",
    category: "browser-game",
    model: "K3",
    harness: "Custom coding harness",
    reasoning: "High",
    trust: "Community Showcase",
    contributor: "jazii",
    published: "Today",
    evidence: ["Source", "Video", "Prompt", "Screenshots"],
  },
  {
    id: "showcase-opus-dashboard",
    slug: "opus-4-6-analytics-dashboard",
    title: "Opus 4.6 turned a dense brief into a clean analytics UI",
    description:
      "Responsive dashboard with keyboard navigation, real loading states, and a compact data-dense layout.",
    category: "frontend",
    model: "Opus 4.6",
    harness: "Claude Code",
    reasoning: "High",
    trust: "Platform Replayed",
    contributor: "maya",
    published: "2h ago",
    evidence: ["Source", "Live replay", "Prompt"],
  },
  {
    id: "showcase-gpt-space",
    slug: "gpt-space-station-webgl",
    title: "A navigable WebGL space station with zero starter assets",
    description:
      "A browser-native 3D scene tested for load stability, camera controls, and frame pacing.",
    category: "browser-3d",
    model: "GPT coding model",
    harness: "Codex",
    reasoning: "Medium",
    trust: "Community Showcase",
    contributor: "niko",
    published: "Yesterday",
    evidence: ["Video", "Source", "Runtime log"],
  },
];

export const benchmarkPreview = [
  {
    category: "Frontend",
    leader: "Waiting for platform runs",
    coverage: "0 / 5",
    status: "Runner ready",
  },
  {
    category: "Browser games",
    leader: "Waiting for platform runs",
    coverage: "0 / 5",
    status: "Runner ready",
  },
  {
    category: "Browser 3D",
    leader: "Waiting for platform runs",
    coverage: "0 / 4",
    status: "Runner ready",
  },
];

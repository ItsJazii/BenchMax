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

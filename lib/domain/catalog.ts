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
  rank: number | null;
  reasoning: string;
  scoreBps: number | null;
  slug: string;
  status: string;
  title: string;
  trust: "Declared, unverified";
};

export const categoryLabels: Record<Category, string> = {
  frontend: "Frontend",
  "browser-game": "Browser games",
  "browser-3d": "Browser 3D",
  other: "Other tests",
};

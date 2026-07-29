import { browser3dBenchmarks } from "./browser-3d/manifest";
import { browserGameBenchmarks } from "./browser-game/manifest";
import { frontendBenchmarks } from "./frontend/manifest";

export const allBenchmarks = [
  ...frontendBenchmarks.map((definition) => ({
    category: "frontend" as const,
    definition,
  })),
  ...browserGameBenchmarks.map((definition) => ({
    category: "browser-game" as const,
    definition,
  })),
  ...browser3dBenchmarks.map((definition) => ({
    category: "browser-3d" as const,
    definition,
  })),
] as const;

export function getBrowserBenchmarkDefinition(id: string) {
  return allBenchmarks.find((item) => item.definition.id === id) ?? null;
}

import type { ShowcaseCard } from "@/lib/domain/catalog";

export function TrustBadge({ trust }: { trust: ShowcaseCard["trust"] }) {
  const tone =
    trust === "Platform Generated"
      ? "verified"
      : trust === "Platform Replayed"
        ? "replayed"
        : "community";
  return <span className={`trust-badge ${tone}`}>{trust}</span>;
}

import type { ShowcaseCard } from "@/lib/domain/catalog";

export function TrustBadge({ trust }: { trust: ShowcaseCard["trust"] }) {
  return <span className="trust-badge community">{trust}</span>;
}

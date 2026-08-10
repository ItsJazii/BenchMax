import { permanentRedirect } from "next/navigation";

type ExploreSearchParams = Record<string, string | string[] | undefined>;

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<ExploreSearchParams>;
}) {
  const values = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
    } else if (value) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  permanentRedirect(query ? `/tests?${query}` : "/tests");
}

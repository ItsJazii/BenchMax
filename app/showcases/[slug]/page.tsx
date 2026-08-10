import { permanentRedirect } from "next/navigation";

type LegacySearchParams = Record<string, string | string[] | undefined>;

export default async function ShowcasePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<LegacySearchParams>;
}) {
  const [{ slug }, values] = await Promise.all([params, searchParams]);
  const query = serializeSearchParams(values);
  permanentRedirect(query ? `/tests/${slug}?${query}` : `/tests/${slug}`);
}

function serializeSearchParams(values: LegacySearchParams) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
    } else if (value) {
      params.set(key, value);
    }
  }
  return params.toString();
}

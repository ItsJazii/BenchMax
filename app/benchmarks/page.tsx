import { permanentRedirect } from "next/navigation";

export default function BenchmarksPage() {
  permanentRedirect("/tests");
}

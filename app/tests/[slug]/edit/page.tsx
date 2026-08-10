import { permanentRedirect } from "next/navigation";

export default function LegacyTestEditorPage() {
  permanentRedirect("/submit");
}

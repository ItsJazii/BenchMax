import { permanentRedirect } from "next/navigation";

export default function UploadPage() {
  permanentRedirect("/submit");
}

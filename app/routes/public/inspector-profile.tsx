import { redirect } from "react-router";
import type { Route } from "./+types/inspector-profile";

export function loader({ params }: Route.LoaderArgs) {
  // DB-12 / IA-26 — the per-inspector public profile is permanently retired;
  // the company booking page is the only public entry. 301 (not the redirect()
  // default 302) so crawlers transfer link equity and drop the old permalink.
  return redirect(`/book/${params.tenant}`, 301);
}

// No UI rendered — this route exists solely to issue the redirect.
export default function InspectorProfilePage() {
  return null;
}

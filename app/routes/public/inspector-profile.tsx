import { redirect } from "react-router";
import type { Route } from "./+types/inspector-profile";

export function loader({ params }: Route.LoaderArgs) {
  // DB-12 / IA-26 — the per-inspector public profile is retired; the company
  // booking page is the only public entry. Old links keep working via 302.
  return redirect(`/book/${params.tenant}`);
}

// No UI rendered — this route exists solely to issue the redirect.
export default function InspectorProfilePage() {
  return null;
}

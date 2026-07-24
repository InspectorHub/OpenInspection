import { redirect } from "react-router";

/**
 * IA-54 — the agent page was renamed /agent-recommendations →
 * /agent-repair-items to match its sidebar label and the Library. Keep the old
 * path alive with a permanent redirect (mirrors recommendations-redirect.tsx).
 */
export function loader() {
  return redirect("/agent-repair-items", 301);
}

export default function AgentRepairItemsRedirect() {
  return null;
}

import { redirect } from "react-router";

/**
 * IA-54 — the agent page was renamed /agent-recommendations →
 * /agent-repair-items to match its sidebar label and the Library. Keep the old
 * path alive with a permanent redirect.
 *
 * The dashboard had two aliases of this shape and both were DELETED once it was
 * confirmed nothing outside the repository linked to them. This one stays,
 * because the difference is who holds the link: a dashboard alias is only ever
 * followed by someone inside the workspace, and an agent's link was shared
 * outward and cannot be reissued.
 */
export function loader() {
  return redirect("/agent-repair-items", 301);
}

export default function AgentRepairItemsRedirect() {
  return null;
}

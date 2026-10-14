import { m } from "~/paraglide/messages";

/**
 * Which Intuit environment the connection talks to.
 *
 * Sandbox is amber and production is green because the two are not equally
 * safe to be wrong about: a sandbox connection is a rehearsal, and the badge is
 * how a person tells at a glance that real books are, or are not, being
 * written. An unknown environment renders nothing instead of a guess: the
 * status leaves it null when `QBO_ENV` is unset or not one of the two values,
 * and a badge claiming "Sandbox" there would hide that nothing can sync.
 */
export function QboEnvironmentBadge({ environment }: { environment: "sandbox" | "production" | null }) {
  if (!environment) return null;
  const tone =
    environment === "sandbox" ? "bg-ih-watch-bg text-ih-watch-fg" : "bg-ih-ok-bg text-ih-ok-fg";
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.08em] ${tone}`}
    >
      {environment === "sandbox" ? m.settings_qbo_env_sandbox() : m.settings_qbo_env_production()}
    </span>
  );
}

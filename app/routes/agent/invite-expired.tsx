import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/invite-expired";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.agent_portal_invite_expired_meta_title() }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ExpiredData {
  reason: "expired" | "used" | "no-token" | "unknown";
  inviterName?: string;
  inviterEmail?: string;
  tenantName?: string;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const reason = (url.searchParams.get("reason") as ExpiredData["reason"]) || "unknown";
  const inviterName = url.searchParams.get("inviterName") || undefined;
  const inviterEmail = url.searchParams.get("inviterEmail") || undefined;
  const tenantName = url.searchParams.get("tenantName") || undefined;

  return { reason, inviterName, inviterEmail, tenantName } satisfies ExpiredData;
}

/* ------------------------------------------------------------------ */
/*  Content helpers                                                    */
/* ------------------------------------------------------------------ */

function getHeadline(reason: ExpiredData["reason"]): string {
  switch (reason) {
    case "used":
      return m.agent_portal_invite_expired_headline_used();
    case "no-token":
      return m.agent_portal_invite_expired_headline_no_token();
    default:
      return m.agent_portal_invite_expired_headline_default();
  }
}

function getExplainer(reason: ExpiredData["reason"]): string {
  switch (reason) {
    case "used":
      return m.agent_portal_invite_expired_explainer_used();
    case "no-token":
      return m.agent_portal_invite_expired_explainer_no_token();
    default:
      return m.agent_portal_invite_expired_explainer_default();
  }
}

function buildMailto(
  inviterEmail?: string,
  inviterName?: string,
  tenantName?: string,
): string | null {
  if (!inviterEmail) return null;
  const subject = m.agent_portal_invite_expired_mailto_subject();
  const bodyLines = [
    m.agent_portal_invite_expired_mailto_greeting({ name: inviterName ? " " + inviterName : "" }),
    "",
    m.agent_portal_invite_expired_mailto_body({ tenant: tenantName || "OpenInspection" }),
    "",
    m.agent_portal_invite_expired_mailto_thanks(),
  ];
  return `mailto:${inviterEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join("\n"))}`;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function AgentInviteExpiredPage() {
  const { reason, inviterName, inviterEmail, tenantName } =
    useLoaderData<typeof loader>();
  const mailto = buildMailto(inviterEmail, inviterName, tenantName);
  const inspector = inviterName || m.agent_portal_invite_expired_inspector_fallback();

  return (
    <div className="min-h-screen flex items-center justify-center bg-ih-bg-card p-6">
      <div className="max-w-[480px] w-full bg-ih-bg-card border border-ih-border rounded-2xl p-10 text-center">
        <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-ih-watch-bg text-ih-watch-fg rounded-full text-xs font-semibold uppercase tracking-wide mb-5">
          {m.agent_portal_invite_expired_badge()}
        </span>

        <h1 className="font-serif font-bold text-[1.75rem] leading-tight tracking-tight mb-3 text-ih-fg-1">
          {getHeadline(reason)}
        </h1>

        <p className="text-[15px] text-ih-fg-3 leading-relaxed mb-7">
          {getExplainer(reason)}
        </p>

        {mailto ? (
          <a
            href={mailto}
            className="inline-block px-6 py-3 bg-ih-primary text-white font-semibold rounded-xl text-[15px] hover:opacity-90 transition-opacity"
          >
            {m.agent_portal_invite_expired_ask({ inspector })}
          </a>
        ) : (
          <Link
            to="/agent-signup"
            className="inline-block px-6 py-3 bg-ih-primary text-white font-semibold rounded-xl text-[15px] hover:opacity-90 transition-opacity"
          >
            {m.agent_portal_invite_expired_signup_instead()}
          </Link>
        )}

        <Link
          to="/agent-signup"
          className="block mt-5 text-[14px] text-ih-fg-4 hover:text-ih-fg-2 transition-colors"
        >
          {m.agent_portal_invite_expired_signup_no_invite()}
        </Link>
      </div>
    </div>
  );
}

import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/invite-expired";

export function meta() {
  return [{ title: "Invite expired - OpenInspection" }];
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
      return "This invite has already been used";
    case "no-token":
      return "No invite token in this link";
    default:
      return "This invite has expired";
  }
}

function getExplainer(reason: ExpiredData["reason"]): string {
  switch (reason) {
    case "used":
      return "Looks like this invite has already been claimed. If that wasn't you, ask the inspector to resend.";
    case "no-token":
      return "The link is missing the invite token. Most likely the email got mangled in transit. Ask the inspector to copy the full link.";
    default:
      return "Invites expire after seven days. Ask the inspector for a fresh one -- the link below pre-fills the message.";
  }
}

function buildMailto(
  inviterEmail?: string,
  inviterName?: string,
  tenantName?: string,
): string | null {
  if (!inviterEmail) return null;
  const subject = "Could you re-send my partner agent invite?";
  const bodyLines = [
    `Hi${inviterName ? " " + inviterName : ""},`,
    "",
    `My partner-agent invite to ${tenantName || "OpenInspection"} expired before I could accept it. Could you re-send it?`,
    "",
    "Thanks!",
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
  const inspector = inviterName || "the inspector who invited you";

  return (
    <div className="min-h-screen flex items-center justify-center bg-ih-bg-card p-6">
      <div className="max-w-[480px] w-full bg-ih-bg-card border border-ih-border rounded-2xl p-10 text-center">
        <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-ih-watch-bg text-ih-watch-fg rounded-full text-xs font-semibold uppercase tracking-wide mb-5">
          Invite needs a refresh
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
            Ask {inspector} for a new invite
          </a>
        ) : (
          <Link
            to="/agent-signup"
            className="inline-block px-6 py-3 bg-ih-primary text-white font-semibold rounded-xl text-[15px] hover:opacity-90 transition-opacity"
          >
            Sign up directly instead
          </Link>
        )}

        <Link
          to="/agent-signup"
          className="block mt-5 text-[14px] text-ih-fg-4 hover:text-ih-fg-2 transition-colors"
        >
          Or sign up directly without an invite
        </Link>
      </div>
    </div>
  );
}

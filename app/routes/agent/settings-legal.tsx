import { useLoaderData } from "react-router";
import type { Route } from "./+types/settings-legal";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Banner } from "@core/shared-ui";
import { useDisplayLocale } from "~/hooks/useSessionContext";
import { useAgentTimeZoneOverride } from "~/routes/agent-layout";
import { formatDateTime } from "~/lib/format";
import { m } from "~/paraglide/messages";

/**
 * What this agent accepted, when, and — the part the data cannot state — what
 * these terms have nothing to do with.
 *
 * The list is the easy half. `agent_terms_acceptances` keeps every acceptance,
 * so an agent can read back the version that was in force at the time and the
 * text it actually carried, rather than whatever the document says today. The
 * two are the same right up until the day they are not, and that day is the only
 * day this page matters.
 *
 * ── The paragraph is the reason this page exists ────────────────────────────
 * An agent can reach a report two entirely different ways, and only one of them
 * runs through these terms:
 *
 *   an ACCOUNT here  → a session JWT, `agentUserId` is set, the agent-terms
 *                      gate runs, these terms apply
 *   a report LINK    → an `inspection_access_tokens` bearer. The JWT middleware
 *                      short-circuits before classification, so `agentUserId` is
 *                      never set and the gate never runs. That access comes from
 *                      the agreement between the inspection company and its
 *                      client, and a person who only ever opens report links has
 *                      no account here and is not bound by these terms at all.
 *
 * One person can hold both, from different companies, at the same time. A page
 * that listed only the first without saying so would leave them concluding that
 * their report access flows from a document it has no connection to.
 *
 * ── One document, and no mention of how anyone signed in ────────────────────
 * Signup, `POST /api/agent/login` and `GET /agent/magic-login` mint
 * byte-identical JWTs, and the middleware sets `agentUserId` from the
 * classification alone — it cannot tell them apart, and neither can this page.
 * Copy that named a sign-in route would be an invention. Only the moment of
 * capture ever differed, and the acceptance is the same act either way.
 */

export function meta() {
  return [{ title: m.agent_portal_legal_meta_title() }];
}

/** One acceptance, as the page renders it. Mirrors the API's row shape. */
export interface AcceptanceRow {
  version: string;
  contentHash: string;
  /** Unix milliseconds. */
  acceptedAt: number;
  bodyAvailable: boolean;
  /** The ARCHIVED body of the version accepted, or null. Never a substitute. */
  body: string | null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });

  // `loadFailed` is carried separately from an empty list, because they are
  // different facts about the deployment and only one of them is normal. Saying
  // "nothing has been published" after a read that never answered would be a
  // false statement about the operator, manufactured by an outage.
  try {
    const res = await api.agentTerms.terms.history.$get();
    if (!res.ok) return { acceptances: [] as AcceptanceRow[], loadFailed: true };
    const body = (await res.json()) as { data?: AcceptanceRow[] };
    return { acceptances: body.data ?? [], loadFailed: false };
  } catch {
    return { acceptances: [] as AcceptanceRow[], loadFailed: true };
  }
}

/** The DOM id the row's link points at, and the archived body carries. */
function bodyAnchorId(contentHash: string): string {
  return `agent-terms-${contentHash}`;
}

export default function AgentSettingsLegalPage() {
  const { acceptances, loadFailed } = useLoaderData<typeof loader>();
  const locale = useDisplayLocale();
  const timeZone = useAgentTimeZoneOverride();
  const readable = acceptances.filter((a) => a.bodyAvailable && a.body !== null);

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title={m.agent_portal_legal_title()} meta={m.agent_portal_legal_subtitle()} />

      {/* The record */}
      <section className="bg-ih-bg-card border border-ih-border rounded-xl p-6">
        <p className="text-[11px] font-bold text-ih-fg-3 uppercase tracking-widest mb-1">
          {m.agent_portal_legal_history_eyebrow()}
        </p>
        <h2 className="text-sm font-bold text-ih-fg-1 mb-1">
          {m.agent_portal_legal_history_heading()}
        </h2>
        <p className="text-[13px] text-ih-fg-3 mb-4">{m.agent_portal_legal_history_desc()}</p>

        {loadFailed ? (
          <Banner tone="warn">{m.agent_portal_legal_load_failed()}</Banner>
        ) : acceptances.length === 0 ? (
          // Correct, not broken. A deployment that has published no agent terms
          // has nothing for anyone to accept, and the gate is not enforcing —
          // so an empty page here is the honest report of that state, and the
          // copy says whose action would change it.
          <div className="text-[13px] text-ih-fg-3">
            <p className="font-semibold text-ih-fg-2">{m.agent_portal_legal_empty_title()}</p>
            <p className="mt-1">{m.agent_portal_legal_empty_body()}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {acceptances.map((a) => (
              <li
                key={a.contentHash + a.acceptedAt}
                className="rounded-lg border border-ih-border bg-ih-bg-muted px-4 py-3"
              >
                <p className="text-[13px] font-semibold text-ih-fg-1">
                  {m.agent_portal_legal_version({ version: a.version })}
                </p>
                <p className="text-[12px] text-ih-fg-2 mt-0.5">
                  {m.agent_portal_legal_accepted_at({
                    date: formatDateTime(a.acceptedAt, {
                      locale,
                      ...(timeZone ? { timeZone } : {}),
                    }),
                  })}
                </p>
                <p className="text-[11px] font-mono text-ih-fg-2 mt-0.5 break-all">
                  {m.agent_portal_legal_hash({ hash: a.contentHash })}
                </p>
                {a.bodyAvailable && a.body !== null ? (
                  // Points at THIS version's archived text, keyed on the hash
                  // the acceptance names — never at a shared "current document"
                  // target, which would be a different document wearing the
                  // same label.
                  <a
                    href={`#${bodyAnchorId(a.contentHash)}`}
                    className="inline-block mt-2 text-[12px] font-medium text-ih-primary-text hover:underline"
                  >
                    {m.agent_portal_legal_read()}
                  </a>
                ) : (
                  <p className="mt-2 text-[12px] text-ih-fg-2">
                    {m.agent_portal_legal_body_unavailable()}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* What these terms do NOT cover. Rendered whatever the list holds — it is
          a fact about the product, not a footnote on the data above, and an
          agent with no acceptances still opens report links. */}
      <section className="bg-ih-bg-card border border-ih-border rounded-xl p-6">
        <h2 className="text-sm font-bold text-ih-fg-1 mb-2">
          {m.agent_portal_legal_scope_heading()}
        </h2>
        <p className="text-[13px] leading-relaxed text-ih-fg-2">
          {m.agent_portal_legal_scope_body()}
        </p>
      </section>

      {/* The archived bodies, each under the id its row links to. Rendered in
          full and scrollable rather than excerpted: the acceptance names the
          hash of the WHOLE body, so an excerpt would not be the thing the
          record attests to. */}
      {readable.length > 0 && (
        <section className="bg-ih-bg-card border border-ih-border rounded-xl p-6">
          <h2 className="text-sm font-bold text-ih-fg-1 mb-4">
            {m.agent_portal_legal_archived_heading()}
          </h2>
          <div className="space-y-5">
            {readable.map((a) => (
              <div key={a.contentHash}>
                <h3 className="text-[13px] font-semibold text-ih-fg-2 mb-1.5">
                  {m.agent_portal_legal_version({ version: a.version })}
                </h3>
                <div
                  id={bodyAnchorId(a.contentHash)}
                  tabIndex={0}
                  role="region"
                  aria-label={m.agent_portal_legal_archived_region_label({ version: a.version })}
                  className="max-h-64 overflow-y-auto rounded-xl border border-ih-border bg-ih-bg-muted p-4 text-[13px] leading-relaxed text-ih-fg-2 whitespace-pre-wrap focus:shadow-ih-focus"
                >
                  {a.body}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

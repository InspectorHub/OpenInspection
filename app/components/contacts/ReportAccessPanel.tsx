import { Link, useFetcher } from "react-router";
import { Card } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export interface AccessRow {
  inspectionId: string;
  propertyAddress: string | null;
  role: string;
  createdAt: number;
}

/**
 * "Report access" — the live report links a contact still holds (IA-100).
 *
 * Deliberately its own block rather than a column on the inspection-history
 * list: history answers "what were they part of", this answers "what can they
 * still open", and the two diverge the moment anything is revoked. Showing
 * them as one list would imply they never do.
 *
 * Three states, and they must stay distinguishable, because an operator
 * checking who can still open a report ACTS on the answer: known-and-listed,
 * known-to-be-empty, and lookup-failed. `accessFailed` exists because the
 * loader used to swallow a 400 into an empty array, so the page told an
 * operator "this contact cannot open any reports" about someone holding two
 * live links — a failure rendered as an authoritative negative, which is the
 * dangerous direction here. In that state the revoke controls are withheld
 * too: offering "Revoke all" over an unknown set invites the belief that the
 * action covered everything.
 */
export function ReportAccessPanel({
  access,
  accessFailed,
}: {
  access: AccessRow[];
  accessFailed: boolean;
}) {
  const revokeFetcher = useFetcher<{ ok: boolean; revoked: number }>();
  const revoking = revokeFetcher.state !== "idle";
  // While a revoke is in flight the PREVIOUS result is stale — reporting it
  // would answer the new request with the old request's number.
  const revokeResult = revoking ? null : revokeFetcher.data;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <h2 className="text-[13px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-3">
          {m.contacts_detail_access_heading()}
        </h2>
        {!accessFailed && access.length > 0 && (
          <revokeFetcher.Form method="post">
            <input type="hidden" name="intent" value="revoke-access" />
            <button
              type="submit"
              disabled={revoking}
              className="px-3 h-8 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-bad-fg hover:bg-ih-bg-muted transition-colors disabled:opacity-60"
            >
              {m.contacts_detail_access_revoke_all()}
            </button>
          </revokeFetcher.Form>
        )}
      </div>

      {/* The revoked count is computed honestly server-side precisely so it
          can be reported — "revoked 3" when one had already lapsed would
          teach an operator to trust a number that is not measuring anything.
          It was then being discarded here, which also made a FAILED revoke
          indistinguishable from a successful one: in both cases the page
          simply said nothing. */}
      {revokeResult && (
        <p
          role="status"
          className={`text-[12px] mb-3 ${revokeResult.ok ? "text-ih-fg-3" : "text-ih-bad-fg"}`}
        >
          {!revokeResult.ok
            ? m.contacts_detail_access_revoke_failed()
            : revokeResult.revoked === 0
              ? m.contacts_detail_access_revoked_none()
              : revokeResult.revoked === 1
                ? m.contacts_detail_access_revoked_one()
                : m.contacts_detail_access_revoked_many({ count: revokeResult.revoked })}
        </p>
      )}

      {accessFailed ? (
        <p className="text-[13px] text-ih-bad-fg">
          {m.contacts_detail_access_unavailable()}
        </p>
      ) : access.length === 0 ? (
        <p className="text-[13px] text-ih-fg-3">{m.contacts_detail_access_none()}</p>
      ) : (
        <>
          <p className="text-[12px] text-ih-fg-3 mb-3">
            {m.contacts_detail_access_explainer()}
          </p>
          <div className="divide-y divide-ih-border">
            {access.map((a) => (
              <div key={a.inspectionId} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <Link
                    to={`/inspections/${a.inspectionId}`}
                    className="text-[13px] font-medium text-ih-fg-1 hover:text-ih-primary-text hover:underline"
                  >
                    {a.propertyAddress || a.inspectionId.slice(0, 8)}
                  </Link>
                  {/* TODO(IA-119): this prints the raw enum key (`buyer_agent`).
                      The tenant's role vocabulary already has display labels —
                      Settings -> Inspection roles renders "Buyer's Agent" from
                      the same data — so this should read through it. Left as-is
                      here because the fix belongs with IA-107's consolidation of
                      the three competing role vocabularies, not ahead of it. */}
                  <p className="text-[11px] text-ih-fg-3">{a.role}</p>
                </div>
                <revokeFetcher.Form method="post">
                  <input type="hidden" name="intent" value="revoke-access" />
                  <input type="hidden" name="inspectionId" value={a.inspectionId} />
                  <button
                    type="submit"
                    disabled={revoking}
                    className="text-[12px] font-bold text-ih-fg-3 hover:text-ih-bad-fg hover:underline disabled:opacity-60"
                  >
                    {m.contacts_detail_access_revoke()}
                  </button>
                </revokeFetcher.Form>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

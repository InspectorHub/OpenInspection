import { Link } from "react-router";
import { Table, Pill } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * Settings → Compliance → AI assurance record (read-only).
 *
 * THE ROW IS THE CALL, NOT THE REVIEW, and the nesting direction is the schema's:
 * `ai_content_reviews` points at `ai_call_provenance`, never the reverse. Listing
 * reviews would answer "what did we confirm", which nobody asks; listing calls
 * answers "what did a model write, and did anyone look at it", which is the
 * question that carries professional liability.
 *
 * THE ONLY COLOR IN THIS TABLE MARKS AN UNREVIEWED CALL. Model, prompt version
 * and credential source are facts; "nobody reviewed this" is the risk, so it is
 * the single thing allowed to be loud. Everything else stays monochrome and
 * tabular so the eye lands on the one column that matters.
 *
 * Paging is a plain link, not a fetcher: this is an append-only ledger read
 * backwards, so the cursor belongs in the URL where it can be shared, bookmarked
 * and pasted into a compliance response.
 */

export interface AiReviewRow {
  id: string;
  artifactType: string;
  artifactId: string;
  reviewedBy: string;
  reviewerName: string | null;
  reviewedAt: number;
}

export interface AiAssuranceRow {
  id: string;
  capability: string;
  provider: string;
  mode: string;
  model: string;
  promptVersion: string;
  calledAt: number;
  reviews: AiReviewRow[];
}

export interface AiAssuranceInitial {
  calls: AiAssuranceRow[];
  unresolvedReviewCount: number;
  nextBefore: number | null;
  /** Cursor the current page was loaded with, so "back to latest" can hide. */
  activeBefore: number | null;
}

function formatWhen(ms: number): string {
  try {
    return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  } catch {
    return "—";
  }
}

export function AiAssurancePanel({ initial }: { initial: AiAssuranceInitial }) {
  const { calls, unresolvedReviewCount, nextBefore, activeBefore } = initial;
  const unreviewed = calls.filter((c) => c.reviews.length === 0).length;

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <div>
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
          {m.settings_compliance_ai_heading()}
        </h3>
        <p className="text-[12px] text-ih-fg-3 mt-1">{m.settings_compliance_ai_desc()}</p>
      </div>

      {unreviewed > 0 && (
        <p className="text-[12px] font-bold text-ih-bad-fg">
          {m.settings_compliance_ai_unreviewed({ count: unreviewed, total: calls.length })}
        </p>
      )}
      {unresolvedReviewCount > 0 && (
        <p className="text-[12px] text-ih-fg-2">
          {m.settings_compliance_ai_unresolved({ count: unresolvedReviewCount })}
        </p>
      )}

      {calls.length === 0 ? (
        // With a cursor active, "nothing has been drafted with AI" would be a
        // lie — the ledger has rows, this page of it does not.
        <p className="text-[12px] text-ih-fg-3 italic">
          {activeBefore === null
            ? m.settings_compliance_ai_empty()
            : m.settings_compliance_ai_empty_page()}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table<AiAssuranceRow>
            rows={calls}
            getRowKey={(r) => r.id}
            columns={[
              {
                label: m.settings_compliance_ai_col_when(),
                cell: (r) => (
                  <span className="text-ih-fg-2 whitespace-nowrap tabular-nums">{formatWhen(r.calledAt)}</span>
                ),
              },
              {
                // Model and capability share a cell because they are one
                // thought — what ran. Splitting them cost a column the review
                // state needed, and the review state is what the reader is for.
                label: m.settings_compliance_ai_col_model(),
                cell: (r) => (
                  <>
                    <span className="block text-ih-fg-1 font-medium whitespace-nowrap">{r.model}</span>
                    <span className="block text-[11px] text-ih-fg-3">{r.capability}</span>
                  </>
                ),
              },
              {
                label: m.settings_compliance_ai_col_prompt(),
                cell: (r) => <span className="text-ih-fg-2 whitespace-nowrap">{r.promptVersion}</span>,
              },
              {
                label: m.settings_compliance_ai_col_credentials(),
                cell: (r) => (
                  <span className="text-ih-fg-2 whitespace-nowrap">
                    {r.mode === "managed"
                      ? m.settings_compliance_ai_mode_managed()
                      : m.settings_compliance_ai_mode_byo()}
                  </span>
                ),
              },
              {
                label: m.settings_compliance_ai_col_review(),
                cell: (r) =>
                  r.reviews.length === 0 ? (
                    <Pill tone="defect" className="uppercase tracking-wide">
                      {m.settings_compliance_ai_not_reviewed()}
                    </Pill>
                  ) : (
                    <ul className="space-y-1.5">
                      {r.reviews.map((rev) => (
                        <li key={rev.id}>
                          <span className="block text-ih-fg-2">{rev.reviewerName ?? rev.reviewedBy}</span>
                          <span className="block text-[11px] text-ih-fg-3 tabular-nums whitespace-nowrap">
                            {formatWhen(rev.reviewedAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ),
              },
            ]}
          />
        </div>
      )}

      {(nextBefore !== null || activeBefore !== null) && (
        <div className="flex items-center gap-4">
          {nextBefore !== null && (
            <Link
              to={`?aiBefore=${nextBefore}`}
              className="text-[12px] font-bold text-ih-primary-text hover:underline"
            >
              {m.settings_compliance_ai_older()}
            </Link>
          )}
          {activeBefore !== null && (
            <Link to="?" className="text-[12px] font-bold text-ih-fg-2 hover:underline">
              {m.settings_compliance_ai_latest()}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

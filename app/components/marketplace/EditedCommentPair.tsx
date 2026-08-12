import { m } from "~/paraglide/messages";
import { formatDate } from "~/lib/format";

export interface EditedCommentPairData {
  commentId: string;
  section: string | null;
  yours: string;
  editedAt: number | null;
  published: { kind: "changed" | "unchanged" | "removed"; text: string | null };
}

interface EditedCommentPairProps {
  pair: EditedCommentPairData;
  /** Version the publisher is offering, e.g. "2.0.0". */
  toSemver: string;
  /** True once the reader has chosen to replace everything. */
  doomed: boolean;
  locale: string;
}

const LABEL = "text-[10px] font-bold uppercase tracking-[0.2em]";

/**
 * One conflict, as a pair: what the inspector wrote, beside what the publisher
 * is offering to put there instead.
 *
 * The two halves sit at different surface elevations on purpose. The
 * inspector's text is at card level — it is the status quo, already in their
 * library and already going out on reports, so it is rendered as ordinary body
 * text rather than as an anomaly. The publisher's text is one step recessed
 * into the muted surface: a proposal, not a fait accompli. That difference
 * carries the argument without a word of explanation.
 *
 * `ih-bad` appears only when `doomed` is true. The danger colour follows the
 * reader's choice rather than sitting on the page permanently — the page shows
 * the bill instead of asking "are you sure" afterwards.
 */
export function EditedCommentPair({ pair, toSemver, doomed, locale }: EditedCommentPairProps) {
  const publishedLabel =
    pair.published.kind === "unchanged" ? m.marketplace_update_published_unchanged({ semver: toSemver })
    : pair.published.kind === "removed"  ? m.marketplace_update_published_removed({ semver: toSemver })
    : m.marketplace_update_published_changed({ semver: toSemver });

  return (
    <li
      className={[
        "rounded-ih-card border overflow-hidden transition-colors duration-200",
        doomed ? "border-ih-bad" : "border-ih-border",
      ].join(" ")}
    >
      <div className="grid md:grid-cols-2">
        {/* Theirs — the words at stake. */}
        <div
          className={[
            "p-4 transition-colors duration-200",
            doomed ? "bg-ih-bad-bg" : "bg-ih-bg-card",
          ].join(" ")}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className={`${LABEL} ${doomed ? "text-ih-bad-fg" : "text-ih-fg-3"}`}>
              {m.marketplace_update_yours_label()}
              {pair.section ? ` · ${pair.section}` : ""}
            </span>
            <span className="text-[11px] text-ih-fg-3 shrink-0">
              {pair.editedAt
                ? m.marketplace_update_edited_on({ date: formatDate(new Date(pair.editedAt), { locale }) })
                : m.marketplace_update_edited_unknown()}
            </span>
          </div>
          <p
            className={[
              "font-ih-body text-[14px] leading-relaxed mt-2 transition-colors duration-200",
              doomed ? "line-through text-ih-bad-fg" : "text-ih-fg-1",
            ].join(" ")}
          >
            {pair.yours}
          </p>
        </div>

        {/* The publisher's — recessed, because it is only an offer. */}
        <div className="p-4 bg-ih-bg-muted border-t md:border-t-0 md:border-l border-ih-border">
          <span className={`${LABEL} text-ih-fg-3`}>{publishedLabel}</span>
          {pair.published.text ? (
            <p className="font-ih-body text-[14px] leading-relaxed mt-2 text-ih-fg-3">
              {pair.published.text}
            </p>
          ) : (
            <p className="font-ih-body text-[14px] leading-relaxed mt-2 text-ih-fg-3 italic">
              {m.marketplace_update_removed_note()}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

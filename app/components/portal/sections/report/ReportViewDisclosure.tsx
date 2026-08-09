/**
 * <ReportViewDisclosure> — the Art. 13 notice on the report page, and the
 * Art. 21 control it promises (OI #271, LIA conditions 4 and 5).
 *
 * The counter this describes is `report_views`: three integers written on the
 * server when a report page renders for a recipient holding a live portal
 * token. `docs/compliance/report-view-lia.md` §3.2 makes the notice part of the
 * balancing test rather than something running alongside it — *"Remove the
 * disclosure and this assessment fails."* Deleting this component does not
 * degrade the page; it takes the counter outside its lawful basis.
 *
 * THREE THINGS THAT ARE REQUIREMENTS, NOT STYLE:
 *
 *  1. **The order is fact → limit → exit**, and the middle one is load-bearing.
 *     The necessity test passes BECAUSE no IP address, no device signal and no
 *     per-finding trail exist; a notice that states only the fact invites the
 *     reader to assume the ordinary shape of web tracking, which understates
 *     the design rather than overstating it.
 *  2. **"and keep your report".** An objection about being MEASURED answered by
 *     withdrawing ACCESS is the remedy external review rejected. The server
 *     refuses it (`writeViewTrackingObjection` touches neither `revokedAt` nor
 *     `expiresAt`); this component must not re-introduce it in words.
 *  3. **Permanent and uncollapsed.** No `<details>`, no "privacy" accordion. A
 *     notice a reader has to open is one most readers never see, and the
 *     co-located test asserts the absence.
 *
 * WHY IT IS AN ANCHOR. `id="view-tracking"` is where the emailed exit link
 * lands (`<reportUrl>#view-tracking`, built by
 * `server/lib/legal/report-view-disclosure.ts`). Renaming it strands the link
 * in every message already delivered.
 *
 * WHY THE CONTROL POSTS TO A NAMED RESOURCE ROUTE. <ReportView> has two route
 * homes — the standalone report page and the inline Hub mount — so "post to the
 * current route" would work in one and silently no-op in the other.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { useFetcher } from "react-router";
import { m } from "~/paraglide/messages";
import { REPORT_VIEW_DISCLOSURE_VERSION } from "./report-view-disclosure-version";
import type { ViewTrackingActionResult } from "~/routes/resources/view-tracking";

export interface ReportViewDisclosureProps {
  /** The order whose report is being read; the objection is per recipient on it. */
  inspectionId?: string;
  /** The emailed report link's `?token=`, when the reader arrived by one. */
  token?: string | undefined;
  /** Whether this recipient has already objected, resolved by the loader. */
  objected?: boolean;
  /** Headless PDF render — see below. */
  printMode?: boolean;
}

export function ReportViewDisclosure({
  inspectionId,
  token,
  objected = false,
  printMode = false,
}: ReportViewDisclosureProps) {
  const fetcher = useFetcher<ViewTrackingActionResult>();
  const busy = fetcher.state !== "idle";
  // The stored answer wins over the loader's snapshot the moment we have one,
  // so the control reflects what the server did rather than what was true when
  // the page was rendered.
  const current = fetcher.data?.ok ? fetcher.data.objected : objected;
  const failed = fetcher.state === "idle" && fetcher.data != null && !fetcher.data.ok;

  // The PDF is a document the recipient keeps; a live control printed into it
  // is a dead control, and the notice still reaches them twice — in the email
  // that carried the link and on the web page. Rendering nothing here is not a
  // gap in conditions 4/5.
  if (printMode) return null;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 mb-8">
      <section
        id="view-tracking"
        data-disclosure-version={REPORT_VIEW_DISCLOSURE_VERSION}
        aria-labelledby="view-tracking-heading"
        className="border border-ih-border rounded-xl p-5 bg-ih-bg-card"
      >
        <h2
          id="view-tracking-heading"
          className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-2"
        >
          {m.report_view_disclosure_heading()}
        </h2>
        <p className="text-[13px] leading-relaxed text-ih-fg-3">
          {m.report_view_disclosure_fact()}{" "}
          {/* The sentence that must never be trimmed for length. */}
          <span className="text-ih-fg-2">{m.report_view_disclosure_limit()}</span>{" "}
          {m.report_view_disclosure_exit()}
        </p>

        {current && (
          <p className="mt-2 text-[13px] leading-relaxed text-ih-fg-2">
            {/* Art. 21 is not Art. 17: future collection stops, history is not
                cleared, and saying so is more honest than letting the reader
                assume the counters were wiped. */}
            {m.report_view_disclosure_off_state()}
          </p>
        )}

        <fetcher.Form method="post" action="/resources/view-tracking" className="mt-3">
          <input type="hidden" name="inspectionId" value={inspectionId ?? ""} />
          <input type="hidden" name="token" value={token ?? ""} />
          {/* An explicit target state, never a toggle: a retried submit must
              land on the same answer, and the API keeps the ORIGINAL objection
              date when it is asked twice. */}
          <input type="hidden" name="objected" value={current ? "false" : "true"} />
          <button
            type="submit"
            disabled={busy || !inspectionId}
            className="inline-flex h-8 items-center px-3 rounded-lg border border-ih-border bg-ih-bg-card text-[12px] font-semibold text-ih-fg-2 hover:text-ih-fg-1 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy
              ? m.report_view_disclosure_busy()
              : current
                ? m.report_view_disclosure_turn_on()
                : m.report_view_disclosure_turn_off()}
          </button>
        </fetcher.Form>

        {failed && (
          <p className="mt-2 text-[12px] text-ih-bad-fg">{m.report_view_disclosure_error()}</p>
        )}
      </section>
    </div>
  );
}

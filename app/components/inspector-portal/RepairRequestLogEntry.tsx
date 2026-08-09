/**
 * <RepairRequestLogEntry> — one submitted repair request list, as the
 * inspection company reads it (#69).
 *
 * READ ONLY, deliberately and structurally: this component takes no callbacks,
 * so there is nothing a future edit can wire a control to without changing its
 * signature. The list is the buyer's negotiating document; the company is a
 * reader of it, and the industry surface this is modelled on (Spectora's RRB
 * Log) offers no reply either.
 *
 * ⚠️ It renders <RepairDefectRowView>, the inner presentational row — NOT
 * <RepairDefectRow>. The outer one carries the builder's checkbox, credit
 * input, note field and the #275 action SELECT, and it requires `onUpdateTag`.
 * A tag control on this surface would let staff author the buyer's ask, which
 * `mayAuthorRepairActionTag` refuses at the API boundary; the row that renders
 * one has no business on a page whose writes would 403.
 *
 * The defect and the ask are separated on purpose. Everything
 * <RepairDefectRowView> shows was written by the inspector — the defect title,
 * the comment, the recommended trade. Everything in the "asked for" strip was
 * written by the buyer or their agent. The public share page keeps the same two
 * voices in different columns for the same reason; here the split is vertical,
 * with a rule marking where the company stops reading its own words.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { Card, Pill } from "@core/shared-ui";
import { RepairDefectRowView } from "~/components/portal/sections/repair/RepairDefectRowView";
import { formatCents } from "~/lib/money";
import type { RepairActionTag } from "~/lib/repair-action-tag";
import { m } from "~/paraglide/messages";

/** Not exported: it reaches every caller through `RepairRequestLogList.items`,
 *  and an export nothing imports is what `lint:deadcode` is for. */
interface RepairRequestLogItem {
  id: string;
  sectionTitle: string;
  itemLabel: string;
  defectTitle: string;
  location: string | null;
  comment: string | null;
  category: string;
  note: string | null;
  requestedCreditCents: number | null;
  actionTag: RepairActionTag | null;
}

export interface RepairRequestLogList {
  id: string;
  createdByKind: "client" | "agent" | "inspector";
  createdByRef: string;
  customIntro: string | null;
  /** Already formatted by the page, which owns the viewer's time zone. */
  createdAtDisplay: string;
  creditTotalCents: number;
  items: RepairRequestLogItem[];
}

/** Resolved at call time so paraglide's locale scope is the request's. */
function creatorLabel(kind: RepairRequestLogList["createdByKind"]): string {
  switch (kind) {
    case "client":
      return m.inspections_repair_log_by_client();
    case "agent":
      return m.inspections_repair_log_by_agent();
    case "inspector":
      return m.inspections_repair_log_by_inspector();
  }
}

/** Exhaustive over `RepairActionTag`: a new value fails the build here rather
 *  than rendering a raw enum word. Same switch as the share page's. */
function actionTagLabel(tag: RepairActionTag): string {
  switch (tag) {
    case "repair":
      return m.repair_request_action_tag_repair();
    case "replace":
      return m.repair_request_action_tag_replace();
    case "fund":
      return m.repair_request_action_tag_fund();
    case "other":
      return m.repair_request_action_tag_other();
  }
}

export function RepairRequestLogEntry({ list }: { list: RepairRequestLogList }) {
  return (
    // The testid rides a wrapper because `Card` takes only `className`/`id`,
    // and widening a design-system component's prop surface for a test hook is
    // the wrong trade.
    <section data-testid={`repair-log-entry-${list.id}`}>
      <Card className="p-0 overflow-hidden">
        {/* Attribution strip — a log of several lists is unreadable unless each
            one says who asked and when. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 bg-ih-bg-app/30 border-b border-ih-border">
          <Pill tone={list.createdByKind === "inspector" ? "neutral" : "primary"}>
            {creatorLabel(list.createdByKind)}
          </Pill>
          <span className="text-[13px] font-semibold text-ih-fg-1 truncate min-w-0">
            {list.createdByRef}
          </span>
          <span className="text-[12px] text-ih-fg-3">{list.createdAtDisplay}</span>
          <span className="ml-auto flex items-center gap-3 shrink-0">
            <span className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest">
              {list.items.length === 1
                ? m.inspections_repair_log_items_one()
                : m.inspections_repair_log_items_other({ count: list.items.length })}
            </span>
            {/* Only when money was actually asked for. A "$0.00" total on a list
                of pure repair requests reads as a credit request for nothing. */}
            {list.creditTotalCents > 0 && (
              <span className="text-[13px] font-bold tabular-nums text-ih-fg-1">
                {formatCents(list.creditTotalCents)}
              </span>
            )}
          </span>
        </div>

        {list.customIntro && (
          <p className="px-5 pt-4 text-[13px] leading-relaxed text-ih-fg-2 italic">
            {list.customIntro}
          </p>
        )}

        {list.items.length === 0 ? (
          <p className="px-5 py-4 text-[12px] text-ih-fg-3">
            {m.inspections_repair_log_list_empty()}
          </p>
        ) : (
          <ul className="p-5 space-y-3">
            {list.items.map((item) => {
              const hasAsk =
                item.actionTag !== null || item.requestedCreditCents !== null || !!item.note;
              return (
                <li
                  key={item.id}
                  data-testid="repair-log-item"
                  className="border border-ih-border rounded-md bg-ih-bg-app/30"
                >
                  <div className="flex items-start gap-3 p-4">
                    <RepairDefectRowView
                      sectionTitle={item.sectionTitle}
                      itemLabel={item.itemLabel}
                      defectTitle={item.defectTitle}
                      location={item.location}
                      comment={item.comment}
                      category={item.category}
                    />
                  </div>

                  {/* Below the rule, the words are the buyer's. Absent entirely
                      when they said nothing — an empty "Asked for" heading would
                      claim they were asked and declined to answer. */}
                  {hasAsk && (
                    <div
                      data-testid="repair-log-ask"
                      className="mx-4 mb-4 pl-3 border-l-2 border-ih-primary/50 space-y-1"
                    >
                      <p className="text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest">
                        {m.inspections_repair_log_ask_heading()}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {item.actionTag && (
                          <span
                            data-testid="repair-log-ask-tag"
                            className="text-[13px] font-semibold text-ih-fg-1"
                          >
                            {actionTagLabel(item.actionTag)}
                          </span>
                        )}
                        {item.requestedCreditCents !== null && (
                          <span className="text-[13px] font-bold tabular-nums text-ih-fg-1">
                            {formatCents(item.requestedCreditCents)}
                          </span>
                        )}
                      </div>
                      {item.note && (
                        <p className="text-[12px] text-ih-fg-2 leading-relaxed">{item.note}</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}

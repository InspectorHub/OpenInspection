import { useLoaderData } from "react-router";
import type { Route } from "./+types/repair-request.$shareToken";
import { createApi } from "~/lib/api-client.server";
import { PublicNotice } from "~/components/PublicNotice";
import { formatCents } from "~/lib/money";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.repair_request_meta_title() }];
}

// ---------------------------------------------------------------------------
// Pure model — testable without a Hono context or DOM.
// ---------------------------------------------------------------------------

interface ShareItem {
  sectionTitle: string;
  itemLabel: string;
  // IA-55 — snapshots so the shared list is distinguishable, locatable, tagged.
  defectTitleSnapshot?: string | null;
  locationSnapshot?: string | null;
  categorySnapshot?: string | null;
  // IA-57 — the recommended trade, so a contractor reading the shared list can
  // see which trade the inspector called for instead of inferring it from prose.
  tradeSnapshot?: string | null;
  commentSnapshot: string | null;
  requestedCreditCents: number | null;
  note: string | null;
}

interface ShareApiData {
  notPublished?: boolean;
  propertyAddress?: string | null;
  customIntro?: string | null;
  creditTotal?: number;
  items?: ShareItem[];
}

export interface ShareViewRow {
  sectionTitle: string;
  itemLabel: string;
  defectTitle: string | null;
  location: string | null;
  category: string | null;
  trade: string | null;
  comment: string;
  note: string | null;
  creditDisplay: string;
}

export interface ShareViewModel {
  state: "ok" | "not_published";
  propertyAddress?: string | null;
  customIntro?: string | null;
  creditTotalDisplay?: string;
  rows: ShareViewRow[];
}

export function shareViewModel(data: ShareApiData): ShareViewModel {
  if (data.notPublished) {
    return { state: "not_published", rows: [] };
  }
  const items = data.items ?? [];
  const rows: ShareViewRow[] = items.map((item) => ({
    sectionTitle: item.sectionTitle,
    itemLabel: item.itemLabel,
    defectTitle: item.defectTitleSnapshot ?? null,
    location: item.locationSnapshot ?? null,
    category: item.categorySnapshot ?? null,
    trade: item.tradeSnapshot ?? null,
    comment: item.commentSnapshot ?? "",
    note: item.note ?? null,
    creditDisplay:
      item.requestedCreditCents == null
        ? "—"
        : formatCents(item.requestedCreditCents),
  }));
  return {
    state: "ok",
    propertyAddress: data.propertyAddress,
    customIntro: data.customIntro,
    creditTotalDisplay: formatCents(data.creditTotal ?? 0),
    rows,
  };
}

/** IA-55/IA-60 — localize the built-in category snapshot; a tenant custom
 *  category snapshot (rare) falls back to its stored value. Resolved at call
 *  time for the paraglide locale scope. */
function sharePriorityLabel(category: string): string {
  switch (category) {
    case "safety": return m.portal_repair_category_safety();
    case "recommendation": return m.portal_repair_category_recommendation();
    case "maintenance": return m.portal_repair_category_maintenance();
    default: return category;
  }
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

type LoaderResult =
  | { kind: "ok"; vm: ShareViewModel }
  | { kind: "not_published" }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

export async function loader({
  params,
  context,
}: Route.LoaderArgs): Promise<LoaderResult> {
  const shareToken = params.shareToken ?? "";
  const api = createApi(context);

  try {
    const res = await api.repairBuilder["repair-request"].share[
      ":shareToken"
    ].$get({
      param: { shareToken },
    });

    if (res.status === 403) {
      return { kind: "not_published" };
    }
    if (res.status === 404) {
      return { kind: "not_found" };
    }
    if (!res.ok) {
      return { kind: "error", message: m.repair_request_error_service_unavailable() };
    }

    const body = await res.json();
    const d = ((body as Record<string, unknown>).data ?? {}) as ShareApiData;
    const vm = shareViewModel(d);
    return { kind: "ok", vm };
  } catch {
    return { kind: "error", message: "Service unavailable" };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RepairRequestSharePage() {
  const result = useLoaderData<typeof loader>();

  if (result.kind === "not_found") {
    return (
      <PublicNotice title={m.repair_request_notfound_title()}>
        {m.repair_request_notfound_body()}
      </PublicNotice>
    );
  }

  if (result.kind === "error") {
    return (
      <PublicNotice title={m.repair_request_error_title()} tone="error">
        {result.message}
      </PublicNotice>
    );
  }

  if (result.kind === "not_published") {
    return (
      <PublicNotice title={m.repair_request_notpublished_title()}>
        {m.repair_request_notpublished_body()}
      </PublicNotice>
    );
  }

  // kind === "ok"
  const { vm } = result;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 print:py-4">
      {/* Header */}
      <header className="mb-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-4 mb-1">
          {m.repair_request_eyebrow()}
        </p>
        <h1 className="text-[24px] sm:text-[28px] font-semibold tracking-tight text-ih-fg-1 leading-tight">
          {vm.propertyAddress}
        </h1>
        {vm.customIntro && (
          <p className="text-[14px] text-ih-fg-2 mt-3 leading-relaxed">
            {vm.customIntro}
          </p>
        )}
      </header>

      {/* Items */}
      {vm.rows.length === 0 ? (
        <div className="text-center py-12 px-6 rounded-md bg-ih-ok-bg border border-ih-ok">
          <p className="text-[14px] text-ih-ok-fg font-semibold">
            {m.repair_request_empty()}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-ih-border overflow-hidden mb-8">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_1fr_2fr_auto_1fr_auto] gap-0 bg-ih-bg-muted border-b border-ih-border px-4 py-2 text-[11px] font-bold uppercase tracking-[0.15em] text-ih-fg-4">
            <span>{m.repair_request_col_section()}</span>
            <span>{m.repair_request_col_item()}</span>
            <span>{m.repair_request_col_finding()}</span>
            <span>{m.repair_request_col_priority()}</span>
            <span>{m.repair_request_col_note()}</span>
            <span className="text-right min-w-[80px]">{m.repair_request_col_credit()}</span>
          </div>
          {/* Rows — IA-55: the Finding cell now leads with the defect's own
              title + location so two defects on one item are distinguishable
              and locatable; Priority surfaces the category the client sorted by. */}
          {vm.rows.map((row, i) => (
            <div
              key={i}
              className={`grid grid-cols-[1fr_1fr_2fr_auto_1fr_auto] gap-0 px-4 py-3 text-[13px] ${
                i < vm.rows.length - 1 ? "border-b border-ih-border" : ""
              }`}
            >
              <span className="text-ih-fg-3 pr-3">{row.sectionTitle}</span>
              <span className="text-ih-fg-1 font-medium pr-3">{row.itemLabel}</span>
              <span className="pr-3 leading-snug">
                {row.defectTitle && (
                  <span className="block font-semibold text-ih-fg-1">{row.defectTitle}</span>
                )}
                {row.location && (
                  <span className="block text-[11px] text-ih-fg-4">
                    {m.repair_request_col_location_prefix()} {row.location}
                  </span>
                )}
                {row.comment && <span className="block text-ih-fg-2">{row.comment}</span>}
                {/* IA-57 — the recommended trade gets its own labelled line so
                    the contractor sees who to send even when the canned prose
                    never mentioned it. */}
                {row.trade && (
                  <span
                    data-testid="share-row-trade"
                    className="block text-[11px] text-ih-fg-4"
                  >
                    <span className="font-bold uppercase tracking-wider">
                      {m.repair_request_col_trade_prefix()}
                    </span>{" "}
                    {row.trade}
                  </span>
                )}
              </span>
              <span className="pr-3">
                {row.category && (
                  <span className="inline-flex items-center h-5 px-2 rounded bg-ih-bg-muted text-ih-fg-3 text-[10px] font-bold uppercase tracking-wider">
                    {sharePriorityLabel(row.category)}
                  </span>
                )}
              </span>
              <span className="text-ih-fg-3 pr-3 leading-snug">{row.note ?? ""}</span>
              <span className="text-right font-mono tabular-nums text-ih-fg-1 min-w-[80px]">
                {row.creditDisplay}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Credit Total */}
      {vm.rows.length > 0 && (
        <div className="flex items-center justify-between rounded-lg bg-ih-ok-bg border border-ih-ok px-5 py-4 mb-8">
          <span className="text-[14px] font-bold text-ih-ok-fg uppercase tracking-wide">
            {m.repair_request_total_label()}
          </span>
          <span className="text-[22px] font-bold tabular-nums text-ih-ok-fg">
            {vm.creditTotalDisplay}
          </span>
        </div>
      )}

      {/* Footer */}
      <footer className="print:hidden mt-10 pt-6 border-t border-ih-border text-[11px] text-ih-fg-4 text-center">
        {m.repair_request_footer_1()}{" "}
        <strong className="text-ih-fg-3">OpenInspection</strong>{m.repair_request_footer_2()}
      </footer>
    </div>
  );
}

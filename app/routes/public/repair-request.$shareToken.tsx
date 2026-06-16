import { useLoaderData } from "react-router";
import type { Route } from "./+types/repair-request.$shareToken";
import { createApi } from "~/lib/api-client.server";

export function meta() {
  return [{ title: "Repair Request - OpenInspection" }];
}

// ---------------------------------------------------------------------------
// Pure model — testable without a Hono context or DOM.
// ---------------------------------------------------------------------------

interface ShareItem {
  sectionTitle: string;
  itemLabel: string;
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

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function shareViewModel(data: ShareApiData): ShareViewModel {
  if (data.notPublished) {
    return { state: "not_published", rows: [] };
  }
  const items = data.items ?? [];
  const rows: ShareViewRow[] = items.map((item) => ({
    sectionTitle: item.sectionTitle,
    itemLabel: item.itemLabel,
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
      return { kind: "error", message: "Service unavailable" };
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
      <div className="max-w-xl mx-auto p-6 text-center">
        <h1 className="text-2xl font-bold text-ih-fg-1">Not Found</h1>
        <p className="text-ih-fg-3 mt-2 text-[14px]">
          This repair request link is invalid or has expired.
        </p>
      </div>
    );
  }

  if (result.kind === "error") {
    return (
      <div className="max-w-xl mx-auto p-6 text-center">
        <h1 className="text-2xl font-bold text-ih-bad-fg">Error</h1>
        <p className="text-ih-fg-3 mt-2 text-[14px]">{result.message}</p>
      </div>
    );
  }

  if (result.kind === "not_published") {
    return (
      <div className="max-w-xl mx-auto p-6">
        <div className="rounded-lg bg-ih-bad-bg text-ih-bad-fg p-4 text-center mb-6">
          <p className="text-lg font-bold">Not published</p>
          <p className="text-[13px] mt-1">This report is not published.</p>
        </div>
      </div>
    );
  }

  // kind === "ok"
  const { vm } = result;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 print:py-4">
      {/* Header */}
      <header className="mb-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-4 mb-1">
          Repair Request
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
            No repair items have been listed.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-ih-border overflow-hidden mb-8">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_1fr_2fr_1fr_auto] gap-0 bg-ih-bg-muted border-b border-ih-border px-4 py-2 text-[11px] font-bold uppercase tracking-[0.15em] text-ih-fg-4">
            <span>Section</span>
            <span>Item</span>
            <span>Finding</span>
            <span>Note</span>
            <span className="text-right min-w-[80px]">Credit</span>
          </div>
          {/* Rows */}
          {vm.rows.map((row, i) => (
            <div
              key={i}
              className={`grid grid-cols-[1fr_1fr_2fr_1fr_auto] gap-0 px-4 py-3 text-[13px] ${
                i < vm.rows.length - 1 ? "border-b border-ih-border" : ""
              }`}
            >
              <span className="text-ih-fg-3 pr-3">{row.sectionTitle}</span>
              <span className="text-ih-fg-1 font-medium pr-3">{row.itemLabel}</span>
              <span className="text-ih-fg-2 pr-3 leading-snug">{row.comment}</span>
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
            Total Requested Credit
          </span>
          <span className="text-[22px] font-bold tabular-nums text-ih-ok-fg">
            {vm.creditTotalDisplay}
          </span>
        </div>
      )}

      {/* Footer */}
      <footer className="print:hidden mt-10 pt-6 border-t border-ih-border text-[11px] text-ih-fg-4 text-center">
        Generated by{" "}
        <strong className="text-ih-fg-3">OpenInspection</strong>. This list
        reflects the buyer's repair and credit requests and does not constitute
        a legally binding agreement.
      </footer>
    </div>
  );
}

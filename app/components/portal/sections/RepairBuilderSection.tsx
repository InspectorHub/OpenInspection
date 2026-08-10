/**
 * <RepairBuilderSection> — the interactive Repair Request Builder, extracted from
 * the standalone route `app/routes/public/repair-builder.$tenant.$id.tsx` so it
 * can be rendered BOTH as a standalone page AND inline inside the unified
 * client-portal Hub (section ⑥, "Repair").
 *
 * Data-source-agnostic: receives everything via the `result` prop (no
 * `useLoaderData`). The host (standalone route OR Hub route) supplies the loader
 * result and the `actionPath` that the internal fetchers must post to.
 *
 * Bare-content convention — it renders the section content ONLY; the page chrome
 * (page background, full-page shell) is supplied by the host. The gated-state
 * mini-cards are `max-w-xl mx-auto` blocks (fine inline).
 *
 * Action targeting — the four `useFetcher().submit(...)` calls explicitly target
 * `actionPath` so they always hit the repair-builder route's action regardless of
 * which route the component is mounted under (critical when mounted inside the
 * Hub route, whose own action would otherwise be hit).
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { useState, useCallback, useEffect } from "react";
import { useFetcher } from "react-router";
import { m } from "~/paraglide/messages";
import { RepairDefectRow } from "./repair/RepairDefectRow";
import { useRepairOpQueue } from "./repair/useRepairOpQueue";
import { useRepairItemDrafts } from "./repair/useRepairItemDrafts";
import type { RepairActionTag } from "~/lib/repair-action-tag";
import { resolveQuickPhrases, seedQuickPhrases } from "~/lib/repair-quick-phrases";
import { RepairIntroPanel } from "./repair/RepairIntroPanel";
import { RepairSharePanel } from "./repair/RepairSharePanel";
import { formatCents } from "~/lib/money";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Defect {
  findingKey: string;
  sectionId: string;
  sectionTitle: string;
  itemId: string;
  itemLabel: string;
  // IA-55 — the defect's own title + location, so the list is distinguishable
  // and locatable (both snapshotted onto the item when added).
  defectTitle: string;
  location: string | null;
  comment: string;
  category: "safety" | "recommendation" | "maintenance";
  // IA-42 — the rating-axis severity of the parent item (getRatingBucket
  // domain). Distinct from `category`; drives the real "Severity" sort.
  severityBucket: "satisfactory" | "monitor" | "defect" | "other";
  // IA-57 — the recommended trade as a resolved label ("licensed roofer"),
  // snapshotted onto the item so the shared list names the trade to send.
  trade: string | null;
  // No estimate fields, deliberately. The builder's only money field is the
  // client's own credit request; a supplied cost figure rendered beside it
  // reads as the inspection company's price for the repair.
}

export interface RepairRequestItem {
  id: string;
  findingKey: string;
  sectionTitle: string;
  itemLabel: string;
  commentSnapshot: string | null;
  requestedCreditCents: number | null;
  note: string | null;
  sortOrder: number | null;
  /** #275 — repair / replace / fund / other; null when the buyer never tagged it. */
  repairActionTag: RepairActionTag | null;
}

export interface RepairRequest {
  id: string;
  inspectionId: string;
  tenantId: string;
  customIntro: string | null;
  shareToken: string | null;
  items?: RepairRequestItem[];
}

export type LoaderResult =
  // #275 — `quickPhrases` is the tenant's stored list, VERBATIM: null means
  // "never configured" (show the seeded defaults) and [] means "the tenant
  // turned the buttons off". Both client entry points must carry it or the
  // buttons appear on /repair-builder/… and vanish inside the Hub.
  | { kind: "ok"; defects: Defect[]; mine: RepairRequest[]; tenant: string; id: string; token: string | null; quickPhrases: string[] | null }
  | { kind: "no_access" }
  | { kind: "not_published" }
  | { kind: "forbidden" }
  | { kind: "error" };

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit tests
// ---------------------------------------------------------------------------

export function builderCreditTotal(
  items: { requestedCreditCents?: number | null }[],
): number {
  return items.reduce((sum, it) => sum + (it.requestedCreditCents ?? 0), 0);
}

// IA-42 — the CATEGORY axis (safety/recommendation/maintenance). Renamed from
// the misleading SEVERITY_RANK: it never ranked severity, it ranked category.
const CATEGORY_RANK: Record<string, number> = {
  safety: 0,
  recommendation: 1,
  maintenance: 2,
};

// IA-42 — the real SEVERITY axis (getRatingBucket domain), worst first.
// 'other' is the not-applicable bucket (NI/NP), so it sorts last.
const SEVERITY_RANK: Record<string, number> = {
  defect: 0,
  monitor: 1,
  satisfactory: 2,
  other: 3,
};

export type SortKey = "section" | "category" | "severity";

export function sortDefects(defects: Defect[], key: SortKey): Defect[] {
  const copy = [...defects];
  if (key === "section") {
    copy.sort((a, b) => a.sectionTitle.localeCompare(b.sectionTitle));
  } else if (key === "category") {
    copy.sort((a, b) => (CATEGORY_RANK[a.category] ?? 9) - (CATEGORY_RANK[b.category] ?? 9));
  } else {
    copy.sort((a, b) => (SEVERITY_RANK[a.severityBucket] ?? 9) - (SEVERITY_RANK[b.severityBucket] ?? 9));
  }
  return copy;
}

export function toggleSelected(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

/**
 * Pure adapter: maps the loader's ok-payload into the props the builder needs.
 * Kept trivial/pure for unit testing.
 */
export function repairBuilderSectionProps(data: {
  defects: Defect[];
  mine: RepairRequest[];
}): { defects: Defect[]; mine: RepairRequest[] } {
  return { defects: data.defects, mine: data.mine };
}

// ---------------------------------------------------------------------------
// Component helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Section entry — gated states OR the builder UI
// ---------------------------------------------------------------------------

// Gated states (everything except `ok`) render the same centered mini-card,
// differing only in title + body copy. Built inside a function (not a module
// const) so the localized message thunks resolve per-request, not at import.
function gatedStates(): Record<
  Exclude<LoaderResult["kind"], "ok">,
  { title: string; message: string }
> {
  return {
    no_access: {
      title: m.portal_repair_gate_no_access_title(),
      message: m.portal_repair_gate_no_access_body(),
    },
    not_published: {
      title: m.portal_repair_gate_not_published_title(),
      message: m.portal_repair_gate_not_published_body(),
    },
    forbidden: {
      title: m.portal_repair_gate_forbidden_title(),
      message: m.portal_repair_gate_forbidden_body(),
    },
    error: {
      title: m.portal_repair_gate_error_title(),
      message: m.portal_repair_gate_error_body(),
    },
  };
}

export function RepairBuilderSection({
  result,
  actionPath,
}: {
  result: LoaderResult;
  actionPath: string;
}) {
  // Error / gated states
  if (result.kind !== "ok") {
    const { title, message } = gatedStates()[result.kind];
    return (
      <div className="max-w-xl mx-auto p-8 text-center">
        <h1 className="text-2xl font-bold text-ih-fg-1 mb-2">{title}</h1>
        <p className="text-[14px] text-ih-fg-3">{message}</p>
      </div>
    );
  }

  return (
    <RepairBuilderUI
      defects={result.defects}
      mine={result.mine}
      token={result.token}
      quickPhrases={result.quickPhrases}
      actionPath={actionPath}
    />
  );
}

// ---------------------------------------------------------------------------
// Main UI (separate component to keep hooks clean)
// ---------------------------------------------------------------------------

interface RepairBuilderUIProps {
  defects: Defect[];
  mine: RepairRequest[];
  token: string | null;
  /** Stored tenant list; null = never configured. See resolveQuickPhrases. */
  quickPhrases: string[] | null;
  actionPath: string;
}

function RepairBuilderUI({ defects, mine, token, quickPhrases, actionPath }: RepairBuilderUIProps) {
  // Derive existing list from loader data
  const existingList = mine[0] ?? null;

  // Build initial selection + drafts + item-id lookup from the existing list.
  // (item-id lookup maps findingKey → server item id, used for PATCH/DELETE.)
  const existingItems: RepairRequestItem[] = (existingList?.items as RepairRequestItem[] | undefined) ?? [];
  const initialItemIds: Record<string, string> = {};
  for (const it of existingItems) initialItemIds[it.findingKey] = it.id;

  const [sortKey, setSortKey] = useState<SortKey>("section");
  const { rrId, enqueueOp, mutationError } = useRepairOpQueue({
    initialRrId: existingList?.id ?? null,
    initialItemIds,
    token,
    actionPath,
  });
  // Draft state + the four item mutations live in a sibling hook: this file was
  // at its size cap when #275 added a fifth per-item field. The queue stays
  // here because the hook needs `enqueueOp`, and the queue needs the item-id
  // map derived above — one direction only.
  const { selected, setSelected, drafts, toggleDefect, updateCredit, updateNote, updateTag } =
    useRepairItemDrafts({ existingItems, token, enqueueOp });
  const [customIntro, setCustomIntro] = useState<string>(existingList?.customIntro ?? "");
  const [copyLabel, setCopyLabel] = useState(m.portal_repair_copy_share());
  const [emailTo, setEmailTo] = useState("");
  const [emailMsg, setEmailMsg] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  const introFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const emailFetcher = useFetcher<{ ok?: boolean; error?: string }>();

  const sorted = sortDefects(defects, sortKey);
  const phrases = resolveQuickPhrases(quickPhrases, seedQuickPhrases());

  // Track email sent
  useEffect(() => {
    if (emailFetcher.state === "idle" && emailFetcher.data?.ok) {
      setEmailSent(true);
    }
  }, [emailFetcher.state, emailFetcher.data]);

  const saveIntro = useCallback(() => {
    if (!rrId) return;
    const fd = new FormData();
    fd.append("_token", token ?? "");
    fd.append("_intent", "set-intro");
    fd.append("rrId", rrId);
    fd.append("customIntro", customIntro);
    introFetcher.submit(fd, { method: "post", action: actionPath });
  }, [rrId, token, customIntro, introFetcher, actionPath]);

  const selectedItems = sorted.filter((d) => selected.has(d.findingKey));
  const creditItems = selectedItems.map((d) => ({
    requestedCreditCents: drafts[d.findingKey]?.requestedCreditCents ?? null,
  }));
  const total = builderCreditTotal(creditItems);

  const shareToken = existingList?.shareToken ?? null;
  const shareUrl = shareToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/repair-request/${shareToken}`
    : null;

  const copyShareLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyLabel(m.portal_repair_copied());
      setTimeout(() => setCopyLabel(m.portal_repair_copy_share()), 2000);
    } catch {
      setCopyLabel(m.portal_repair_copy_failed());
    }
  };

  const sendEmail = () => {
    if (!emailTo || !shareToken) return;
    const fd = new FormData();
    fd.append("_intent", "send-email");
    fd.append("_token", token ?? "");
    fd.append("shareToken", shareToken);
    fd.append("to", emailTo);
    if (emailMsg) fd.append("message", emailMsg);
    emailFetcher.submit(fd, { method: "post", action: actionPath });
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <p className="text-[11px] font-bold tracking-widest uppercase text-ih-fg-3 mb-1">
          {m.portal_repair_eyebrow()}
        </p>
        <h1 className="text-2xl font-bold text-ih-fg-1">{m.portal_repair_heading()}</h1>
        <p className="text-[14px] text-ih-fg-3 mt-1">
          {m.portal_repair_subtitle()}
        </p>
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-bold text-ih-fg-3 uppercase tracking-widest">{m.portal_repair_sort_by()}</span>
        {(
          [
            ["section", m.portal_repair_sort_section()],
            ["category", m.portal_repair_sort_category()],
            ["severity", m.portal_repair_sort_severity()],
          ] as Array<[SortKey, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSortKey(key)}
            className={`h-7 px-3 rounded text-[12px] font-semibold transition-colors ${
              sortKey === key
                ? "bg-ih-primary text-ih-primary-fg"
                : "border border-ih-border text-ih-fg-3 hover:bg-ih-bg-muted"
            }`}
          >
            {label}
          </button>
        ))}
        {sorted.length > 0 && (
          <button
            type="button"
            className="ml-auto h-7 px-3 rounded border border-ih-border text-[12px] font-semibold text-ih-fg-3 hover:bg-ih-bg-muted transition-colors"
            onClick={() => {
              const allKeys = new Set(sorted.map((d) => d.findingKey));
              setSelected((prev) => {
                const allVisible = sorted.every((d) => prev.has(d.findingKey));
                return allVisible ? new Set() : allKeys;
              });
            }}
          >
            {sorted.every((d) => selected.has(d.findingKey)) ? m.portal_repair_deselect_all() : m.portal_repair_select_all()}
          </button>
        )}
      </div>

      {/* Defect list */}
      {defects.length === 0 ? (
        <div className="bg-ih-bg-card border border-dashed border-ih-border-strong rounded-xl p-8 text-center">
          <p className="text-[14px] text-ih-fg-3">{m.portal_repair_empty()}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((defect) => {
            const isSelected = selected.has(defect.findingKey);
            const draft = drafts[defect.findingKey];

            return (
              <RepairDefectRow
                key={defect.findingKey}
                defect={defect}
                isSelected={isSelected}
                draft={draft}
                creditCents={draft?.requestedCreditCents ?? null}
                actionTag={draft?.actionTag ?? null}
                phrases={phrases}
                onToggle={toggleDefect}
                onUpdateCredit={updateCredit}
                onUpdateNote={updateNote}
                onUpdateTag={updateTag}
              />
            );
          })}
        </div>
      )}

      {/* Custom intro */}
      {rrId && (
        <RepairIntroPanel
          customIntro={customIntro}
          saving={introFetcher.state === "submitting"}
          onChange={setCustomIntro}
          onBlur={saveIntro}
        />
      )}

      {/* Credit total */}
      {selected.size > 0 && (
        <div className="bg-ih-bg-card border border-ih-border rounded-xl px-5 py-4 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-ih-fg-3">
            {m.portal_repair_items_selected({ count: selected.size, plural: selected.size !== 1 ? "s" : "" })}
          </span>
          <span className="text-[18px] font-bold text-ih-fg-1">
            {total > 0 ? formatCents(total) : "—"} {m.portal_repair_requested()}
          </span>
        </div>
      )}

      {/* Share & actions */}
      {rrId && (
        <RepairSharePanel
          shareToken={shareToken}
          shareUrl={shareUrl}
          copyLabel={copyLabel}
          emailTo={emailTo}
          emailMsg={emailMsg}
          emailSent={emailSent}
          emailSubmitting={emailFetcher.state === "submitting"}
          emailError={emailFetcher.data?.error}
          onCopyShareLink={copyShareLink}
          onEmailToChange={setEmailTo}
          onEmailMsgChange={setEmailMsg}
          onSendEmail={sendEmail}
        />
      )}

      {/* Mutation error */}
      {mutationError && (
        <div className="bg-ih-bad-bg border border-ih-bad-fg/20 text-ih-bad-fg rounded-lg px-4 py-3 text-[13px]">
          {mutationError}
        </div>
      )}
    </div>
  );
}

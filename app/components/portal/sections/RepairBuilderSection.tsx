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
import { useState, useCallback, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { RepairDefectRow } from "./repair/RepairDefectRow";
import { RepairIntroPanel } from "./repair/RepairIntroPanel";
import { RepairSharePanel } from "./repair/RepairSharePanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Defect {
  findingKey: string;
  sectionId: string;
  sectionTitle: string;
  itemId: string;
  itemLabel: string;
  comment: string;
  category: "safety" | "recommendation" | "maintenance";
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
  | { kind: "ok"; defects: Defect[]; mine: RepairRequest[]; tenant: string; id: string; token: string | null }
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

const SEVERITY_RANK: Record<string, number> = {
  safety: 0,
  recommendation: 1,
  maintenance: 2,
};

export function sortDefects(
  defects: Defect[],
  key: "section" | "severity",
): Defect[] {
  const copy = [...defects];
  if (key === "section") {
    copy.sort((a, b) => a.sectionTitle.localeCompare(b.sectionTitle));
  } else {
    copy.sort(
      (a, b) =>
        (SEVERITY_RANK[a.category] ?? 9) - (SEVERITY_RANK[b.category] ?? 9),
    );
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

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

interface ItemDraft {
  requestedCreditCents: number | null;
  note: string;
}

// ---------------------------------------------------------------------------
// Section entry — gated states OR the builder UI
// ---------------------------------------------------------------------------

export function RepairBuilderSection({
  result,
  actionPath,
}: {
  result: LoaderResult;
  actionPath: string;
}) {
  // Error / gated states
  if (result.kind === "no_access") {
    return (
      <div className="max-w-xl mx-auto p-8 text-center">
        <h1 className="text-2xl font-bold text-ih-fg-1 mb-2">Access Required</h1>
        <p className="text-[14px] text-ih-fg-3">
          You need a valid token or login to view this page.
        </p>
      </div>
    );
  }

  if (result.kind === "not_published") {
    return (
      <div className="max-w-xl mx-auto p-8 text-center">
        <h1 className="text-2xl font-bold text-ih-fg-1 mb-2">Report Not Published</h1>
        <p className="text-[14px] text-ih-fg-3">
          The report must be published before you can build a repair request.
        </p>
      </div>
    );
  }

  if (result.kind === "forbidden") {
    return (
      <div className="max-w-xl mx-auto p-8 text-center">
        <h1 className="text-2xl font-bold text-ih-fg-1 mb-2">Feature Not Available</h1>
        <p className="text-[14px] text-ih-fg-3">
          The repair request builder is not enabled for this inspection company.
        </p>
      </div>
    );
  }

  if (result.kind === "error") {
    return (
      <div className="max-w-xl mx-auto p-8 text-center">
        <h1 className="text-2xl font-bold text-ih-fg-1 mb-2">Something went wrong</h1>
        <p className="text-[14px] text-ih-fg-3">
          Unable to load the repair builder. Please try again.
        </p>
      </div>
    );
  }

  return (
    <RepairBuilderUI
      defects={result.defects}
      mine={result.mine}
      token={result.token}
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
  actionPath: string;
}

function RepairBuilderUI({ defects, mine, token, actionPath }: RepairBuilderUIProps) {
  // Derive existing list from loader data
  const existingList = mine[0] ?? null;
  const [rrId, setRrId] = useState<string | null>(existingList?.id ?? null);

  // Build initial selection + drafts from existing list
  const existingItems: RepairRequestItem[] = (existingList?.items as RepairRequestItem[] | undefined) ?? [];
  const initialSelected = new Set(existingItems.map((it) => it.findingKey));
  const initialDrafts: Record<string, ItemDraft> = {};
  for (const it of existingItems) {
    initialDrafts[it.findingKey] = {
      requestedCreditCents: it.requestedCreditCents,
      note: it.note ?? "",
    };
  }

  // Item id lookup (findingKey → server item id, for PATCH/DELETE)
  const initialItemIds: Record<string, string> = {};
  for (const it of existingItems) {
    initialItemIds[it.findingKey] = it.id;
  }

  const [sortKey, setSortKey] = useState<"section" | "severity">("section");
  const [selected, setSelected] = useState<Set<string>>(initialSelected);
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>(initialDrafts);
  // findingKey → server item id. Kept in a ref (not state) because reads must see
  // the freshest map synchronously inside queued ops, and updates from add-item
  // responses must not depend on a stale render closure.
  const itemIdsRef = useRef<Record<string, string>>(initialItemIds);
  const [customIntro, setCustomIntro] = useState<string>(existingList?.customIntro ?? "");
  const [copyLabel, setCopyLabel] = useState("Copy share link");
  const [emailTo, setEmailTo] = useState("");
  const [emailMsg, setEmailMsg] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  const createFetcher = useFetcher<{ ok?: boolean; error?: string; data?: unknown }>();
  const mutationFetcher = useFetcher<{ ok?: boolean; error?: string; data?: unknown }>();
  const introFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const emailFetcher = useFetcher<{ ok?: boolean; error?: string }>();

  const sorted = sortDefects(defects, sortKey);

  // -----------------------------------------------------------------------
  // Persistence queue
  //
  // Item operations (add / remove / update) are serialized through ONE
  // mutationFetcher so concurrent rapid clicks don't clobber each other's
  // in-flight submission (useFetcher is single-flight). Each queued op is a
  // plain FormData; we drain the queue head whenever the fetcher is idle AND a
  // list id exists. List creation is lazy but GUARDED so rapid toggles before
  // the round-trip returns create exactly one list (no double-create race).
  // -----------------------------------------------------------------------
  const rrIdRef = useRef<string | null>(existingList?.id ?? null);
  rrIdRef.current = rrId;
  const opQueueRef = useRef<FormData[]>([]);
  const creatingRef = useRef(false);
  // Tracks the findingKey of an in-flight add-item so we can record its server
  // id from the response (the response also echoes findingKey, used as backup).
  const inFlightAddKeyRef = useRef<string | null>(null);

  const drainQueue = useCallback(() => {
    if (mutationFetcher.state !== "idle") return;
    if (!rrIdRef.current) return;
    let next = opQueueRef.current.shift();
    while (next) {
      const intent = next.get("_intent");
      // For ops keyed by findingKey (remove / update), resolve the server item id
      // at DRAIN time so an add that completed earlier in the queue is visible.
      if (intent === "remove-item" || intent === "update-item") {
        const fk = String(next.get("_findingKey") ?? "");
        const itemId = fk ? itemIdsRef.current[fk] : (next.get("itemId") as string | null);
        if (!itemId) {
          // Item not on the server (e.g. added+removed before its add resolved,
          // or never persisted) — nothing to do; skip and continue draining.
          next = opQueueRef.current.shift();
          continue;
        }
        next.set("itemId", itemId);
      }
      // Stamp the resolved rrId at submit time (it may not have existed when the
      // op was enqueued).
      next.set("rrId", rrIdRef.current);
      inFlightAddKeyRef.current =
        intent === "add-item" ? String(next.get("findingKey") ?? "") : null;
      mutationFetcher.submit(next, { method: "post", action: actionPath });
      return;
    }
  }, [mutationFetcher, actionPath]);

  const enqueueOp = useCallback(
    (fd: FormData) => {
      opQueueRef.current.push(fd);
      // Lazily create the list once if it doesn't exist yet. Guarded so a burst
      // of selections fires a single create-list, not one per click.
      if (!rrIdRef.current && !creatingRef.current) {
        creatingRef.current = true;
        const createFd = new FormData();
        createFd.append("_token", token ?? "");
        createFd.append("_intent", "create-list");
        createFetcher.submit(createFd, { method: "post", action: actionPath });
      }
      drainQueue();
    },
    [token, createFetcher, drainQueue, actionPath],
  );

  // Capture the new rrId from create-list, then drain any queued ops.
  useEffect(() => {
    if (
      createFetcher.state === "idle" &&
      createFetcher.data?.ok &&
      createFetcher.data?.data
    ) {
      const newRr = createFetcher.data.data as { id?: string };
      creatingRef.current = false;
      if (newRr?.id && !rrIdRef.current) {
        rrIdRef.current = newRr.id;
        setRrId(newRr.id);
      }
      drainQueue();
    } else if (createFetcher.state === "idle" && createFetcher.data && !createFetcher.data.ok) {
      // Create failed — release the guard so a later toggle can retry.
      creatingRef.current = false;
    }
  }, [createFetcher.state, createFetcher.data, drainQueue]);

  // After each item op settles: record add-item ids, then drain the next op.
  useEffect(() => {
    if (mutationFetcher.state !== "idle") return;
    const data = mutationFetcher.data;
    if (data?.ok && inFlightAddKeyRef.current && data.data) {
      const item = data.data as { id?: string; findingKey?: string };
      const key = item.findingKey ?? inFlightAddKeyRef.current;
      if (item.id && key) {
        itemIdsRef.current = { ...itemIdsRef.current, [key]: item.id };
      }
    }
    inFlightAddKeyRef.current = null;
    drainQueue();
  }, [mutationFetcher.state, mutationFetcher.data, drainQueue]);

  // Track email sent
  useEffect(() => {
    if (emailFetcher.state === "idle" && emailFetcher.data?.ok) {
      setEmailSent(true);
    }
  }, [emailFetcher.state, emailFetcher.data]);

  const toggleDefect = useCallback(
    (defect: Defect) => {
      const key = defect.findingKey;
      const nowSelected = !selected.has(key);

      setSelected((prev) => toggleSelected(prev, key));

      if (nowSelected) {
        // Selecting: enqueue an add-item. rrId is stamped at drain time, so this
        // works even before the list has been created.
        const fd = new FormData();
        fd.append("_token", token ?? "");
        fd.append("_intent", "add-item");
        fd.append("findingKey", key);
        fd.append("sectionTitle", defect.sectionTitle);
        fd.append("itemLabel", defect.itemLabel);
        fd.append("commentSnapshot", defect.comment);
        const draft = drafts[key];
        if (draft?.requestedCreditCents != null) {
          fd.append("requestedCreditCents", String(draft.requestedCreditCents));
        }
        if (draft?.note) fd.append("note", draft.note);
        enqueueOp(fd);
      } else {
        // Deselecting: enqueue a remove-item. The server item id is resolved at
        // drain time via _findingKey so an add still in flight is handled.
        const fd = new FormData();
        fd.append("_token", token ?? "");
        fd.append("_intent", "remove-item");
        fd.append("_findingKey", key);
        enqueueOp(fd);
      }
    },
    [selected, token, drafts, enqueueOp],
  );

  const updateCredit = useCallback(
    (defect: Defect, dollars: string) => {
      const cents = dollars === "" ? null : Math.round(parseFloat(dollars) * 100);
      setDrafts((prev) => ({
        ...prev,
        [defect.findingKey]: { ...(prev[defect.findingKey] ?? { note: "" }), requestedCreditCents: cents },
      }));
      if (cents !== null) {
        const fd = new FormData();
        fd.append("_token", token ?? "");
        fd.append("_intent", "update-item");
        fd.append("_findingKey", defect.findingKey);
        fd.append("requestedCreditCents", String(cents));
        enqueueOp(fd);
      }
    },
    [token, enqueueOp],
  );

  const updateNote = useCallback(
    (defect: Defect, note: string) => {
      setDrafts((prev) => ({
        ...prev,
        [defect.findingKey]: { ...(prev[defect.findingKey] ?? { requestedCreditCents: null }), note },
      }));
      const fd = new FormData();
      fd.append("_token", token ?? "");
      fd.append("_intent", "update-item");
      fd.append("_findingKey", defect.findingKey);
      fd.append("note", note);
      enqueueOp(fd);
    },
    [token, enqueueOp],
  );

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
      setCopyLabel("Copied!");
      setTimeout(() => setCopyLabel("Copy share link"), 2000);
    } catch {
      setCopyLabel("Copy failed");
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
        <p className="text-[11px] font-bold tracking-widest uppercase text-ih-fg-4 mb-1">
          Repair Request Builder
        </p>
        <h1 className="text-2xl font-bold text-ih-fg-1">Select items to include</h1>
        <p className="text-[14px] text-ih-fg-3 mt-1">
          Check the defects you want to request repair or credit for. Add amounts and notes for each.
        </p>
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-bold text-ih-fg-4 uppercase tracking-widest">Sort by:</span>
        <button
          type="button"
          onClick={() => setSortKey("section")}
          className={`h-7 px-3 rounded text-[12px] font-semibold transition-colors ${
            sortKey === "section"
              ? "bg-ih-primary text-ih-primary-fg"
              : "border border-ih-border text-ih-fg-3 hover:bg-ih-bg-muted"
          }`}
        >
          Section
        </button>
        <button
          type="button"
          onClick={() => setSortKey("severity")}
          className={`h-7 px-3 rounded text-[12px] font-semibold transition-colors ${
            sortKey === "severity"
              ? "bg-ih-primary text-ih-primary-fg"
              : "border border-ih-border text-ih-fg-3 hover:bg-ih-bg-muted"
          }`}
        >
          Severity
        </button>
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
            {sorted.every((d) => selected.has(d.findingKey)) ? "Deselect all" : "Select all"}
          </button>
        )}
      </div>

      {/* Defect list */}
      {defects.length === 0 ? (
        <div className="bg-ih-bg-card border border-dashed border-ih-border-strong rounded-xl p-8 text-center">
          <p className="text-[14px] text-ih-fg-3">No repair-rated defects found in this report.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((defect) => {
            const isSelected = selected.has(defect.findingKey);
            const draft = drafts[defect.findingKey];
            const creditDollars =
              draft?.requestedCreditCents != null
                ? String(draft.requestedCreditCents / 100)
                : "";

            return (
              <RepairDefectRow
                key={defect.findingKey}
                defect={defect}
                isSelected={isSelected}
                draft={draft}
                creditDollars={creditDollars}
                onToggle={toggleDefect}
                onUpdateCredit={updateCredit}
                onUpdateNote={updateNote}
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
            {selected.size} item{selected.size !== 1 ? "s" : ""} selected
          </span>
          <span className="text-[18px] font-bold text-ih-fg-1">
            {total > 0 ? formatCents(total) : "—"} requested
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
      {mutationFetcher.data?.error && (
        <div className="bg-ih-bad-bg border border-ih-bad-fg/20 text-ih-bad-fg rounded-lg px-4 py-3 text-[13px]">
          {mutationFetcher.data.error}
        </div>
      )}
    </div>
  );
}

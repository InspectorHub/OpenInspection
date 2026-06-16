/**
 * Interactive Repair Request Builder — full-page UI.
 *
 * Route: /repair-builder/:tenant/:id
 * Loader: resolves defects + existing repair requests via BFF.
 * Action: all mutations via BFF (no client fetch).
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/repair-builder.$tenant.$id";
import { createApi } from "~/lib/api-client.server";
import { getToken } from "~/lib/session.server";

export function meta() {
  return [{ title: "Build Repair Request - OpenInspection" }];
}

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

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

type LoaderResult =
  | { kind: "ok"; defects: Defect[]; mine: RepairRequest[]; tenant: string; id: string; token: string | null }
  | { kind: "no_access" }
  | { kind: "not_published" }
  | { kind: "forbidden" }
  | { kind: "error" };

interface RepairRequestItem {
  id: string;
  findingKey: string;
  sectionTitle: string;
  itemLabel: string;
  commentSnapshot: string | null;
  requestedCreditCents: number | null;
  note: string | null;
  sortOrder: number | null;
}

interface RepairRequest {
  id: string;
  inspectionId: string;
  tenantId: string;
  customIntro: string | null;
  shareToken: string | null;
  items?: RepairRequestItem[];
}

export async function loader({
  params,
  request,
  context,
}: Route.LoaderArgs): Promise<LoaderResult> {
  const tenant = params.tenant ?? "";
  const id = params.id ?? "";
  const sessionToken = (await getToken(context, request)) ?? undefined;
  const api = createApi(context, { token: sessionToken });
  const parsedUrl = new URL(request.url);
  const token = parsedUrl.searchParams.get("token") ?? undefined;

  try {
    const res = await api.repairBuilder["repair-builder"][":tenant"][":id"].source.$get({
      param: { tenant, id },
      query: { token },
    });

    if (res.status === 401) {
      return { kind: "no_access" };
    }

    if (res.status === 403) {
      const body = (await res.json()) as { error?: { code?: string } };
      const code = body?.error?.code;
      if (code === "NOT_PUBLISHED") return { kind: "not_published" };
      return { kind: "forbidden" };
    }

    if (!res.ok) {
      return { kind: "error" };
    }

    const body = (await res.json()) as { data?: { defects: Defect[]; mine: RepairRequest[] } };
    const data = body.data;
    if (!data) return { kind: "error" };

    return {
      kind: "ok",
      defects: data.defects,
      mine: data.mine,
      tenant,
      id,
      token: parsedUrl.searchParams.get("token"),
    };
  } catch {
    return { kind: "error" };
  }
}

// ---------------------------------------------------------------------------
// Action (BFF only)
// ---------------------------------------------------------------------------

export async function action({
  params,
  request,
  context,
}: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("_intent") ?? "");
  const tenant = params.tenant ?? "";
  const id = params.id ?? "";
  const token = (form.get("_token") as string | null) ?? undefined;

  const sessionToken = (await getToken(context, request)) ?? undefined;
  const api = createApi(context, { token: sessionToken });

  try {
    if (intent === "create-list") {
      const res = await api.repairBuilder["repair-builder"][":tenant"][":id"].$post({
        param: { tenant, id },
        query: { token },
      });
      if (!res.ok) return { ok: false as const, error: "Failed to create list." };
      const body = (await res.json()) as { data?: RepairRequest };
      return { ok: true as const, data: body.data };
    }

    const rrId = String(form.get("rrId") ?? "");

    if (intent === "add-item") {
      const findingKey = String(form.get("findingKey") ?? "");
      const sectionTitle = String(form.get("sectionTitle") ?? "");
      const itemLabel = String(form.get("itemLabel") ?? "");
      const commentSnapshot = (form.get("commentSnapshot") as string | null) ?? null;
      const creditRaw = form.get("requestedCreditCents");
      const requestedCreditCents = creditRaw !== null && creditRaw !== "" ? Number(creditRaw) : null;
      const note = (form.get("note") as string | null) ?? null;

      const res = await api.repairBuilder["repair-builder"][":tenant"][":id"].lists[":rrId"].items.$post({
        param: { tenant, id, rrId },
        query: { token },
        json: {
          findingKey,
          sectionTitle,
          itemLabel,
          commentSnapshot,
          requestedCreditCents,
          note,
        },
      });
      if (!res.ok) return { ok: false as const, error: "Failed to add item." };
      const body = (await res.json()) as { data?: RepairRequestItem };
      return { ok: true as const, data: body.data };
    }

    if (intent === "update-item") {
      const itemId = String(form.get("itemId") ?? "");
      const creditRaw = form.get("requestedCreditCents");
      const noteRaw = form.get("note");
      const patch: { requestedCreditCents?: number; note?: string } = {};
      if (creditRaw !== null && creditRaw !== "") patch.requestedCreditCents = Number(creditRaw);
      if (noteRaw !== null) patch.note = String(noteRaw);

      const res = await api.repairBuilder["repair-builder"][":tenant"][":id"].lists[":rrId"].items[":itemId"].$patch({
        param: { tenant, id, rrId, itemId },
        query: { token },
        json: patch,
      });
      if (!res.ok) return { ok: false as const, error: "Failed to update item." };
      return { ok: true as const };
    }

    if (intent === "remove-item") {
      const itemId = String(form.get("itemId") ?? "");
      const res = await api.repairBuilder["repair-builder"][":tenant"][":id"].lists[":rrId"].items[":itemId"].$delete({
        param: { tenant, id, rrId, itemId },
        query: { token },
      });
      if (!res.ok) return { ok: false as const, error: "Failed to remove item." };
      return { ok: true as const };
    }

    if (intent === "set-intro") {
      const customIntro = (form.get("customIntro") as string | null) ?? null;
      const res = await api.repairBuilder["repair-builder"][":tenant"][":id"].lists[":rrId"].$patch({
        param: { tenant, id, rrId },
        query: { token },
        json: { customIntro },
      });
      if (!res.ok) return { ok: false as const, error: "Failed to save intro." };
      return { ok: true as const };
    }

    if (intent === "send-email") {
      const shareToken = String(form.get("shareToken") ?? "");
      const to = String(form.get("to") ?? "");
      const message = (form.get("message") as string | null) ?? undefined;
      if (!shareToken || !to) return { ok: false as const, error: "Missing shareToken or to." };
      const res = await api.repairBuilder["repair-request"].share[":shareToken"].email.$post({
        param: { shareToken },
        json: { to, message },
      });
      if (!res.ok) return { ok: false as const, error: "Failed to send email." };
      return { ok: true as const };
    }

    return { ok: false as const, error: `Unknown intent: ${intent}` };
  } catch {
    return { ok: false as const, error: "Server error." };
  }
}

// ---------------------------------------------------------------------------
// Component helpers
// ---------------------------------------------------------------------------

function categoryLabel(cat: Defect["category"]): string {
  return cat === "safety" ? "Safety" : cat === "recommendation" ? "Recommendation" : "Maintenance";
}

function categoryClass(cat: Defect["category"]): string {
  if (cat === "safety") return "bg-ih-bad-bg text-ih-bad-fg";
  if (cat === "recommendation") return "bg-ih-info-bg text-ih-info-fg";
  return "bg-ih-bg-muted text-ih-fg-3";
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ItemDraft {
  requestedCreditCents: number | null;
  note: string;
}

export default function RepairBuilderPage() {
  const result = useLoaderData<typeof loader>() as LoaderResult;

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
      tenant={result.tenant}
      id={result.id}
      token={result.token}
    />
  );
}

// ---------------------------------------------------------------------------
// Main UI (separate component to keep hooks clean)
// ---------------------------------------------------------------------------

interface RepairBuilderUIProps {
  defects: Defect[];
  mine: RepairRequest[];
  tenant: string;
  id: string;
  token: string | null;
}

function RepairBuilderUI({ defects, mine, token }: RepairBuilderUIProps) {
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
      mutationFetcher.submit(next, { method: "post" });
      return;
    }
  }, [mutationFetcher]);

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
        createFetcher.submit(createFd, { method: "post" });
      }
      drainQueue();
    },
    [token, createFetcher, drainQueue],
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
    introFetcher.submit(fd, { method: "post" });
  }, [rrId, token, customIntro, introFetcher]);

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
    emailFetcher.submit(fd, { method: "post" });
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
              ? "bg-ih-primary text-white"
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
              ? "bg-ih-primary text-white"
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
              <div
                key={defect.findingKey}
                className={`bg-ih-bg-card border rounded-xl transition-colors ${
                  isSelected ? "border-ih-primary/60" : "border-ih-border"
                }`}
              >
                {/* Row header */}
                <button
                  type="button"
                  className="w-full flex items-start gap-3 px-4 py-3 text-left"
                  onClick={() => toggleDefect(defect)}
                >
                  <span
                    className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                      isSelected
                        ? "bg-ih-primary border-ih-primary"
                        : "border-ih-border-strong bg-ih-bg-app"
                    }`}
                  >
                    {isSelected && (
                      <svg viewBox="0 0 12 10" className="w-3 h-2 fill-white">
                        <path d="M1 5l3.5 3.5L11 1" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold text-ih-fg-1">
                      {defect.itemLabel}
                    </span>
                    <span className="block text-[12px] text-ih-fg-3 mt-0.5">
                      {defect.sectionTitle}
                    </span>
                    {defect.comment && (
                      <span className="block text-[12px] text-ih-fg-4 mt-0.5 line-clamp-2">
                        {defect.comment}
                      </span>
                    )}
                  </span>
                  <span
                    className={`inline-flex items-center h-5 px-2 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 ml-2 ${categoryClass(defect.category)}`}
                  >
                    {categoryLabel(defect.category)}
                  </span>
                </button>

                {/* Expanded credit + note */}
                {isSelected && (
                  <div className="px-4 pb-4 pt-1 border-t border-ih-border space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1">
                          Credit Request ($)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={creditDollars}
                          onChange={(e) => updateCredit(defect, e.target.value)}
                          className="w-full h-8 px-3 rounded-md border border-ih-border bg-ih-bg-app text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4 focus:outline-none focus:border-ih-primary"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1">
                        Note
                      </label>
                      <textarea
                        placeholder="Optional — describe the repair or credit rationale"
                        rows={2}
                        value={draft?.note ?? ""}
                        onChange={(e) => updateNote(defect, e.target.value)}
                        className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-app text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4 resize-none focus:outline-none focus:border-ih-primary"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Custom intro */}
      {rrId && (
        <div className="bg-ih-bg-card border border-ih-border rounded-xl p-5 space-y-3">
          <p className="text-[12px] font-bold text-ih-fg-4 uppercase tracking-widest">
            Custom Introduction
          </p>
          <textarea
            placeholder="Add a personal message to appear at the top of the shared repair request…"
            rows={4}
            value={customIntro}
            onChange={(e) => setCustomIntro(e.target.value)}
            onBlur={saveIntro}
            className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-app text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4 resize-none focus:outline-none focus:border-ih-primary"
          />
          {introFetcher.state === "submitting" && (
            <p className="text-[11px] text-ih-fg-4">Saving…</p>
          )}
        </div>
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
        <div className="bg-ih-bg-card border border-ih-border rounded-xl p-5 space-y-4">
          <p className="text-[12px] font-bold text-ih-fg-4 uppercase tracking-widest">Share</p>
          <div className="flex flex-wrap gap-3">
            {shareUrl && (
              <>
                <button
                  type="button"
                  onClick={copyShareLink}
                  className="h-9 px-4 rounded-lg border border-ih-border text-[13px] font-semibold text-ih-fg-3 hover:bg-ih-bg-muted transition-colors"
                >
                  {copyLabel}
                </button>
                <a
                  href={`/api/public/repair-request/share/${shareToken}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center h-9 px-4 rounded-lg border border-ih-border text-[13px] font-semibold text-ih-fg-3 hover:bg-ih-bg-muted transition-colors"
                >
                  View as PDF
                </a>
              </>
            )}
          </div>

          {/* Email form */}
          {shareToken && !emailSent && (
            <div className="space-y-2 pt-2 border-t border-ih-border">
              <p className="text-[12px] font-bold text-ih-fg-4 uppercase tracking-widest">
                Email to contractor
              </p>
              <input
                type="email"
                placeholder="contractor@example.com"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                className="w-full h-8 px-3 rounded-md border border-ih-border bg-ih-bg-app text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4 focus:outline-none focus:border-ih-primary"
              />
              <textarea
                placeholder="Optional message…"
                rows={2}
                value={emailMsg}
                onChange={(e) => setEmailMsg(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-app text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4 resize-none focus:outline-none focus:border-ih-primary"
              />
              <button
                type="button"
                disabled={!emailTo || emailFetcher.state === "submitting"}
                onClick={sendEmail}
                className="h-9 px-4 rounded-lg bg-ih-primary text-white text-[13px] font-bold hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
              >
                {emailFetcher.state === "submitting" ? "Sending…" : "Send email"}
              </button>
              {emailFetcher.data?.error && (
                <p className="text-[12px] text-ih-bad-fg">{emailFetcher.data.error}</p>
              )}
            </div>
          )}

          {emailSent && (
            <p className="text-[13px] text-ih-ok-fg font-semibold">Email sent.</p>
          )}
        </div>
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

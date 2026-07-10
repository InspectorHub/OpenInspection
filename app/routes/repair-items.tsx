import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/repair-items";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader, Card, Pill, Button, EmptyState } from "@core/shared-ui";
import { Breadcrumb } from "~/components/Breadcrumb";
import { ConfirmDialog } from "~/components/ConfirmDialog";

export function meta() {
  return [{ title: "Repair Items - OpenInspection" }];
}

interface RepairItem {
  id: string;
  name: string;
  category: string | null;
  severity: "good" | "marginal" | "significant" | "minor";
  defaultEstimateMin: number | null;
  defaultEstimateMax: number | null;
  defaultRepairSummary: string;
  recommendedContractorTypeId: string | null;
}
interface ContractorType { id: string; name: string }

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  try {
    const [recRes, ctRes] = await Promise.all([
      api.recommendations.index.$get({ query: {} }),
      api.contractorTypes.index.$get(),
    ]);
    const recBody = recRes.ok ? ((await recRes.json()) as { data?: RepairItem[] }) : { data: [] };
    const ctBody = ctRes.ok ? ((await ctRes.json()) as { data?: ContractorType[] }) : { data: [] };
    return { items: recBody.data ?? [], contractorTypes: ctBody.data ?? [] };
  } catch {
    return { items: [] as RepairItem[], contractorTypes: [] as ContractorType[] };
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const form = await request.formData();
  const intent = String(form.get("intent"));

  const num = (k: string) => {
    const v = String(form.get(k) ?? "").trim();
    return v === "" ? null : Math.round(Number(v) * 100);
  };
  const buildJson = () => ({
    name: String(form.get("name") ?? ""),
    category: (String(form.get("category") ?? "").trim() || null),
    severity: (String(form.get("severity") ?? "significant")) as RepairItem["severity"],
    defaultRepairSummary: String(form.get("defaultRepairSummary") ?? ""),
    defaultEstimateMin: num("estimateMinDollars"),
    defaultEstimateMax: num("estimateMaxDollars"),
    recommendedContractorTypeId: (String(form.get("recommendedContractorTypeId") ?? "").trim() || null),
  });

  try {
    if (intent === "create") {
      const res = await api.recommendations.index.$post({ json: buildJson() });
      return { ok: res.ok, intent };
    }
    if (intent === "update") {
      const id = String(form.get("id"));
      const res = await api.recommendations[":id"].$put({ param: { id }, json: buildJson() });
      return { ok: res.ok, intent };
    }
    if (intent === "delete") {
      const id = String(form.get("id"));
      const res = await api.recommendations[":id"].$delete({ param: { id } });
      return { ok: res.ok, intent };
    }
  } catch {
    return { ok: false, intent };
  }
  return { ok: false, intent };
}

const SEVERITY_TONE: Record<string, "sat" | "monitor" | "defect"> = {
  good: "sat", marginal: "monitor", significant: "defect",
};

const EMPTY = {
  id: "", name: "", category: "", severity: "significant" as RepairItem["severity"],
  estimateMinDollars: "", estimateMaxDollars: "", defaultRepairSummary: "", recommendedContractorTypeId: "",
};

export default function RepairItemsPage() {
  const { items, contractorTypes } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();
  const [pendingDelete, setPendingDelete] = useState<RepairItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const ctName = (id: string | null) => contractorTypes.find((c) => c.id === id)?.name ?? null;

  function openCreate() { setForm(EMPTY); setModalOpen(true); }
  function openEdit(it: RepairItem) {
    setForm({
      id: it.id, name: it.name, category: it.category ?? "", severity: it.severity,
      estimateMinDollars: it.defaultEstimateMin != null ? String(it.defaultEstimateMin / 100) : "",
      estimateMaxDollars: it.defaultEstimateMax != null ? String(it.defaultEstimateMax / 100) : "",
      defaultRepairSummary: it.defaultRepairSummary, recommendedContractorTypeId: it.recommendedContractorTypeId ?? "",
    });
    setModalOpen(true);
  }
  function submit(intent: string) {
    fetcher.submit({ ...form, intent }, { method: "POST" });
    setModalOpen(false);
  }

  return (
    <div className="space-y-ih-list">
      <Breadcrumb items={[{ label: "Library", href: "/library" }, { label: "Repair Items" }]} />
      <PageHeader
        title="Repair Items"
        meta={`${items.length} in library`}
        actions={<Button variant="primary" onClick={openCreate}>+ Add item</Button>}
      />

      {items.length === 0 ? (
        <Card>
          <EmptyState title="No repair items yet" description='Click "+ Add item" above to create your first repair recommendation.' />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((it) => (
            <Card key={it.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-semibold text-ih-fg-1">{it.name}</p>
                <Pill tone={SEVERITY_TONE[it.severity] || "gen"}>{it.severity}</Pill>
              </div>
              {it.defaultRepairSummary && (
                <p className="text-[13px] text-ih-fg-3 mt-1 line-clamp-2">{it.defaultRepairSummary}</p>
              )}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {it.category && <Pill tone="gen">{it.category}</Pill>}
                {(it.defaultEstimateMin != null || it.defaultEstimateMax != null) && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-ih-ok-bg text-ih-ok-fg tabular-nums">
                    {[
                      it.defaultEstimateMin != null ? `$${(it.defaultEstimateMin / 100).toLocaleString()}` : null,
                      it.defaultEstimateMax != null ? `$${(it.defaultEstimateMax / 100).toLocaleString()}` : null,
                    ].filter(Boolean).join(" – ")}
                  </span>
                )}
                {ctName(it.recommendedContractorTypeId) && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-ih-info-bg text-ih-info-fg">{ctName(it.recommendedContractorTypeId)}</span>
                )}
              </div>
              <div className="mt-3 flex gap-3">
                <button onClick={() => openEdit(it)} className="text-[12px] text-ih-primary hover:underline font-bold">Edit</button>
                <button onClick={() => setPendingDelete(it)} className="text-[12px] text-ih-bad-fg hover:underline font-bold">Delete</button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-ih-backdrop" onClick={() => setModalOpen(false)} />
          <div className="relative bg-ih-bg-card border border-ih-border rounded-lg shadow-ih-popover w-full max-w-md mx-4 p-6 space-y-4">
            <h3 className="text-[16px] font-bold text-ih-fg-1">{form.id ? "Edit repair item" : "New repair item"}</h3>
            <div className="space-y-3">
              <Field label="Name"><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g., Replace double-tapped breaker" className={INPUT} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category"><input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="Electrical" className={INPUT} /></Field>
                <Field label="Severity">
                  <select value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as RepairItem["severity"] }))} className={INPUT}>
                    <option value="good">Satisfactory</option>
                    <option value="marginal">Monitor</option>
                    <option value="significant">Defect</option>
                  </select>
                </Field>
              </div>
              <Field label="Repair summary"><textarea value={form.defaultRepairSummary} onChange={(e) => setForm((f) => ({ ...f, defaultRepairSummary: e.target.value }))} rows={3} className={INPUT} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Est. min ($)"><input type="number" min={0} step="any" value={form.estimateMinDollars} onChange={(e) => setForm((f) => ({ ...f, estimateMinDollars: e.target.value }))} className={INPUT} /></Field>
                <Field label="Est. max ($)"><input type="number" min={0} step="any" value={form.estimateMaxDollars} onChange={(e) => setForm((f) => ({ ...f, estimateMaxDollars: e.target.value }))} className={INPUT} /></Field>
              </div>
              <Field label="Recommended contractor">
                <select value={form.recommendedContractorTypeId} onChange={(e) => setForm((f) => ({ ...f, recommendedContractorTypeId: e.target.value }))} className={INPUT}>
                  <option value="">— none —</option>
                  {contractorTypes.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 rounded-md border border-ih-border text-[13px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors">Cancel</button>
              <button onClick={() => submit(form.id ? "update" : "create")} disabled={!form.name.trim() || !form.defaultRepairSummary.trim()} className="px-4 py-2 rounded-md bg-ih-primary text-white text-[13px] font-bold hover:bg-ih-primary-600 transition-colors disabled:opacity-50">Save</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete repair item"
        message={pendingDelete ? `Delete "${pendingDelete.name}"? This can't be undone.` : ""}
        busy={deleteFetcher.state !== "idle"}
        onConfirm={() => {
          if (pendingDelete) deleteFetcher.submit({ intent: "delete", id: pendingDelete.id }, { method: "POST" });
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

const INPUT ="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">{label}</span>
      {children}
    </label>
  );
}

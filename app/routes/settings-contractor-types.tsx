import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { Icon } from "@core/shared-ui";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-contractor-types";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";

interface ContractorType { id: string; name: string; sortOrder: number }

export function meta() { return [{ title: "Contractor Types - OpenInspection" }]; }

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) return { forbidden: true as const };
  try {
    const api = createApi(context, { token });
    const res = await api.contractorTypes.index.$get();
    if (!res.ok) return { types: [] as ContractorType[] };
    const body = (await res.json()) as { data?: ContractorType[] };
    return { types: body.data ?? [] };
  } catch {
    return { types: [] as ContractorType[] };
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const form = await request.formData();
  const intent = String(form.get("intent"));
  try {
    if (intent === "create") {
      const res = await api.contractorTypes.index.$post({ json: { name: String(form.get("name") ?? "") } });
      return { ok: res.ok, intent };
    }
    if (intent === "rename") {
      const res = await api.contractorTypes[":id"].$patch({ param: { id: String(form.get("id")) }, json: { name: String(form.get("name") ?? "") } });
      return { ok: res.ok, intent };
    }
    if (intent === "delete") {
      const res = await api.contractorTypes[":id"].$delete({ param: { id: String(form.get("id")) } });
      return { ok: res.ok, intent };
    }
    if (intent === "reorder") {
      const ids = JSON.parse(String(form.get("ids") ?? "[]")) as string[];
      const res = await api.contractorTypes.reorder.$post({ json: { ids } });
      return { ok: res.ok, intent };
    }
  } catch {
    return { ok: false, intent };
  }
  return { ok: false, intent };
}

const INPUT = "px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none";

function ContractorTypeRow({ t, idx, count, onMove, onRequestDelete }: { t: ContractorType; idx: number; count: number; onMove: (idx: number, dir: -1 | 1) => void; onRequestDelete: () => void }) {
  const fetcher = useFetcher<typeof action>();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(t.name);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex flex-col">
        <button onClick={() => onMove(idx, -1)} disabled={idx === 0} className="text-ih-fg-4 hover:text-ih-fg-1 disabled:opacity-30 leading-none" aria-label={`Move ${t.name} up`}><Icon name="chevU" size={14} /></button>
        <button onClick={() => onMove(idx, 1)} disabled={idx === count - 1} className="text-ih-fg-4 hover:text-ih-fg-1 disabled:opacity-30 leading-none" aria-label={`Move ${t.name} down`}><Icon name="chevD" size={14} /></button>
      </div>
      {editing ? (
        <fetcher.Form method="POST" className="flex-1 flex gap-2" onSubmit={() => setEditing(false)}>
          <input type="hidden" name="intent" value="rename" />
          <input type="hidden" name="id" value={t.id} />
          <input name="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus className={`flex-1 ${INPUT} py-1.5`} />
          <button type="submit" disabled={!name.trim()} className="text-[12px] text-ih-primary font-bold disabled:opacity-50">Save</button>
          <button type="button" onClick={() => { setEditing(false); setName(t.name); }} className="text-[12px] text-ih-fg-3">Cancel</button>
        </fetcher.Form>
      ) : (
        <>
          <span className="flex-1 font-bold text-[13px] text-ih-fg-1">{t.name}</span>
          <button onClick={() => { setEditing(true); setName(t.name); }} className="text-[12px] text-ih-primary hover:underline font-bold">Rename</button>
          <button onClick={onRequestDelete} aria-label={`Delete ${t.name}`} className="text-[12px] text-ih-bad-fg hover:underline font-bold">Delete</button>
        </>
      )}
    </div>
  );
}

export default function SettingsContractorTypes() {
  const data = useLoaderData<typeof loader>();
  const createFetcher = useFetcher<typeof action>();
  const reorderFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();
  const [pendingDelete, setPendingDelete] = useState<ContractorType | null>(null);
  const [newName, setNewName] = useState("");

  const types: ContractorType[] = "forbidden" in data ? [] : data.types;

  function move(idx: number, dir: -1 | 1) {
    if (reorderFetcher.state !== "idle") return;
    const next = [...types];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    reorderFetcher.submit({ intent: "reorder", ids: JSON.stringify(next.map((t) => t.id)) }, { method: "POST" });
  }

  if ("forbidden" in data) return <AccessDenied />;

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb items={[{ label: "Settings", href: "/settings" }, { label: "Contractor types" }]} />
      <p className="text-[13px] text-ih-fg-3">Recommended contractor categories shown on repair items and reports.</p>

      <div className="bg-ih-bg-card border border-ih-border rounded-lg p-4">
        <createFetcher.Form method="POST" className="flex gap-2" onSubmit={() => setNewName("")}>
          <input type="hidden" name="intent" value="create" />
          <input name="name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g., Licensed Electrician" className={`flex-1 ${INPUT}`} />
          <button type="submit" disabled={!newName.trim()} className="px-4 py-2 rounded-md bg-ih-primary text-white text-[13px] font-bold disabled:opacity-50">Add</button>
        </createFetcher.Form>
      </div>

      {types.length === 0 ? (
        <div className="text-center py-10 bg-ih-bg-card border border-ih-border rounded-lg">
          <p className="font-bold text-[14px] text-ih-fg-2">No contractor types yet.</p>
        </div>
      ) : (
        <div className="bg-ih-bg-card border border-ih-border rounded-lg divide-y divide-ih-border">
          {types.map((t, idx) => (
            <ContractorTypeRow key={t.id} t={t} idx={idx} count={types.length} onMove={move} onRequestDelete={() => setPendingDelete(t)} />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete contractor type"
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

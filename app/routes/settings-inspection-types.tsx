import { useState } from "react";
import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/settings-inspection-types";
import { createApi } from "~/lib/api-client.server";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";

interface ApiInspectionType {
  id: string;
  name: string;
  basedOn: string | null;
  description: string | null;
  enabled: boolean;
  sortOrder: number | null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) return { forbidden: true as const, orgTypes: [] as ApiInspectionType[] };
  try {
    const api = createApi(context, { token });
    const res = await api.inspectionTypes["inspection-types"].$get();
    if (!res.ok) return { forbidden: false as const, orgTypes: [] as ApiInspectionType[] };
    const body = await res.json();
    return {
      forbidden: false as const,
      orgTypes: ((body as Record<string, unknown>).data ?? []) as ApiInspectionType[],
    };
  } catch {
    return { forbidden: false as const, orgTypes: [] as ApiInspectionType[] };
  }
}

interface PlatformSubtype {
  slug: string;
  name: string;
  enabled: boolean;
  templateCount: number;
  inspectionCount: number;
}

interface OrgSubtype {
  id: string;
  name: string;
  basedOn: string;
  description: string;
  enabled: boolean;
}

function toOrgSubtype(t: ApiInspectionType): OrgSubtype {
  return {
    id: t.id,
    name: t.name,
    basedOn: t.basedOn ?? "",
    description: t.description ?? "",
    enabled: t.enabled,
  };
}

const PLATFORM_SUBTYPES: PlatformSubtype[] = [
  { slug: "office", name: "Office", enabled: true, templateCount: 0, inspectionCount: 0 },
  { slug: "retail", name: "Retail", enabled: true, templateCount: 0, inspectionCount: 0 },
  { slug: "hospitality", name: "Hospitality", enabled: true, templateCount: 0, inspectionCount: 0 },
  { slug: "industrial", name: "Industrial", enabled: true, templateCount: 0, inspectionCount: 0 },
  { slug: "institutional", name: "Institutional", enabled: true, templateCount: 0, inspectionCount: 0 },
  { slug: "mixed-use", name: "Mixed-Use", enabled: true, templateCount: 0, inspectionCount: 0 },
];

const EMPTY_FORM = { name: "", basedOn: "", description: "" };

export default function SettingsInspectionTypes() {
  const data = useLoaderData<typeof loader>();
  const [platformSubtypes] = useState<PlatformSubtype[]>(PLATFORM_SUBTYPES);
  const [orgSubtypes, setOrgSubtypes] = useState<OrgSubtype[]>(
    data.orgTypes.map(toOrgSubtype),
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  if (data.forbidden) return <AccessDenied />;

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(ot: OrgSubtype) {
    setEditingId(ot.id);
    setForm({ name: ot.name, basedOn: ot.basedOn, description: ot.description });
    setModalOpen(true);
  }

  async function save() {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    const body = {
      name: form.name,
      basedOn: form.basedOn || undefined,
      description: form.description || undefined,
    };
    const url = editingId
      ? `/api/admin/inspection-types/${editingId}`
      : "/api/admin/inspection-types";
    const res = await fetch(url, {
      method: editingId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    if (res.ok) {
      if (editingId) {
        const id = editingId;
        setOrgSubtypes((prev) =>
          prev.map((o) =>
            o.id === id
              ? { ...o, name: form.name, basedOn: form.basedOn, description: form.description }
              : o,
          ),
        );
      } else {
        const json = (await res.json()) as { data?: ApiInspectionType };
        if (json.data) {
          const created = toOrgSubtype(json.data);
          setOrgSubtypes((prev) => [...prev, created]);
        }
      }
      setModalOpen(false);
    }
    setSaving(false);
  }

  async function toggleOrg(ot: OrgSubtype) {
    const next = !ot.enabled;
    const res = await fetch(`/api/admin/inspection-types/${ot.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ enabled: next }),
    });
    if (res.ok) {
      const id = ot.id;
      setOrgSubtypes((prev) =>
        prev.map((o) => (o.id === id ? { ...o, enabled: next } : o)),
      );
    }
  }

  return (
    <div className="space-y-[18px]">
      <div className="flex items-center gap-2 text-[13px] text-ih-fg-3">
        <Link
          to="/settings"
          className="hover:text-ih-primary transition-colors"
        >
          Settings
        </Link>
        <span>&rsaquo;</span>
        <span className="text-ih-fg-1">
          Inspection types
        </span>
      </div>

      <h2 className="text-[19px] font-bold text-ih-fg-1">
        Inspection types
      </h2>

      {/* Platform subtypes */}
      <section className="space-y-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">
            Platform
          </p>
          <p className="text-[12px] text-ih-fg-3 mt-0.5">
            Standard types that ship with the platform.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {platformSubtypes.map((pt) => (
            <div
              key={pt.slug}
              className="p-4 bg-ih-bg-card border border-ih-border rounded-lg"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[13px] text-ih-fg-1">
                    {pt.name}
                  </p>
                  <p className="text-[11px] text-ih-fg-3 mt-1">
                    {pt.templateCount} templates &middot; {pt.inspectionCount}{" "}
                    inspections
                  </p>
                </div>
                <span
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-md border ${
 pt.enabled
 ? "border-ih-ok-fg/20 bg-ih-ok-bg text-ih-ok-fg"
 : "border-ih-border bg-ih-bg-muted text-ih-fg-3"
 }`}
                >
                  {pt.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Org subtypes */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">
              Your organization
            </p>
            <p className="text-[12px] text-ih-fg-3 mt-0.5">
              Custom types based on platform types.
            </p>
          </div>
          <button
            onClick={openAdd}
            className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors"
          >
            + Add custom subtype
          </button>
        </div>

        {orgSubtypes.length === 0 ? (
          <div className="text-center py-10 bg-ih-bg-card border border-ih-border rounded-lg">
            <p className="font-bold text-[14px] text-ih-fg-3">
              No custom subtypes yet.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {orgSubtypes.map((ot) => (
              <div
                key={ot.id}
                className="p-4 bg-ih-bg-card border border-ih-border rounded-lg"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-[13px] text-ih-fg-1 truncate">
                        {ot.name}
                      </p>
                      {!ot.enabled && (
                        <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-ih-bg-muted text-ih-fg-3 flex-shrink-0">
                          Disabled
                        </span>
                      )}
                    </div>
                    {ot.basedOn && (
                      <p className="text-[11px] text-ih-fg-3 mt-1">
                        Based on{" "}
                        {platformSubtypes.find((pt) => pt.slug === ot.basedOn)?.name ??
                          ot.basedOn}
                      </p>
                    )}
                    {ot.description && (
                      <p className="text-[11px] text-ih-fg-3 mt-1 line-clamp-2">
                        {ot.description}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => openEdit(ot)}
                      className="text-[12px] text-ih-primary hover:underline font-bold"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => toggleOrg(ot)}
                      className={`text-[12px] font-bold hover:underline ${
 ot.enabled
 ? "text-ih-fg-3"
 : "text-ih-ok-fg"
 }`}
                    >
                      {ot.enabled ? "Disable" : "Enable"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Add / Edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-[rgba(15,23,42,0.4)]"
            onClick={() => setModalOpen(false)}
          />
          <div className="relative bg-ih-bg-card border border-ih-border rounded-lg shadow-ih-popover w-full max-w-md mx-4 p-6 space-y-4">
            <h3 className="text-[16px] font-bold text-ih-fg-1">
              {editingId ? "Edit custom subtype" : "Add custom subtype"}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
                  Name
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="e.g., Medical Office"
                  className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
                  Based on
                </label>
                <select
                  value={form.basedOn}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, basedOn: e.target.value }))
                  }
                  className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                >
                  <option value="">Select a platform type...</option>
                  {platformSubtypes.map((pt) => (
                    <option key={pt.slug} value={pt.slug}>
                      {pt.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
                  Description
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                  rows={2}
                  placeholder="Optional details..."
                  className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 rounded-md border border-ih-border text-[13px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 rounded-md bg-ih-primary text-white text-[13px] font-bold hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

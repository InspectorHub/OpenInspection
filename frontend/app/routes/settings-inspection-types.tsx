import { useState } from "react";
import { Link } from "react-router";

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
  templateCount: number;
  inspectionCount: number;
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
  const [platformSubtypes] = useState<PlatformSubtype[]>(PLATFORM_SUBTYPES);
  const [orgSubtypes, setOrgSubtypes] = useState<OrgSubtype[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

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
    setSaving(true);
    // API integration will be wired in a later phase
    const newSubtype: OrgSubtype = {
      id: editingId ?? crypto.randomUUID(),
      name: form.name,
      basedOn: form.basedOn,
      description: form.description,
      enabled: true,
      templateCount: 0,
      inspectionCount: 0,
    };
    if (editingId) {
      setOrgSubtypes((prev) =>
        prev.map((o) => (o.id === editingId ? newSubtype : o)),
      );
    } else {
      setOrgSubtypes((prev) => [...prev, newSubtype]);
    }
    setModalOpen(false);
    setSaving(false);
  }

  function toggleOrg(ot: OrgSubtype) {
    setOrgSubtypes((prev) =>
      prev.map((o) =>
        o.id === ot.id ? { ...o, enabled: !o.enabled } : o,
      ),
    );
  }

  return (
    <div className="space-y-[18px]">
      <div className="flex items-center gap-2 text-[13px] text-slate-500">
        <Link
          to="/settings"
          className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
        >
          Settings
        </Link>
        <span>&rsaquo;</span>
        <span className="text-slate-900 dark:text-slate-100">
          Inspection types
        </span>
      </div>

      <h2 className="text-[19px] font-bold text-slate-900 dark:text-slate-100">
        Inspection types
      </h2>

      {/* Platform subtypes */}
      <section className="space-y-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Platform
          </p>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Standard types that ship with the platform.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {platformSubtypes.map((pt) => (
            <div
              key={pt.slug}
              className="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[13px] text-slate-900 dark:text-slate-100">
                    {pt.name}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {pt.templateCount} templates &middot; {pt.inspectionCount}{" "}
                    inspections
                  </p>
                </div>
                <span
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-md border ${
                    pt.enabled
                      ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                      : "border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 text-slate-500"
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
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Your organization
            </p>
            <p className="text-[12px] text-slate-500 mt-0.5">
              Custom types based on platform types.
            </p>
          </div>
          <button
            onClick={openAdd}
            className="h-9 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 transition-colors"
          >
            + Add custom subtype
          </button>
        </div>

        {orgSubtypes.length === 0 ? (
          <div className="text-center py-10 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
            <p className="font-bold text-[14px] text-slate-600 dark:text-slate-400">
              No custom subtypes yet.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {orgSubtypes.map((ot) => (
              <div
                key={ot.id}
                className="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-[13px] text-slate-900 dark:text-slate-100">
                      {ot.name}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      {ot.templateCount} templates &middot;{" "}
                      {ot.inspectionCount} inspections
                    </p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => openEdit(ot)}
                      className="text-[12px] text-indigo-600 dark:text-indigo-400 hover:underline font-bold"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => toggleOrg(ot)}
                      className={`text-[12px] font-bold hover:underline ${
                        ot.enabled
                          ? "text-slate-500"
                          : "text-emerald-700 dark:text-emerald-400"
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
            className="absolute inset-0 bg-black/40"
            onClick={() => setModalOpen(false)}
          />
          <div className="relative bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
            <h3 className="text-[16px] font-bold text-slate-900 dark:text-slate-100">
              {editingId ? "Edit custom subtype" : "Add custom subtype"}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1 uppercase tracking-widest">
                  Name
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="e.g., Medical Office"
                  className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-[13px] text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1 uppercase tracking-widest">
                  Based on
                </label>
                <select
                  value={form.basedOn}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, basedOn: e.target.value }))
                  }
                  className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-[13px] text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
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
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1 uppercase tracking-widest">
                  Description
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                  rows={2}
                  placeholder="Optional details..."
                  className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-[13px] text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 rounded-md border border-slate-200 dark:border-slate-600 text-[13px] font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 rounded-md bg-indigo-600 text-white text-[13px] font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50"
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

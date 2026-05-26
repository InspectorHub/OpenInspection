import { useState } from "react";
import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/settings-event-types";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

interface EventType {
  id: string;
  name: string;
  slug: string;
  defaultDurationMin: number | null;
  defaultPriceCents: number | null;
  color: string | null;
  sortOrder: number | null;
  active: boolean;
}

export function meta() {
  return [{ title: "Event Types - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/admin/event-types", { token });
    if (!res.ok) return { types: [] };
    const body = await res.json();
    return { types: ((body as Record<string, unknown>).data ?? []) as EventType[] };
  } catch {
    return { types: [] };
  }
}

const EMPTY_FORM = {
  name: "",
  slug: "",
  defaultDurationMin: 30,
  priceDollars: 0,
  color: "#4a72ff",
  sortOrder: 0,
};

export default function SettingsEventTypes() {
  const { types: initial } = useLoaderData<typeof loader>();
  const [types, setTypes] = useState<EventType[]>(initial as EventType[]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(t: EventType) {
    setEditingId(t.id);
    setForm({
      name: t.name,
      slug: t.slug,
      defaultDurationMin: t.defaultDurationMin ?? 30,
      priceDollars: (t.defaultPriceCents ?? 0) / 100,
      color: t.color ?? "#4a72ff",
      sortOrder: t.sortOrder ?? 0,
    });
    setModalOpen(true);
  }

  async function save() {
    setSaving(true);
    const body = {
      name: form.name,
      slug: form.slug,
      defaultDurationMin: form.defaultDurationMin,
      defaultPriceCents: Math.round(form.priceDollars * 100),
      color: form.color,
      sortOrder: form.sortOrder,
    };
    const method = editingId ? "PATCH" : "POST";
    const url = editingId
      ? `/api/admin/event-types/${editingId}`
      : "/api/admin/event-types";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = (await res.json()) as { data?: EventType };
      if (editingId) {
        setTypes((prev) =>
          prev.map((t) => (t.id === editingId ? (json.data ?? t) : t)),
        );
      } else if (json.data) {
        setTypes((prev) => [...prev, json.data!]);
      }
      setModalOpen(false);
    }
    setSaving(false);
  }

  async function confirmDelete(t: EventType) {
    const res = await fetch(`/api/admin/event-types/${t.id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (res.ok) {
      setTypes((prev) => prev.filter((x) => x.id !== t.id));
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
        <span className="text-ih-fg-1">Event types</span>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[19px] font-bold text-ih-fg-1">
            Event types
          </h2>
          <p className="text-[13px] text-ih-fg-3 mt-1">
            Define ancillary inspection events that can be attached to an
            inspection.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors"
        >
          + Add type
        </button>
      </div>

      {types.length === 0 ? (
        <div className="text-center py-10 bg-ih-bg-card border border-ih-border rounded-lg">
          <p className="font-bold text-[14px] text-ih-fg-2">
            No event types yet.
          </p>
          <p className="text-[12px] text-ih-fg-3 mt-2">
            Click &ldquo;+ Add type&rdquo; to define your first event type.
          </p>
        </div>
      ) : (
        <div className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-ih-border">
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">
                  Name
                </th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">
                  Slug
                </th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">
                  Duration
                </th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">
                  Price
                </th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">
                  Color
                </th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ih-border">
              {types.map((t) => (
                <tr
                  key={t.id}
                  className="hover:bg-ih-bg-muted/50"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: t.color ?? "#4a72ff" }}
                      />
                      <span className="font-bold text-[13px] text-ih-fg-1">
                        {t.name}
                      </span>
                      {!t.active && (
                        <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-ih-bg-muted text-ih-fg-3">
                          Inactive
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-ih-fg-3">
                    {t.slug}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-ih-fg-2">
                    {t.defaultDurationMin ?? 0} min
                  </td>
                  <td className="px-4 py-3 text-[13px] text-ih-fg-2">
                    ${((t.defaultPriceCents ?? 0) / 100).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-ih-fg-3">
                    {t.color}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(t)}
                      className="text-[12px] text-ih-primary hover:underline mr-3 font-bold"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => confirmDelete(t)}
                      className="text-[12px] text-ih-bad-fg hover:underline font-bold"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setModalOpen(false)}
          />
          <div className="relative bg-ih-bg-card border border-ih-border rounded-lg shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
            <h3 className="text-[16px] font-bold text-ih-fg-1">
              {editingId ? "Edit event type" : "New event type"}
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
                  placeholder="e.g., Radon Test - Pickup"
                  className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
                  Slug
                </label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, slug: e.target.value }))
                  }
                  placeholder="radon_pickup"
                  className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 font-mono focus:border-ih-primary focus:shadow-ih-focus outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
                    Duration (min)
                  </label>
                  <input
                    type="number"
                    value={form.defaultDurationMin}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        defaultDurationMin: Number(e.target.value),
                      }))
                    }
                    min={1}
                    className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
                    Price ($)
                  </label>
                  <input
                    type="number"
                    value={form.priceDollars}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        priceDollars: Number(e.target.value),
                      }))
                    }
                    min={0}
                    step={0.01}
                    className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
                    Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={form.color}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, color: e.target.value }))
                      }
                      className="w-10 h-10 rounded-md border border-ih-border cursor-pointer"
                    />
                    <input
                      type="text"
                      value={form.color}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, color: e.target.value }))
                      }
                      className="flex-1 px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 font-mono focus:border-ih-primary focus:shadow-ih-focus outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
                    Sort order
                  </label>
                  <input
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        sortOrder: Number(e.target.value),
                      }))
                    }
                    min={0}
                    className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                  />
                </div>
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

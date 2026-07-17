import { useState, useRef } from "react";
import { useLoaderData } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-event-types";
import { createApi } from "~/lib/api-client.server";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";
import { Table, Modal } from "@core/shared-ui";
import { MoneyInput } from "~/components/MoneyInput";
import { m } from "~/paraglide/messages";

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
  return [{ title: m.settings_event_types_meta_title() }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) return { forbidden: true as const, types: [] as EventType[] };
  try {
    const api = createApi(context, { token });
    const res = await api.admin["event-types"].$get();
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
  const data = useLoaderData<typeof loader>();
  const [types, setTypes] = useState<EventType[]>(data.types as EventType[]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  if ("forbidden" in data) return <AccessDenied />;

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
    <div className="space-y-ih-list">
      <SettingsCrumb items={[{ label: m.settings_crumb_settings(), href: "/settings" }, { label: m.settings_event_types_crumb() }]} />

      <div className="flex items-start justify-between gap-4">
        <p className="text-[13px] text-ih-fg-3">
          {m.settings_event_types_intro()}
        </p>
        <button
          onClick={openCreate}
          className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors"
        >
          {m.settings_event_types_add_button()}
        </button>
      </div>

      {types.length === 0 ? (
        <div className="text-center py-10 bg-ih-bg-card border border-ih-border rounded-lg">
          <p className="font-bold text-[14px] text-ih-fg-2">
            {m.settings_event_types_empty_title()}
          </p>
          <p className="text-[12px] text-ih-fg-3 mt-2">
            {m.settings_event_types_empty_desc()}
          </p>
        </div>
      ) : (
        <div className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
          <Table<EventType>
            rows={types}
            getRowKey={(t) => t.id}
            columns={[
              {
                label: m.settings_event_types_col_name(),
                cell: (t) => (
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: t.color ?? "#4a72ff" }}
                    />
                    <span className="font-bold text-ih-fg-1">
                      {t.name}
                    </span>
                    {!t.active && (
                      <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-ih-bg-muted text-ih-fg-3">
                        {m.settings_event_types_inactive()}
                      </span>
                    )}
                  </div>
                ),
              },
              { label: m.settings_event_types_col_slug(), cell: (t) => <span className="font-mono text-[12px] text-ih-fg-3">{t.slug}</span> },
              { label: m.settings_event_types_col_duration(), cell: (t) => <span className="text-ih-fg-2">{m.settings_event_types_duration_value({ min: t.defaultDurationMin ?? 0 })}</span> },
              { label: m.settings_event_types_col_price(), cell: (t) => <span className="text-ih-fg-2">${((t.defaultPriceCents ?? 0) / 100).toFixed(2)}</span> },
              { label: m.settings_event_types_col_color(), cell: (t) => <span className="font-mono text-[11px] text-ih-fg-3">{t.color}</span> },
              {
                label: m.settings_event_types_col_actions(),
                align: "right",
                cell: (t) => (
                  <>
                    <button
                      onClick={() => openEdit(t)}
                      className="text-[12px] text-ih-primary hover:underline mr-3 font-bold"
                    >
                      {m.common_edit()}
                    </button>
                    <button
                      onClick={() => confirmDelete(t)}
                      className="text-[12px] text-ih-bad-fg hover:underline font-bold"
                    >
                      {m.common_delete()}
                    </button>
                  </>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* Create / Edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? m.settings_event_types_modal_edit_title() : m.settings_event_types_modal_new_title()}
        initialFocusRef={nameRef}
        footer={
          <>
            <button
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 rounded-md border border-ih-border text-[13px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors"
            >
              {m.common_cancel()}
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 rounded-md bg-ih-primary text-white text-[13px] font-bold hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
            >
              {saving ? m.settings_common_saving() : m.common_save()}
            </button>
          </>
        }
      >
        <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
                  {m.settings_event_types_name_label()}
                </label>
                <input
                  ref={nameRef}
                  type="text"
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder={m.settings_event_types_name_placeholder()}
                  className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
                  {m.settings_event_types_slug_label()}
                </label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, slug: e.target.value }))
                  }
                  placeholder={m.settings_event_types_slug_placeholder()}
                  className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 font-mono focus:border-ih-primary focus:shadow-ih-focus outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
                    {m.settings_event_types_duration_label()}
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
                    {m.settings_event_types_price_label()}
                  </label>
                  <MoneyInput
                    cents={Math.round(form.priceDollars * 100)}
                    onChange={(c) =>
                      setForm((f) => ({
                        ...f,
                        priceDollars: c == null ? 0 : c / 100,
                      }))
                    }
                    ariaLabel={m.settings_event_types_price_label()}
                    className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest">
                    {m.settings_event_types_color_label()}
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
                    {m.settings_event_types_sort_label()}
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
      </Modal>
    </div>
  );
}

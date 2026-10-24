import { useState, useRef, useEffect } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-event-types";
import { createApi } from "~/lib/api-client.server";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";
import { Table, Modal, PENDING_CLASS, pendingProps, useActionLatch } from "@core/shared-ui";
import { EventTypeFields } from "~/components/settings/EventTypeFields";
import { ConfirmDialog } from "@core/field-ui/components/ConfirmDialog";
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
  /** Hours between a visit being completed and its follow-up going out. Zero is
   *  a real setting ("tell them when the visit ends"), so every read uses `??`
   *  and no control may treat 0 as "unset". */
  followUpDelayHours: number | null;
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
    if (!res.ok) return { types: [] as EventType[], loadFailed: true };
    const body = await res.json();
    return { types: ((body as Record<string, unknown>).data ?? []) as EventType[], loadFailed: false };
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
  // A STRING, not a number. `Number("")` is 0, and 0 is a legitimate value here
  // ("send the follow-up the moment the visit ends") — so a numeric field that
  // coerces an emptied box would silently rewrite a tenant's 72 to "immediately"
  // rather than leaving it alone. Empty means "don't change it"; see save().
  followUpDelayHours: "",
};

export default function SettingsEventTypes() {
  const data = useLoaderData<typeof loader>();
  const [types, setTypes] = useState<EventType[]>(data.types as EventType[]);
  useEffect(() => { setTypes(data.types as EventType[]); }, [data.types]);
  const revalidator = useRevalidator();
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<EventType | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Two confirmations in one frame would send two deletes before `deleting` renders.
  const deleteLatch = useActionLatch(deleting);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  // Two clicks inside one frame both run before `saving` renders.
  const saveInFlight = useRef(false);
  useEffect(() => { if (!saving) saveInFlight.current = false; }, [saving]);
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
      followUpDelayHours: t.followUpDelayHours == null ? "" : String(t.followUpDelayHours),
    });
    setModalOpen(true);
  }

  async function save() {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    // An empty follow-up box is OMITTED, never sent as 0: the PUT schema is a
    // `.partial()`, so an absent key leaves the stored delay alone, while a 0
    // would mean "send it immediately" — the opposite of "I didn't touch that".
    const followUp = form.followUpDelayHours.trim();
    const body = {
      name: form.name,
      slug: form.slug,
      defaultDurationMin: form.defaultDurationMin,
      defaultPriceCents: Math.round(form.priceDollars * 100),
      color: form.color,
      sortOrder: form.sortOrder,
      ...(followUp === "" ? {} : { followUpDelayHours: Number(followUp) }),
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
    setDeleteFailed(false);
    setDeleting(true);
    // busy-controls-allow: DELETE /api/admin/event-types/:id runs EventService.deactivateEventType, which deletes the row or sets active=false by id and answers 200 even when the row is already gone, and the list update only filters by id, so a repeat changes nothing
    const res = await fetch(`/api/admin/event-types/${t.id}`, {
      method: "DELETE",
      credentials: "same-origin",
    }).catch(() => null);
    if (res?.ok) {
      setTypes((prev) => prev.filter((x) => x.id !== t.id));
      void revalidator.revalidate();
    } else setDeleteFailed(true);
    setDeleting(false);
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
          className="h-9 px-4 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600 transition-colors"
        >
          {m.settings_event_types_add_button()}
        </button>
      </div>

      {deleteFailed && <p role="alert" className="text-[12px] font-medium text-ih-bad-fg">{m.settings_event_types_delete_failed()}</p>}

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
                      <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-ih-bg-muted text-ih-fg-2">
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
                label: m.settings_event_types_col_followup(),
                cell: (t) => (
                  <span className="text-ih-fg-2 whitespace-nowrap" data-testid="event-type-followup">
                    {/* `??`, never `||`: 0 is "immediately", not "unset". */}
                    {(t.followUpDelayHours ?? 72) === 0
                      ? m.settings_event_types_followup_immediate()
                      : m.settings_event_types_followup_hours({ hours: t.followUpDelayHours ?? 72 })}
                  </span>
                ),
              },
              {
                label: m.settings_event_types_col_actions(),
                align: "right",
                cell: (t) => (
                  <>
                    <button
                      onClick={() => openEdit(t)}
                      className="text-[12px] text-ih-primary-text hover:underline mr-3 font-bold"
                    >
                      {m.common_edit()}
                    </button>
                    <button
                      onClick={() => { setDeleteFailed(false); setPendingDelete(t); }}
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

      {/* Deleting removes the type, or switches it off when visits already use it (EventService.deactivateEventType). */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={m.settings_event_types_delete_title()}
        message={pendingDelete ? (pendingDelete.active ? m.settings_event_types_delete_message : m.settings_event_types_delete_message_inactive)({ name: pendingDelete.name }) : ""}
        confirmLabel={m.common_delete()}
        busy={deleting}
        onConfirm={() => deleteLatch(() => { const t = pendingDelete; setPendingDelete(null); if (t) void confirmDelete(t); })}
        onCancel={() => setPendingDelete(null)}
      />

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
              {...pendingProps(saving, save)}
              className={`px-4 py-2 rounded-md bg-ih-primary text-ih-fg-inverse text-[13px] font-bold hover:bg-ih-primary-600 transition-colors ${PENDING_CLASS}`}
            >
              {saving ? m.settings_common_saving() : m.common_save()}
            </button>
          </>
        }
      >
        <EventTypeFields form={form} setForm={setForm} nameRef={nameRef} />
      </Modal>
    </div>
  );
}

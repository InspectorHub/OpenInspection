import { useState, useEffect } from "react";
import { Link, useLoaderData, useFetcher } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-communication-templates";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";
import { Button, Pill, TabStrip, EmptyState, Card, Modal } from "@core/shared-ui";
import {
  TemplateEditorModal, smsSegmentsClient,
  type MessageTemplate, type EditorTarget,
} from "~/components/settings/TemplateEditorModal";
import { m } from "~/paraglide/messages";
import { LoadFailedNotice } from "~/components/LoadFailedNotice";
import { SUPPORTED_CONTACT_LOCALES } from "../../server/lib/i18n/contact-locale";
import { localeLabel } from "~/lib/locales";

// ─── Types ───────────────────────────────────────────────────────────────────

// Re-exported: the SMS segment estimate moved to the editor that uses it, and
// the co-located spec addresses it here.
export { smsSegmentsClient };

/** One template, in however many languages the tenant has written it. */
export interface TemplateGroup {
  key: string;
  name: string;
  channel: "email" | "sms";
  /** Oldest first — the same order the send path resolves duplicates in. */
  variants: MessageTemplate[];
  /** The row a new language version is seeded from. */
  base: MessageTemplate;
  /** Supported languages this template has NOT been written in yet. */
  missing: string[];
}

/**
 * Group rows into templates-with-versions.
 *
 * The tenant thinks "my reminder email, in Spanish" — one template they have
 * written twice. A flat list showing two unrelated rows called "Reminder"
 * invites deleting the wrong one, and hides the fact that a language is
 * missing, which is the thing they cannot otherwise see.
 *
 * Grouping is by (name, channel), matching how the send path finds a variant.
 * Nothing enforces uniqueness on (name, channel, locale), so a group can hold
 * two rows in one language; both are listed rather than silently collapsed, so
 * a duplicate is visible to the person who can fix it.
 */
export function groupTemplateVariants(templates: MessageTemplate[]): TemplateGroup[] {
  const groups = new Map<string, TemplateGroup>();
  for (const t of templates) {
    const key = `${t.channel}::${t.name}`;
    const g = groups.get(key);
    if (g) { g.variants.push(t); continue; }
    groups.set(key, { key, name: t.name, channel: t.channel, variants: [t], base: t, missing: [] });
  }
  for (const g of groups.values()) {
    g.variants.sort((a, b) => (a.createdAt - b.createdAt) || a.id.localeCompare(b.id));
    g.base = g.variants[0];
    const present = new Set(g.variants.map((v) => v.locale));
    g.missing = SUPPORTED_CONTACT_LOCALES.filter((l) => !present.has(l));
  }
  return [...groups.values()];
}

interface ReferencingAutomation {
  id: string;
  name: string;
}

// ─── Meta ────────────────────────────────────────────────────────────────────

export function meta() {
  return [{ title: m.settings_msgtpl_meta_title() }];
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) return { forbidden: true as const };
  const api = createApi(context, { token });
  const [emailRes, smsRes] = await Promise.all([
    api.messageTemplates.index.$get({ query: { channel: "email" } }).catch(() => null),
    api.messageTemplates.index.$get({ query: { channel: "sms" } }).catch(() => null),
  ]);
  const emailTemplates =
    (emailRes && emailRes.ok
      ? ((await emailRes.json()) as { data?: MessageTemplate[] }).data
      : []) ?? [];
  const smsTemplates =
    (smsRes && smsRes.ok
      ? ((await smsRes.json()) as { data?: MessageTemplate[] }).data
      : []) ?? [];
  // IA-118 — `.catch(() => null)` on each request means a failure arrives as an
  // empty template list, and this page's empty state reads as "you have no
  // templates", which is what an operator checks before trusting an automation
  // to send anything.
  const loadFailed = !emailRes?.ok || !smsRes?.ok;
  return { emailTemplates, smsTemplates, loadFailed };
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "create") {
    const channel = String(form.get("channel") ?? "") as "email" | "sms";
    const name = String(form.get("name") ?? "").trim();
    const subject = channel === "email" ? (String(form.get("subject") ?? "").trim() || null) : null;
    const body = String(form.get("body") ?? "");
    const variables = form.getAll("variables").map(String).filter(Boolean);
    // A version's language is set once, at create. There is deliberately no
    // update path for it: changing it would reassign copy to readers it was
    // not written for.
    const locale = String(form.get("locale") ?? "en");
    const res = await (
      api.messageTemplates.index.$post as unknown as (a: {
        json: { name: string; channel: "email" | "sms"; subject: string | null; body: string; variables: string[]; locale: string };
      }) => Promise<Response>
    )({ json: { name, channel, subject, body, variables, locale } });
    if (!res.ok) return { ok: false, error: m.settings_msgtpl_create_error(), intent };
    return { ok: true, intent };
  }

  if (intent === "update") {
    const id = String(form.get("id") ?? "");
    const channel = String(form.get("channel") ?? "") as "email" | "sms";
    const name = String(form.get("name") ?? "").trim();
    const subject = channel === "email" ? (String(form.get("subject") ?? "").trim() || null) : null;
    const body = String(form.get("body") ?? "");
    const variables = form.getAll("variables").map(String).filter(Boolean);
    const res = await (
      api.messageTemplates[":id"].$patch as unknown as (a: {
        param: { id: string };
        json: { name?: string; subject?: string | null; body?: string; variables?: string[] };
      }) => Promise<Response>
    )({ param: { id }, json: { name, subject, body, variables } });
    if (!res.ok) return { ok: false, error: m.settings_msgtpl_update_error(), intent };
    return { ok: true, intent };
  }

  if (intent === "duplicate") {
    const id = String(form.get("id") ?? "");
    const res = await (
      api.messageTemplates[":id"].duplicate.$post as unknown as (a: {
        param: { id: string };
      }) => Promise<Response>
    )({ param: { id } });
    if (!res.ok) return { ok: false, error: m.settings_msgtpl_duplicate_error(), intent };
    return { ok: true, intent };
  }

  if (intent === "delete") {
    const id = String(form.get("id") ?? "");
    const res = await (
      api.messageTemplates[":id"].$delete as unknown as (a: {
        param: { id: string };
      }) => Promise<Response>
    )({ param: { id } });
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as {
        referencing?: ReferencingAutomation[];
        error?: string;
      } | null;
      return {
        ok: false,
        intent,
        conflict: true,
        referencing: body?.referencing ?? [],
        error: body?.error ?? m.settings_msgtpl_in_use(),
      };
    }
    if (!res.ok) return { ok: false, error: m.settings_msgtpl_delete_error(), intent };
    return { ok: true, intent };
  }

  if (intent === "preview") {
    const channel = String(form.get("channel") ?? "") as "email" | "sms";
    const subject = String(form.get("subject") ?? "");
    const body = String(form.get("body") ?? "");
    const res = await api.messageTemplates.preview.$post({
      json: { channel, subject: subject || null, body },
    });
    if (!res.ok) return { ok: false, error: m.settings_msgtpl_preview_error(), intent };
    const data = (
      (await res.json()) as { data?: { subject?: string; html?: string; text?: string } }
    ).data ?? {};
    return { ok: true, intent, preview: data };
  }

  if (intent === "test-send") {
    const channel = String(form.get("channel") ?? "") as "email" | "sms";
    const subject = String(form.get("subject") ?? "");
    const body = String(form.get("body") ?? "");
    const to = String(form.get("to") ?? "").trim();
    const res = await (
      api.messageTemplates["test-send"].$post as unknown as (a: {
        json: { channel: "email" | "sms"; subject?: string | null; body: string; to: string };
      }) => Promise<Response>
    )({ json: { channel, subject: channel === "email" ? (subject || null) : null, body, to } });
    const resBody = (await res.json().catch(() => null)) as {
      success?: boolean;
      error?: string;
    } | null;
    if (!resBody?.success) return { ok: false, error: resBody?.error ?? m.settings_msgtpl_test_send_error(), intent };
    return { ok: true, intent };
  }

  return { ok: true, intent: String(intent ?? "") };
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SettingsCommunicationTemplates() {
  const data = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState<"email" | "sms">("email");
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [deleting, setDeleting] = useState<MessageTemplate | null>(null);

  if ("forbidden" in data) return <AccessDenied />;
  const { emailTemplates, smsTemplates } = data;

  const templates = activeTab === "email" ? emailTemplates : smsTemplates;
  const groups = groupTemplateVariants(templates);

  return (
    <div className="space-y-ih-list">
      {"loadFailed" in data && data.loadFailed && <LoadFailedNotice />}
      <SettingsCrumb
        items={[
          { label: m.settings_crumb_root(), href: "/settings" },
          { label: m.settings_comms_crumb(), href: "/settings/communication" },
          { label: m.settings_msgtpl_crumb() },
        ]}
      />

      <div className="flex items-start justify-between gap-4">
        <p className="text-[13px] text-ih-fg-3">{m.settings_msgtpl_intro()}</p>
        <Button
          variant="primary"
          onClick={() => setEditing({ kind: "new", channel: activeTab, locale: "en", prefill: null })}
        >
          {m.settings_msgtpl_new_button()}
        </Button>
      </div>

      <TabStrip
        tabs={[
          { id: "email", label: m.settings_channel_email(), count: emailTemplates.length },
          { id: "sms", label: m.settings_channel_sms(), count: smsTemplates.length },
        ]}
        activeId={activeTab}
        onChange={(id) => setActiveTab(id as "email" | "sms")}
      />

      <TemplateList
        groups={groups}
        onEdit={(t) => setEditing({ kind: "edit", template: t })}
        onAddVariant={(g, locale) =>
          setEditing({ kind: "new", channel: g.channel, locale, prefill: g.base })
        }
        onDelete={setDeleting}
      />

      {/* Compliance SMS section */}
      <ComplianceSmsSection />

      {editing !== null && (
        <TemplateEditorModal
          target={editing}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting !== null && (
        <DeleteModal template={deleting} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}

// ─── Template list ────────────────────────────────────────────────────────────

function TemplateList({
  groups,
  onEdit,
  onAddVariant,
  onDelete,
}: {
  groups: TemplateGroup[];
  onEdit: (t: MessageTemplate) => void;
  onAddVariant: (g: TemplateGroup, locale: string) => void;
  onDelete: (t: MessageTemplate) => void;
}) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();

  if (groups.length === 0) {
    return (
      <Card>
        <EmptyState
          title={m.settings_msgtpl_empty_title()}
          description={m.settings_msgtpl_empty_desc()}
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="divide-y divide-ih-border">
        {groups.map((g) => {
          const t = g.base;
          return (
          <div
            key={g.key}
            className="flex items-start gap-4 px-5 py-3.5 hover:bg-ih-bg-muted transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-bold text-ih-fg-1">{g.name}</span>
                {t.isSeeded && <Pill tone="info">{m.settings_msgtpl_builtin_pill()}</Pill>}
              </div>
              {t.subject && (
                <p className="text-[11px] text-ih-fg-3 mt-0.5 truncate">{m.settings_msgtpl_subject_prefix({ subject: t.subject })}</p>
              )}
              {t.variables.length > 0 && (
                <p className="text-[11px] text-ih-fg-3 mt-0.5">
                  {m.settings_msgtpl_variables_prefix({ vars: t.variables.map((v) => `{{${v}}}`).join(", ") })}
                </p>
              )}
              <VariantRow group={g} onEdit={onEdit} onAddVariant={onAddVariant} onDelete={onDelete} />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="duplicate" />
                <input type="hidden" name="id" value={t.id} />
                <button
                  type="submit"
                  className="text-[12px] text-ih-fg-3 font-semibold hover:text-ih-fg-1"
                >
                  {m.settings_msgtpl_duplicate()}
                </button>
              </fetcher.Form>
            </div>
          </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Language versions ────────────────────────────────────────────────────────

/**
 * Which languages this template has been written in, and which it has not.
 *
 * The missing ones are shown as an INVITATION, not an error: most companies
 * will only ever write one language, and a warning colour would tell them
 * something is broken when nothing is. Recipients in a language nobody wrote
 * still receive the message — that is the fallback, and saying so here is what
 * stops "my Spanish clients got English" being filed as a bug.
 */
function VariantRow({
  group,
  onEdit,
  onAddVariant,
  onDelete,
}: {
  group: TemplateGroup;
  onEdit: (t: MessageTemplate) => void;
  onAddVariant: (g: TemplateGroup, locale: string) => void;
  onDelete: (t: MessageTemplate) => void;
}) {
  return (
    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
      <span className="text-[11px] text-ih-fg-3 mr-0.5">{m.settings_msgtpl_languages_label()}</span>
      {group.variants.map((v) => (
        <span key={v.id} className="inline-flex items-center rounded-md border border-ih-border bg-ih-bg-input">
          <button
            onClick={() => onEdit(v)}
            className="text-[11px] px-2 py-0.5 font-semibold text-ih-primary hover:underline"
          >
            {localeLabel(v.locale)}
          </button>
          {!v.isSeeded && (
            <button
              onClick={() => onDelete(v)}
              aria-label={m.settings_msgtpl_delete_variant_aria({ language: localeLabel(v.locale) })}
              className="text-[11px] pr-2 pl-0.5 text-ih-fg-3 hover:text-ih-bad-fg"
            >
              ×
            </button>
          )}
        </span>
      ))}
      {group.missing.map((loc) => (
        <button
          key={loc}
          onClick={() => onAddVariant(group, loc)}
          className="text-[11px] px-2 py-0.5 rounded-md border border-dashed border-ih-border text-ih-fg-3 hover:text-ih-fg-1 hover:border-ih-fg-3 transition-colors"
        >
          {m.settings_msgtpl_variant_add({ language: localeLabel(loc) })}
        </button>
      ))}
      {group.missing.length > 0 && (
        <span className="text-[11px] text-ih-fg-3 basis-full mt-0.5">
          {m.settings_msgtpl_variant_missing_note()}
        </span>
      )}
    </div>
  );
}

// ─── Delete modal ─────────────────────────────────────────────────────────────

function DeleteModal({
  template,
  onClose,
}: {
  template: MessageTemplate;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{
    ok: boolean;
    intent?: string;
    conflict?: boolean;
    referencing?: ReferencingAutomation[];
    error?: string;
  }>();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  const isConflict = fetcher.data?.conflict === true;
  const referencing = fetcher.data?.referencing ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      title={m.settings_msgtpl_delete_title()}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {m.common_cancel()}
          </Button>
          {!isConflict && (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="id" value={template.id} />
              <Button type="submit" variant="danger" disabled={fetcher.state !== "idle"}>
                {m.common_delete()}
              </Button>
            </fetcher.Form>
          )}
        </>
      }
    >
      {isConflict ? (
        <div className="space-y-3">
          <p className="text-[13px] text-ih-fg-1">
            {m.settings_msgtpl_delete_conflict({ count: referencing.length, plural: referencing.length !== 1 ? "s" : "" })}
          </p>
          <ul className="space-y-1">
            {referencing.map((a) => (
              <li
                key={a.id}
                className="text-[13px] text-ih-fg-2 pl-3 border-l-2 border-ih-border"
              >
                {a.name}
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-ih-fg-3">
            {m.settings_msgtpl_delete_conflict_hint()}
          </p>
        </div>
      ) : (
        <p className="text-[13px] text-ih-fg-2">
          {m.settings_msgtpl_delete_confirm_prefix()} <strong className="text-ih-fg-1">{template.name}</strong>{m.settings_msgtpl_delete_confirm_suffix()}
        </p>
      )}
    </Modal>
  );
}

// ─── Compliance SMS section ────────────────────────────────────────────────────

function ComplianceSmsSection() {
  return (
    <section className="space-y-2">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
        {m.settings_msgtpl_compliance_heading()}
      </h3>
      <Card className="p-4 space-y-3">
        <div>
          <p className="text-[13px] font-semibold text-ih-fg-1 mb-1">{m.settings_msgtpl_optin_heading()}</p>
          <p className="text-[12px] text-ih-fg-3">
            {m.settings_msgtpl_optin_desc_before()}{" "}
            <Link to="/settings/communication" className="text-ih-primary hover:underline">
              {m.settings_msgtpl_optin_link()}
            </Link>{" "}
            {m.settings_msgtpl_optin_desc_after()}
          </p>
        </div>
        <div>
          <p className="text-[13px] font-semibold text-ih-fg-1 mb-1">{m.settings_msgtpl_stopstart_heading()}</p>
          <p className="text-[12px] text-ih-fg-3">
            {m.settings_msgtpl_stopstart_desc()}
          </p>
        </div>
      </Card>
    </section>
  );
}

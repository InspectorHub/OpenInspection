import { useState } from "react";
import { useLoaderData, Form, useNavigation } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import { useDisplayLocale, useDisplayTimeZone } from "~/hooks/useSessionContext";
import { formatDateTime } from "~/lib/format";
import type { Route } from "./+types/settings-automations";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";
import { AutomationEditorModal } from "~/components/settings/AutomationEditorModal";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.settings_automations_meta_title() }];
}

// Exported so AutomationEditorModal (split out for the file-size gate — see
// app/components/settings/AutomationEditorModal.tsx) shares these exact shapes.
export interface Rule {
  id: string; name: string; trigger: string;
  // Spec 2 Task 0: recipientKind + recipientRoleProfileId replace the fixed
  // `recipient` enum. recipientRoleProfileId is set iff recipientKind==='role'.
  recipientKind: "role" | "inspector" | "all"; recipientRoleProfileId: string | null;
  delayMinutes: number;
  // Track L: channels[] supersedes the dead `channel` shadow.
  conditions: string | null; channels: string[];
  // SP2 Task 10: emailTemplateId / smsTemplateId replace embedded body fields.
  emailTemplateId: string | null; smsTemplateId: string | null;
  active: boolean; isDefault: boolean;
}
export interface Svc { id: string; name: string; }
interface LogRow { id: string; recipient: string; channel: string; sendAt: string; status: string; error: string | null; }
export interface TemplateSummary { id: string; name: string; channel: string; }
export interface RoleProfileOption { id: string; key: string; label: string; kind: string; active: boolean; }

// Trigger ids are unchanged (used as <option> values + rule.trigger keys). Labels are
// exposed as getters so each resolves at access time under the active paraglide locale.
export const TRIGGER_LABELS: Record<string, string> = {
  get "inspection.created"() { return m.label_trigger_inspection_created(); },
  get "inspection.confirmed"() { return m.label_trigger_inspection_confirmed(); },
  get "inspection.cancelled"() { return m.label_trigger_inspection_cancelled(); },
  get "inspection.reminder"() { return m.label_trigger_inspection_reminder(); },
  get "report.published"() { return m.label_trigger_report_published(); },
  get "invoice.created"() { return m.label_trigger_invoice_created(); },
  get "payment.received"() { return m.label_trigger_payment_received(); },
  get "agreement.signed"() { return m.label_trigger_agreement_signed(); },
  get "agreement.signer_signed"() { return m.label_trigger_agreement_signer_signed(); },
  get "agreement.viewed"() { return m.label_trigger_agreement_viewed(); },
  get "agreement.declined"() { return m.label_trigger_agreement_declined(); },
  get "agreement.expired"() { return m.label_trigger_agreement_expired(); },
  get "event.created"() { return m.label_trigger_event_created(); },
  get "event.completed"() { return m.label_trigger_event_completed(); },
};
// Spec 2 Task 0 — recipientKind options. Labels are getters (paraglide locale
// resolves at access time, matching TRIGGER_LABELS above).
export const RECIPIENT_KIND_LABELS: Record<"role" | "inspector" | "all", string> = {
  get role() { return m.settings_automations_recipient_kind_role(); },
  get inspector() { return m.settings_automations_recipient_kind_inspector(); },
  get all() { return m.settings_automations_recipient_kind_all(); },
};

export interface Conditions { requirePaid?: boolean; requireSigned?: boolean; serviceIds?: string[]; }

/** Friendly recipient label for the rule-list row: the targeted role profile's
 *  own (tenant-editable) label when kind==='role', else the kind label. Falls
 *  back to the raw kind string if the referenced profile id isn't found (e.g.
 *  a deactivated/deleted profile) so the row never renders blank. */
export function recipientLabel(rule: Pick<Rule, "recipientKind" | "recipientRoleProfileId">, roleProfiles: RoleProfileOption[]): string {
  if (rule.recipientKind === "role") {
    const profile = roleProfiles.find((p) => p.id === rule.recipientRoleProfileId);
    return profile?.label ?? RECIPIENT_KIND_LABELS.role;
  }
  return RECIPIENT_KIND_LABELS[rule.recipientKind];
}

/** Assemble the Only-if gate object from the editor inputs, or null when empty. */
export function buildConditions(input: { requirePaid: boolean; requireSigned: boolean; serviceIds: string[] }): Conditions | null {
  const conditions: Conditions = {
    ...(input.requirePaid ? { requirePaid: true } : {}),
    ...(input.requireSigned ? { requireSigned: true } : {}),
    ...(input.serviceIds.length ? { serviceIds: input.serviceIds } : {}),
  };
  return Object.keys(conditions).length ? conditions : null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) return { forbidden: true as const };
  const api = createApi(context, { token });
  const [rulesRes, svcRes, logsRes, cfgRes, emailTplRes, smsTplRes, roleProfilesRes] = await Promise.all([
    api.automations.index.$get().catch(() => null),
    api.services.index.$get({}).catch(() => null),
    api.automations.logs.recent.$get({ query: { limit: 50 } }).catch(() => null),
    api.admin["tenant-config"].$get().catch(() => null),
    api.messageTemplates.index.$get({ query: { channel: "email" } }).catch(() => null),
    api.messageTemplates.index.$get({ query: { channel: "sms" } }).catch(() => null),
    // Spec 2 Task 0 — role profiles power the recipientRoleProfileId picker below.
    // BFF-only (server-side fetch via the typed hono client; no client fetch).
    api.roleProfiles.index.$get().catch(() => null),
  ]);
  const rules = (rulesRes && rulesRes.ok ? ((await rulesRes.json()) as { data?: Rule[] }).data : []) ?? [];
  const services = (svcRes && svcRes.ok ? ((await svcRes.json()) as { data?: Svc[] }).data : []) ?? [];
  const recentLogs = (logsRes && logsRes.ok ? ((await logsRes.json()) as { data?: LogRow[] }).data : []) ?? [];
  const reviewUrl = (cfgRes && cfgRes.ok ? (((await cfgRes.json()) as { data?: { reviewUrl?: string | null } }).data?.reviewUrl) : "") ?? "";
  const emailTemplates = (emailTplRes && emailTplRes.ok ? ((await emailTplRes.json()) as { data?: TemplateSummary[] }).data : []) ?? [];
  const smsTemplates = (smsTplRes && smsTplRes.ok ? ((await smsTplRes.json()) as { data?: TemplateSummary[] }).data : []) ?? [];
  const roleProfiles = (roleProfilesRes && roleProfilesRes.ok
    ? ((await roleProfilesRes.json()) as { data?: RoleProfileOption[] }).data
    : []) ?? [];
  return { rules, services, recentLogs, reviewUrl, emailTemplates, smsTemplates, roleProfiles };
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "toggle") {
    const id = String(form.get("id") ?? "");
    const active = form.get("active") === "true";
    const res = await api.automations[":id"].$patch({ param: { id }, json: { active: !active } });
    return { ok: res.ok, error: res.ok ? undefined : m.settings_automations_request_failed() };
  }
  if (intent === "delete") {
    const id = String(form.get("id") ?? "");
    const res = await api.automations[":id"].$delete({ param: { id } });
    return { ok: res.ok, error: res.ok ? undefined : m.settings_automations_request_failed() };
  }
  if (intent === "save-review-url") {
    const reviewUrl = String(form.get("reviewUrl") ?? "").trim();
    const res = await api.admin["tenant-config"].$patch({ json: { reviewUrl: reviewUrl || null } });
    return { ok: res.ok, error: res.ok ? undefined : m.settings_automations_request_failed() };
  }
  if (intent === "save") {
    const serviceIds = form.getAll("serviceIds").map(String).filter(Boolean);
    const conditions = buildConditions({
      requirePaid: form.get("requirePaid") === "on",
      requireSigned: form.get("requireSigned") === "on",
      serviceIds,
    });
    // Track L (Task 9) — multi-channel: read the checked channels; >=1 is enforced
    // client-side (the Save button disables when none) AND server-side (zod .min(1)).
    const rawChannels = form.getAll("channels").map(String).filter((c) => c === "email" || c === "sms");
    // Default to email-only when none checked (client-side guard also enforces this).
    const channels = rawChannels.length ? rawChannels : ["email"];
    // SP2 Task 12: submit template ids instead of embedded body content.
    // Gate each template id on the resolved (defaulted) channel set so a null
    // channel selection never accidentally carries stale template ids.
    const emailTemplateId = String(form.get("emailTemplateId") ?? "") || null;
    const smsTemplateId = String(form.get("smsTemplateId") ?? "") || null;
    // Spec 2 Task 0 — recipientKind + recipientRoleProfileId replace the fixed
    // `recipient` enum. recipientRoleProfileId only travels when kind==='role'.
    const recipientKind = String(form.get("recipientKind") ?? "role");
    const recipientRoleProfileId = recipientKind === "role" ? (String(form.get("recipientRoleProfileId") ?? "") || null) : null;
    const json = {
      name: String(form.get("name") ?? ""),
      trigger: String(form.get("trigger") ?? ""),
      recipientKind,
      recipientRoleProfileId,
      delayMinutes: Number(form.get("delayMinutes") ?? 0),
      channels,
      emailTemplateId: channels.includes("email") ? emailTemplateId : null,
      smsTemplateId: channels.includes("sms") ? smsTemplateId : null,
      conditions,
    };
    const id = String(form.get("id") ?? "");
    const res = id
      ? await (api.automations[":id"].$patch as unknown as (a: { param: { id: string }; json: typeof json }) => Promise<Response>)({ param: { id }, json })
      : await (api.automations.index.$post as unknown as (a: { json: typeof json }) => Promise<Response>)({ json });
    return { ok: res.ok, error: res.ok ? undefined : m.settings_automations_request_failed() };
  }
  return { ok: true };
}

export default function SettingsAutomations() {
  const data = useLoaderData<typeof loader>();
  const displayTz = useDisplayTimeZone();
  const locale = useDisplayLocale();
  const nav = useNavigation();
  const [editing, setEditing] = useState<Rule | null | "new">(null);

  if ("forbidden" in data) return <AccessDenied />;
  const { rules, services, recentLogs, reviewUrl, emailTemplates, smsTemplates, roleProfiles } = data;

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb items={[{ label: m.settings_crumb_root(), href: "/settings" }, { label: m.settings_automations_crumb() }]} />

      <div className="flex items-center justify-between gap-4">
        <p className="text-[13px] text-ih-fg-3">{m.settings_automations_intro()}</p>
        <button onClick={() => setEditing("new")}
          className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors">
          {m.settings_automations_new_button()}
        </button>
      </div>

      <Form method="post" className="bg-ih-bg-card border border-ih-border rounded-lg p-4 space-y-2">
        <input type="hidden" name="intent" value="save-review-url" />
        <label htmlFor="reviewUrl" className="block text-[12px] font-semibold text-ih-fg-2">{m.settings_automations_review_label()}</label>
        <p className="text-[11px] text-ih-fg-3">{m.settings_automations_review_hint()}</p>
        <div className="flex gap-2">
          <input id="reviewUrl" name="reviewUrl" type="url" defaultValue={reviewUrl} placeholder={m.settings_automations_review_placeholder()}
            className="flex-1 h-9 px-3 rounded-md border border-ih-border bg-ih-bg-input text-[13px] text-ih-fg-1" />
          <button type="submit" disabled={nav.state !== "idle"}
            className="h-9 px-4 rounded-md bg-ih-bg-muted text-ih-fg-1 font-semibold text-[13px] border border-ih-border">{m.common_save()}</button>
        </div>
      </Form>

      <div className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
        {rules.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-ih-fg-3">{m.settings_automations_empty()}</div>
        ) : (
          <div className="divide-y divide-ih-border">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-ih-bg-muted transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-bold text-ih-fg-1">{rule.name}</p>
                    {rule.isDefault && <span className="text-[9px] font-bold px-1.5 py-0.5 bg-ih-bg-muted text-ih-fg-3 rounded uppercase tracking-widest">{m.settings_automations_default_badge()}</span>}
                    {(rule.channels ?? []).includes("sms") &&<span className="text-[9px] font-bold px-1.5 py-0.5 bg-ih-bg-muted text-ih-fg-3 rounded uppercase">{m.settings_channel_sms()}</span>}
                  </div>
                  <p className="text-[11px] text-ih-fg-3 mt-0.5">{TRIGGER_LABELS[rule.trigger] || rule.trigger} &rarr; {recipientLabel(rule, roleProfiles)}</p>
                </div>
                <button onClick={() => setEditing(rule)} className="text-[12px] text-ih-primary font-semibold">{m.common_edit()}</button>
                <Form method="post" className="shrink-0">
                  <input type="hidden" name="intent" value="toggle" />
                  <input type="hidden" name="id" value={rule.id} />
                  <input type="hidden" name="active" value={String(rule.active)} />
                  <button type="submit" aria-label={rule.active ? m.settings_automations_disable_aria() : m.settings_automations_enable_aria()}
                    className={`w-10 h-6 rounded-full relative transition-colors ${rule.active ? "bg-ih-primary" : "bg-ih-border-strong"}`}>
                    <span className={`absolute w-4 h-4 bg-ih-bg-card rounded-full top-1 transition-all ${rule.active ? "right-1" : "left-1"}`} />
                  </button>
                </Form>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-ih-border text-[12px] font-bold text-ih-fg-2 uppercase tracking-wide">{m.settings_automations_recent_heading()}</div>
        {recentLogs.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-ih-fg-3">{m.settings_automations_recent_empty()}</div>
        ) : (
          <div className="divide-y divide-ih-border">
            {recentLogs.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-5 py-2.5 text-[12px]">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                  l.channel === "sms" ? "bg-ih-primary-tint text-ih-primary" : "bg-ih-bg-muted text-ih-fg-3"}`}>{l.channel ?? "email"}</span>
                <span className="text-ih-fg-2 flex-1 min-w-0 truncate">{l.recipient}</span>
                <span className="text-ih-fg-3">{formatDateTime(l.sendAt, { locale, timeZone: displayTz })}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                  l.status === "sent" ? "bg-ih-ok-bg text-ih-ok-fg" :
                  l.status === "failed" ? "bg-ih-bad-bg text-ih-bad-fg" :
                  l.status === "skipped" ? "bg-ih-watch-bg text-ih-watch-fg" : "bg-ih-bg-muted text-ih-fg-3"}`}>{l.status}</span>
                {l.error && <span className="text-ih-fg-3 truncate max-w-[180px]" title={l.error}>{l.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <AutomationEditorModal
          rule={editing === "new" ? null : editing}
          services={services}
          emailTemplates={emailTemplates}
          smsTemplates={smsTemplates}
          roleProfiles={roleProfiles}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

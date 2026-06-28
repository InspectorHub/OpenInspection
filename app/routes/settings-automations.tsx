import { useState, useEffect } from "react";
import { Link, useLoaderData, Form, useNavigation, useFetcher } from "react-router";
import type { Route } from "./+types/settings-automations";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";

export function meta() {
  return [{ title: "Automations - Settings - OpenInspection" }];
}

interface Rule {
  id: string; name: string; trigger: string; recipient: string;
  delayMinutes: number;
  // Track L: channels[] supersedes the dead `channel` shadow.
  conditions: string | null; channels: string[];
  // SP2 Task 10: emailTemplateId / smsTemplateId replace embedded body fields.
  emailTemplateId: string | null; smsTemplateId: string | null;
  active: boolean; isDefault: boolean;
}
interface Svc { id: string; name: string; }
interface LogRow { id: string; recipient: string; channel: string; sendAt: string; status: string; error: string | null; }
interface TemplateSummary { id: string; name: string; channel: string; }

export const TRIGGER_LABELS: Record<string, string> = {
  "inspection.created": "Inspection created",
  "inspection.confirmed": "Inspection confirmed",
  "inspection.cancelled": "Inspection cancelled",
  "inspection.reminder": "Before the inspection (reminder)",
  "report.published": "Report published",
  "invoice.created": "Invoice created",
  "payment.received": "Payment received",
  "agreement.signed": "Agreement signed",
  "agreement.signer_signed": "A signer signed",
  "agreement.viewed": "Agreement viewed",
  "agreement.declined": "Agreement declined",
  "agreement.expired": "Agreement expired",
  "event.created": "Event created",
  "event.completed": "Event completed",
};
const RECIPIENTS = ["client", "buying_agent", "selling_agent", "inspector", "all"] as const;

interface Conditions { requirePaid?: boolean; requireSigned?: boolean; serviceIds?: string[]; }

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
  const [rulesRes, svcRes, logsRes, cfgRes, emailTplRes, smsTplRes] = await Promise.all([
    api.automations.index.$get().catch(() => null),
    api.services.index.$get({}).catch(() => null),
    api.automations.logs.recent.$get({ query: { limit: 50 } }).catch(() => null),
    api.admin["tenant-config"].$get().catch(() => null),
    api.messageTemplates.index.$get({ query: { channel: "email" } }).catch(() => null),
    api.messageTemplates.index.$get({ query: { channel: "sms" } }).catch(() => null),
  ]);
  const rules = (rulesRes && rulesRes.ok ? ((await rulesRes.json()) as { data?: Rule[] }).data : []) ?? [];
  const services = (svcRes && svcRes.ok ? ((await svcRes.json()) as { data?: Svc[] }).data : []) ?? [];
  const recentLogs = (logsRes && logsRes.ok ? ((await logsRes.json()) as { data?: LogRow[] }).data : []) ?? [];
  const reviewUrl = (cfgRes && cfgRes.ok ? (((await cfgRes.json()) as { data?: { reviewUrl?: string | null } }).data?.reviewUrl) : "") ?? "";
  const emailTemplates = (emailTplRes && emailTplRes.ok ? ((await emailTplRes.json()) as { data?: TemplateSummary[] }).data : []) ?? [];
  const smsTemplates = (smsTplRes && smsTplRes.ok ? ((await smsTplRes.json()) as { data?: TemplateSummary[] }).data : []) ?? [];
  return { rules, services, recentLogs, reviewUrl, emailTemplates, smsTemplates };
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
    return { ok: res.ok, error: res.ok ? undefined : "Request failed" };
  }
  if (intent === "delete") {
    const id = String(form.get("id") ?? "");
    const res = await api.automations[":id"].$delete({ param: { id } });
    return { ok: res.ok, error: res.ok ? undefined : "Request failed" };
  }
  if (intent === "save-review-url") {
    const reviewUrl = String(form.get("reviewUrl") ?? "").trim();
    const res = await api.admin["tenant-config"].$patch({ json: { reviewUrl: reviewUrl || null } });
    return { ok: res.ok, error: res.ok ? undefined : "Request failed" };
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
    const json = {
      name: String(form.get("name") ?? ""),
      trigger: String(form.get("trigger") ?? ""),
      recipient: String(form.get("recipient") ?? "client"),
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
    return { ok: res.ok, error: res.ok ? undefined : "Request failed" };
  }
  return { ok: true };
}

export default function SettingsAutomations() {
  const data = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const [editing, setEditing] = useState<Rule | null | "new">(null);

  if ("forbidden" in data) return <AccessDenied />;
  const { rules, services, recentLogs, reviewUrl, emailTemplates, smsTemplates } = data;

  return (
    <div className="space-y-[18px]">
      <div className="flex items-center gap-2 text-[13px] text-ih-fg-3">
        <Link to="/settings" className="hover:text-ih-primary transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-ih-fg-1">Automations</span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[19px] font-bold text-ih-fg-1">Automations</h2>
          <p className="text-[13px] text-ih-fg-3 mt-0.5">Emails sent automatically when inspection events occur.</p>
        </div>
        <button onClick={() => setEditing("new")}
          className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors">
          + New automation
        </button>
      </div>

      <Form method="post" className="bg-ih-bg-card border border-ih-border rounded-lg p-4 space-y-2">
        <input type="hidden" name="intent" value="save-review-url" />
        <label htmlFor="reviewUrl" className="block text-[12px] font-semibold text-ih-fg-2">Review link</label>
        <p className="text-[11px] text-ih-fg-3">Paste your Google/Yelp review link. The &ldquo;Review request&rdquo; automation stays off until this is set.</p>
        <div className="flex gap-2">
          <input id="reviewUrl" name="reviewUrl" type="url" defaultValue={reviewUrl} placeholder="https://g.page/r/..."
            className="flex-1 h-9 px-3 rounded-md border border-ih-border bg-ih-bg-input text-[13px] text-ih-fg-1" />
          <button type="submit" disabled={nav.state !== "idle"}
            className="h-9 px-4 rounded-md bg-ih-bg-muted text-ih-fg-1 font-semibold text-[13px] border border-ih-border">Save</button>
        </div>
      </Form>

      <div className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
        {rules.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-ih-fg-3">No automations yet.</div>
        ) : (
          <div className="divide-y divide-ih-border">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-ih-bg-muted transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-bold text-ih-fg-1">{rule.name}</p>
                    {rule.isDefault && <span className="text-[9px] font-bold px-1.5 py-0.5 bg-ih-bg-muted text-ih-fg-3 rounded uppercase tracking-widest">Default</span>}
                    {(rule.channels ?? []).includes("sms") &&<span className="text-[9px] font-bold px-1.5 py-0.5 bg-ih-bg-muted text-ih-fg-3 rounded uppercase">SMS</span>}
                  </div>
                  <p className="text-[11px] text-ih-fg-3 mt-0.5">{TRIGGER_LABELS[rule.trigger] || rule.trigger} &rarr; {rule.recipient}</p>
                </div>
                <button onClick={() => setEditing(rule)} className="text-[12px] text-ih-primary font-semibold">Edit</button>
                <Form method="post" className="shrink-0">
                  <input type="hidden" name="intent" value="toggle" />
                  <input type="hidden" name="id" value={rule.id} />
                  <input type="hidden" name="active" value={String(rule.active)} />
                  <button type="submit" aria-label={rule.active ? "Disable automation" : "Enable automation"}
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
        <div className="px-5 py-3 border-b border-ih-border text-[12px] font-bold text-ih-fg-2 uppercase tracking-wide">Recent activity</div>
        {recentLogs.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-ih-fg-3">No automation activity yet.</div>
        ) : (
          <div className="divide-y divide-ih-border">
            {recentLogs.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-5 py-2.5 text-[12px]">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                  l.channel === "sms" ? "bg-ih-primary-tint text-ih-primary" : "bg-ih-bg-muted text-ih-fg-3"}`}>{l.channel ?? "email"}</span>
                <span className="text-ih-fg-2 flex-1 min-w-0 truncate">{l.recipient}</span>
                <span className="text-ih-fg-3">{new Date(l.sendAt).toLocaleString()}</span>
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
        <AutomationEditor
          rule={editing === "new" ? null : editing}
          services={services}
          emailTemplates={emailTemplates}
          smsTemplates={smsTemplates}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function AutomationEditor({
  rule, services, emailTemplates, smsTemplates, onClose,
}: {
  rule: Rule | null;
  services: Svc[];
  emailTemplates: TemplateSummary[];
  smsTemplates: TemplateSummary[];
  onClose: () => void;
}) {
  const parsed: Conditions = rule?.conditions ? (JSON.parse(rule.conditions) as Conditions) : {};
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const submitting = fetcher.state !== "idle";
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Track L (Task 9) — channel multi-select. Default email for a new rule.
  const initialChannels = rule?.channels?.length ? rule.channels : ["email"];
  const [emailOn, setEmailOn] = useState(initialChannels.includes("email"));
  const [smsOn, setSmsOn] = useState(initialChannels.includes("sms"));
  const noChannel = !emailOn && !smsOn;
  const saveBlocked = noChannel;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.4)] p-4" onClick={onClose}>
      <fetcher.Form method="post" role="dialog" aria-modal="true" aria-label="Automation editor" onClick={(e) => e.stopPropagation()} className="bg-ih-bg-card border border-ih-border rounded-xl w-full max-w-lg max-h-[90vh] overflow-auto p-5 space-y-5">
        <input type="hidden" name="intent" value="save" />
        {rule && <input type="hidden" name="id" value={rule.id} />}
        <h3 className="text-[16px] font-bold text-ih-fg-1">{rule ? "Edit automation" : "New automation"}</h3>

        <input name="name" required defaultValue={rule?.name ?? ""} placeholder="Automation name"
          className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-input text-[13px]" />

        <fieldset className="space-y-2">
          <legend className="text-[12px] font-bold text-ih-fg-2 uppercase tracking-wide">When</legend>
          <select name="trigger" defaultValue={rule?.trigger ?? "report.published"}
            className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-input text-[13px]">
            {Object.entries(TRIGGER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-[12px] font-bold text-ih-fg-2 uppercase tracking-wide">Only if</legend>
          <label className="flex items-center gap-2 text-[13px] text-ih-fg-2">
            <input type="checkbox" name="requirePaid" defaultChecked={!!parsed.requirePaid} /> Client has paid
          </label>
          <label className="flex items-center gap-2 text-[13px] text-ih-fg-2">
            <input type="checkbox" name="requireSigned" defaultChecked={!!parsed.requireSigned} /> Agreement signed
          </label>
          <div>
            <p className="text-[11px] text-ih-fg-3 mb-1">Limit to services (none = any):</p>
            <div className="space-y-1 max-h-28 overflow-auto">
              {services.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-[12px] text-ih-fg-2">
                  <input type="checkbox" name="serviceIds" value={s.id} defaultChecked={parsed.serviceIds?.includes(s.id)} /> {s.name}
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-[12px] font-bold text-ih-fg-2 uppercase tracking-wide">Do this</legend>

          {/* Channel multi-select + recipient + delay */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-[13px] text-ih-fg-2">
                <input type="checkbox" name="channels" value="email" checked={emailOn}
                  onChange={(e) => setEmailOn(e.target.checked)} /> Email
              </label>
              <label className="flex items-center gap-1.5 text-[13px] text-ih-fg-2">
                <input type="checkbox" name="channels" value="sms" checked={smsOn}
                  onChange={(e) => setSmsOn(e.target.checked)} /> SMS
              </label>
            </div>
            <select name="recipient" defaultValue={rule?.recipient ?? "client"}
              className="h-9 px-3 rounded-md border border-ih-border bg-ih-bg-input text-[13px]">
              {RECIPIENTS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input name="delayMinutes" type="number" min={0} defaultValue={rule?.delayMinutes ?? 0}
              className="w-24 h-9 px-3 rounded-md border border-ih-border bg-ih-bg-input text-[13px]" title="Delay in minutes (for reminders: minutes BEFORE the inspection)" />
          </div>
          {noChannel && (
            <p className="text-[11px] text-ih-watch-fg">Pick at least one delivery channel.</p>
          )}

          {/* Email template selector — shown when email channel is enabled. */}
          {emailOn && (
            <div className="space-y-1.5 rounded-md border border-ih-border p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-3">Email</p>
              <label className="block text-[12px] font-semibold text-ih-fg-2" htmlFor="emailTemplateId">Template</label>
              <select id="emailTemplateId" name="emailTemplateId" defaultValue={rule?.emailTemplateId ?? ""}
                className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-input text-[13px]">
                <option value="">— Select a template —</option>
                {emailTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <Link to="/settings/communication/templates"
                className="inline-block text-[12px] text-ih-primary hover:underline mt-0.5">
                Edit / New template &rarr;
              </Link>
            </div>
          )}

          {/* SMS template selector — shown when sms channel is enabled. */}
          {smsOn && (
            <div className="space-y-1.5 rounded-md border border-ih-border p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-3">SMS</p>
              <label className="block text-[12px] font-semibold text-ih-fg-2" htmlFor="smsTemplateId">Template</label>
              <select id="smsTemplateId" name="smsTemplateId" defaultValue={rule?.smsTemplateId ?? ""}
                className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-input text-[13px]">
                <option value="">— Select a template —</option>
                {smsTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <Link to="/settings/communication/templates"
                className="inline-block text-[12px] text-ih-primary hover:underline mt-0.5">
                Edit / New template &rarr;
              </Link>
            </div>
          )}
        </fieldset>

        {fetcher.data && fetcher.data.ok === false && (
          <p className="text-[12px] text-ih-bad-fg">Could not save — please try again.</p>
        )}

        <div className="flex items-center gap-2">
          {rule && !rule.isDefault && (
            <button type="button" disabled={submitting}
              onClick={() => {
                if (!confirmDelete) { setConfirmDelete(true); return; }
                fetcher.submit({ intent: "delete", id: rule.id }, { method: "post" });
              }}
              className="h-9 px-4 rounded-md border border-ih-border text-[13px] text-ih-bad-fg disabled:opacity-50">
              {confirmDelete ? "Confirm delete?" : "Delete"}
            </button>
          )}
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-md border border-ih-border text-[13px] text-ih-fg-2">Cancel</button>
          <button type="submit" disabled={submitting || saveBlocked}
            title={noChannel ? "Pick at least one delivery channel" : undefined}
            className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] disabled:opacity-50">Save</button>
        </div>
      </fetcher.Form>
    </div>
  );
}

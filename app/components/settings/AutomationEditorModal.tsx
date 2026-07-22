import { useState, useEffect } from "react";
import { Link, useFetcher } from "react-router";
import { Modal, Icon } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import type { Rule, Svc, TemplateSummary, RoleProfileOption, Conditions } from "~/routes/settings-automations";
import { TRIGGER_LABELS, RECIPIENT_KIND_LABELS } from "~/routes/settings-automations";

/**
 * The "new/edit automation" modal form. Split out of settings-automations.tsx
 * (file-size gate) — this is the only surface in that route that needs
 * useFetcher/useEffect/Modal/Icon/Link, so the split keeps the route file to
 * loader/action/list-page concerns.
 */
export function AutomationEditorModal({
  rule, services, emailTemplates, smsTemplates, roleProfiles, onClose,
}: {
  rule: Rule | null;
  services: Svc[];
  emailTemplates: TemplateSummary[];
  smsTemplates: TemplateSummary[];
  roleProfiles: RoleProfileOption[];
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

  // Spec 2 Task 0 — recipientKind drives whether the role-profile select shows.
  // Default a new rule to 'role' (the common case; the picker below defaults
  // its own value to the primary client profile when one exists).
  const [recipientKind, setRecipientKind] = useState<"role" | "inspector" | "all">(rule?.recipientKind ?? "role");
  const activeRoleProfiles = roleProfiles.filter((p) => p.active);
  const clientProfile = activeRoleProfiles.find((p) => p.key === "client");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  return (
    <Modal
      open
      onClose={onClose}
      title={rule ? m.settings_automations_edit_title() : m.settings_automations_new_title()}
      size="lg"
      footer={
        <>
          {rule && !rule.isDefault && (
            <button type="button" disabled={submitting}
              onClick={() => {
                if (!confirmDelete) { setConfirmDelete(true); return; }
                fetcher.submit({ intent: "delete", id: rule.id }, { method: "post" });
              }}
              className="h-9 px-4 rounded-md border border-ih-border text-[13px] text-ih-bad-fg disabled:opacity-50">
              {confirmDelete ? m.settings_automations_confirm_delete() : m.common_delete()}
            </button>
          )}
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-md border border-ih-border text-[13px] text-ih-fg-2">{m.common_cancel()}</button>
          <button type="submit" form="automation-editor-form" disabled={submitting || saveBlocked}
            title={noChannel ? m.settings_automations_pick_channel_title() : undefined}
            className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] disabled:opacity-50">{m.common_save()}</button>
        </>
      }
    >
      <fetcher.Form id="automation-editor-form" method="post" className="space-y-5">
        <input type="hidden" name="intent" value="save" />
        {rule && <input type="hidden" name="id" value={rule.id} />}

        <input name="name" required defaultValue={rule?.name ?? ""} placeholder={m.settings_automations_name_placeholder()}
          className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-input text-[13px]" />

        <fieldset className="space-y-2">
          <legend className="text-[12px] font-bold text-ih-fg-2 uppercase tracking-wide">{m.settings_automations_when_legend()}</legend>
          <select name="trigger" defaultValue={rule?.trigger ?? "report.published"}
            className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-input text-[13px]">
            {Object.entries(TRIGGER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-[12px] font-bold text-ih-fg-2 uppercase tracking-wide">{m.settings_automations_onlyif_legend()}</legend>
          <label className="flex items-center gap-2 text-[13px] text-ih-fg-2">
            <input type="checkbox" name="requirePaid" defaultChecked={!!parsed.requirePaid} /> {m.settings_automations_require_paid()}
          </label>
          <label className="flex items-center gap-2 text-[13px] text-ih-fg-2">
            <input type="checkbox" name="requireSigned" defaultChecked={!!parsed.requireSigned} /> {m.settings_automations_require_signed()}
          </label>
          <div>
            <p className="text-[11px] text-ih-fg-3 mb-1">{m.settings_automations_limit_services()}</p>
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
          <legend className="text-[12px] font-bold text-ih-fg-2 uppercase tracking-wide">{m.settings_automations_dothis_legend()}</legend>

          {/* Channel multi-select + recipient + delay */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-[13px] text-ih-fg-2">
                <input type="checkbox" name="channels" value="email" checked={emailOn}
                  onChange={(e) => setEmailOn(e.target.checked)} /> {m.settings_channel_email()}
              </label>
              <label className="flex items-center gap-1.5 text-[13px] text-ih-fg-2">
                <input type="checkbox" name="channels" value="sms" checked={smsOn}
                  onChange={(e) => setSmsOn(e.target.checked)} /> {m.settings_channel_sms()}
              </label>
            </div>
            <select name="recipientKind" value={recipientKind}
              onChange={(e) => setRecipientKind(e.target.value as "role" | "inspector" | "all")}
              className="h-9 px-3 rounded-md border border-ih-border bg-ih-bg-input text-[13px]">
              {(Object.keys(RECIPIENT_KIND_LABELS) as Array<keyof typeof RECIPIENT_KIND_LABELS>).map((k) => (
                <option key={k} value={k}>{RECIPIENT_KIND_LABELS[k]}</option>
              ))}
            </select>
            {recipientKind === "role" && (
              <select name="recipientRoleProfileId" defaultValue={rule?.recipientRoleProfileId ?? clientProfile?.id ?? ""}
                className="h-9 px-3 rounded-md border border-ih-border bg-ih-bg-input text-[13px]">
                <option value="">{m.settings_automations_select_role()}</option>
                {activeRoleProfiles.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            )}
            <input name="delayMinutes" type="number" min={0} defaultValue={rule?.delayMinutes ?? 0}
              className="w-24 h-9 px-3 rounded-md border border-ih-border bg-ih-bg-input text-[13px]" title={m.settings_automations_delay_title()} />
          </div>
          {recipientKind === "all" && (
            <p className="text-[11px] text-ih-watch-fg" data-testid="automation-all-recipients-warning">
              {m.settings_automations_all_recipients_warning()}
            </p>
          )}
          {noChannel && (
            <p className="text-[11px] text-ih-watch-fg">{m.settings_automations_pick_channel()}</p>
          )}

          {/* Email template selector — shown when email channel is enabled. */}
          {emailOn && (
            <div className="space-y-1.5 rounded-md border border-ih-border p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-3">{m.settings_channel_email()}</p>
              <label className="block text-[12px] font-semibold text-ih-fg-2" htmlFor="emailTemplateId">{m.settings_automations_template_label()}</label>
              <select id="emailTemplateId" name="emailTemplateId" defaultValue={rule?.emailTemplateId ?? ""}
                className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-input text-[13px]">
                <option value="">{m.settings_automations_select_template()}</option>
                {emailTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <Link to="/settings/communication/templates"
                className="inline-flex items-center gap-1 text-[12px] text-ih-primary hover:underline mt-0.5">
                {m.settings_automations_edit_new_template()} <Icon name="arrowR" size={12} />
              </Link>
            </div>
          )}

          {/* SMS template selector — shown when sms channel is enabled. */}
          {smsOn && (
            <div className="space-y-1.5 rounded-md border border-ih-border p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-3">{m.settings_channel_sms()}</p>
              <label className="block text-[12px] font-semibold text-ih-fg-2" htmlFor="smsTemplateId">{m.settings_automations_template_label()}</label>
              <select id="smsTemplateId" name="smsTemplateId" defaultValue={rule?.smsTemplateId ?? ""}
                className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-input text-[13px]">
                <option value="">{m.settings_automations_select_template()}</option>
                {smsTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <Link to="/settings/communication/templates"
                className="inline-flex items-center gap-1 text-[12px] text-ih-primary hover:underline mt-0.5">
                {m.settings_automations_edit_new_template()} <Icon name="arrowR" size={12} />
              </Link>
            </div>
          )}
        </fieldset>

        {fetcher.data && fetcher.data.ok === false && (
          <p className="text-[12px] text-ih-bad-fg">{m.settings_automations_save_failed()}</p>
        )}
      </fetcher.Form>
    </Modal>
  );
}

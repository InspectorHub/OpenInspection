import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useForm, type SubmissionResult } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import { makeRoleProfileSchema } from "~/lib/forms/role-profile.schema";
import { Modal, Button, Input, Select, Checkbox } from "@core/shared-ui";
import { capabilitiesForProfile, type RoleCapabilities } from "../../../server/lib/people/capabilities";
import { m } from "~/paraglide/messages";
import type { MessageTemplateOption, RoleProfile } from "./contacts-helpers";

/**
 * Create/edit modal for a tenant role profile (Roles tab, admin-only). `kind`
 * is immutable once set — server/lib/validations/role-profile.schema.ts's
 * UpdateRoleProfileSchema doesn't even accept it — so the Select is disabled
 * whenever editing an existing profile, and always disabled for `isSystem`
 * rows (system profiles keep their seeded kind for the lifetime of the
 * tenant). Template selects are optional and list the tenant's own message
 * templates filtered to the matching channel, passed down from the loader.
 */
export function RoleProfileModal({
  open,
  onClose,
  profile,
  templates,
}: {
  open: boolean;
  onClose: () => void;
  profile: RoleProfile | null;
  templates: MessageTemplateOption[];
}) {
  const fetcher = useFetcher();
  const isEdit = !!profile;
  // Kind is create-only: the server never accepts it on PUT (immutable after
  // creation), so lock the control whenever a profile is being edited — which
  // covers isSystem rows too, since those are always edited, never created here.
  const kindLocked = isEdit;

  // Capability editor state. The form always submits the FULL explicit set
  // (like the seeds), so the checkboxes are controlled and initialized from the
  // RESOLVED capabilities — kind baseline plus the profile's own overrides.
  // On create, changing kind re-baselines the set: an operator picking "agent"
  // should start from what an agent can do, not from the client defaults they
  // never chose.
  const [kind, setKind] = useState<RoleProfile["kind"]>(profile?.kind ?? "client");
  const [caps, setCaps] = useState<RoleCapabilities>(() =>
    capabilitiesForProfile(profile?.kind ?? "client", profile?.capabilityOverrides ?? null));
  useEffect(() => {
    if (!open) return;
    const k = profile?.kind ?? "client";
    setKind(k);
    setCaps(capabilitiesForProfile(k, profile?.capabilityOverrides ?? null));
  }, [open, profile]);
  const rebaseKind = (k: RoleProfile["kind"]) => {
    setKind(k);
    setCaps(capabilitiesForProfile(k, null));
  };
  // The account track only exists for agent-kind roles today; the control stays
  // VISIBLE but disabled with the reason — a hidden control and an inert one
  // read identically, and only one of them is honest.
  const accountUnavailable = kind !== "agent";

  const lastResult =
    fetcher.data && typeof fetcher.data === "object" && "ok" in (fetcher.data as object)
      ? undefined
      : (fetcher.data as SubmissionResult<string[]> | undefined);

  const [form, fields] = useForm({
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeRoleProfileSchema() });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  const fetcherOk = (fetcher.data as { ok?: boolean } | undefined)?.ok;

  // Auto-close on a successful save. The `onSubmit` handler runs BEFORE the
  // fetcher's own submission resolves, so checking `fetcherOk` there only
  // ever reflects the PREVIOUS submission's result (always undefined on a
  // fresh open) — the modal would never close after the actual save. Close
  // from an effect once the fetcher settles back to idle with ok:true instead
  // (mirrors AddPersonModal's addSucceeded effect / the hub's useModalFetcher).
  //
  // The catch, and why the guard below is not redundant: `fetcher.data`
  // OUTLIVES the submission that produced it. A bare `ok === true` test is
  // therefore a latch that never resets — after one successful save it stays
  // true forever, so the next time `open` flips to true this effect fires in
  // that same commit and closes the modal before it ever paints. The symptom
  // is that every row click on the Roles table goes dead after the first save
  // and only a full page reload brings it back. So only a save that happened
  // during THIS opening may close THIS opening.
  const submittedWhileOpen = useRef(false);
  useEffect(() => {
    if (open) submittedWhileOpen.current = false;
  }, [open]);
  useEffect(() => {
    if (open && fetcher.state !== "idle") submittedWhileOpen.current = true;
  }, [open, fetcher.state]);
  useEffect(() => {
    if (open && submittedWhileOpen.current && fetcher.state === "idle" && fetcherOk === true) {
      submittedWhileOpen.current = false;
      onClose();
    }
  }, [open, fetcher.state, fetcherOk, onClose]);

  const emailOptions = [
    { value: "", label: m.contacts_roles_modal_template_none() },
    ...templates.filter((t) => t.channel === "email").map((t) => ({ value: t.id, label: t.name })),
  ];
  const smsOptions = [
    { value: "", label: m.contacts_roles_modal_template_none() },
    ...templates.filter((t) => t.channel === "sms").map((t) => ({ value: t.id, label: t.name })),
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? m.contacts_roles_modal_edit_title() : m.contacts_roles_modal_add_title()}
      size="md"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>{m.common_cancel()}</Button>
          <Button variant="primary" type="submit" form={form.id}>{m.common_save()}</Button>
        </>
      }
    >
      <fetcher.Form
        method="post"
        id={form.id}
        onSubmit={form.onSubmit}
        noValidate
        className="space-y-4"
      >
        <input type="hidden" name="intent" value={isEdit ? "role-update" : "role-create"} />
        {isEdit && <input type="hidden" name="id" value={profile.id} />}

        <Input
          id={fields.label.id}
          name={fields.label.name}
          label={m.contacts_roles_modal_label_label()}
          defaultValue={profile?.label ?? ""}
          placeholder={m.contacts_roles_modal_label_placeholder()}
          aria-invalid={fields.label.errors ? true : undefined}
          error={fields.label.errors?.[0]}
        />

        <Select
          id={fields.kind.id}
          name={fields.kind.name}
          label={m.contacts_roles_modal_kind_label()}
          value={kind}
          onChange={(e) => rebaseKind(e.target.value as RoleProfile["kind"])}
          disabled={kindLocked}
          hint={kindLocked ? m.contacts_roles_modal_kind_hint() : undefined}
          options={[
            { value: "client", label: m.contacts_roles_kind_client() },
            { value: "agent", label: m.contacts_roles_kind_agent() },
            { value: "other", label: m.contacts_roles_kind_other() },
          ]}
        />

        <Select
          id={fields.emailTemplateId.id}
          name={fields.emailTemplateId.name}
          label={m.contacts_roles_modal_email_template_label()}
          defaultValue={profile?.emailTemplateId ?? ""}
          options={emailOptions}
        />

        <Select
          id={fields.smsTemplateId.id}
          name={fields.smsTemplateId.name}
          label={m.contacts_roles_modal_sms_template_label()}
          defaultValue={profile?.smsTemplateId ?? ""}
          options={smsOptions}
        />

        <fieldset className="space-y-2 border-t border-ih-border pt-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-ih-fg-muted pb-1">
            {m.contacts_roles_modal_caps_heading()}
          </legend>
          <Checkbox
            name="cap_receivesReport"
            label={m.contacts_roles_modal_cap_receives_report()}
            checked={caps.receivesReport}
            onChange={(e) => setCaps({ ...caps, receivesReport: e.target.checked })}
          />
          <Checkbox
            name="cap_selfRetrieveReport"
            label={m.contacts_roles_modal_cap_self_retrieve()}
            checked={caps.selfRetrieveReport}
            onChange={(e) => setCaps({ ...caps, selfRetrieveReport: e.target.checked })}
          />
          <div>
            <Checkbox
              name="cap_canHaveAccount"
              label={m.contacts_roles_modal_cap_can_have_account()}
              checked={accountUnavailable ? false : caps.canHaveAccount}
              disabled={accountUnavailable}
              onChange={(e) => setCaps({ ...caps, canHaveAccount: e.target.checked })}
            />
            {accountUnavailable && (
              <p className="text-xs text-ih-fg-muted pl-6">{m.contacts_roles_modal_cap_account_unavailable()}</p>
            )}
          </div>
          <Checkbox
            name="cap_showsInAgentPortal"
            label={m.contacts_roles_modal_cap_shows_in_agent_portal()}
            checked={caps.showsInAgentPortal}
            onChange={(e) => setCaps({ ...caps, showsInAgentPortal: e.target.checked })}
          />
          <Select
            name="cap_canAccessRepairList"
            label={m.contacts_roles_modal_cap_repair_list_label()}
            value={caps.canAccessRepairList}
            onChange={(e) => setCaps({ ...caps, canAccessRepairList: e.target.value as RoleCapabilities["canAccessRepairList"] })}
            options={[
              { value: "off", label: m.contacts_roles_modal_cap_repair_off() },
              { value: "read", label: m.contacts_roles_modal_cap_repair_read() },
              { value: "readwrite", label: m.contacts_roles_modal_cap_repair_readwrite() },
            ]}
          />
        </fieldset>

        {form.errors && (
          <div className="px-3 py-2 rounded-md bg-ih-bad-bg border border-ih-border text-sm text-ih-bad-fg">
            {form.errors[0]}
          </div>
        )}
      </fetcher.Form>
    </Modal>
  );
}

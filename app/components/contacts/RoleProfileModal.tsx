import { useEffect } from "react";
import { useFetcher } from "react-router";
import { useForm, type SubmissionResult } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import { makeRoleProfileSchema } from "~/lib/forms/role-profile.schema";
import { Modal, Button, Input, Select } from "@core/shared-ui";
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
  const succeeded = fetcher.state === "idle" && fetcherOk === true;
  useEffect(() => {
    if (open && succeeded) onClose();
  }, [open, succeeded, onClose]);

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
          defaultValue={profile?.kind ?? "client"}
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

        {form.errors && (
          <div className="px-3 py-2 rounded-md bg-ih-bad-bg border border-ih-border text-sm text-ih-bad-fg">
            {form.errors[0]}
          </div>
        )}
      </fetcher.Form>
    </Modal>
  );
}

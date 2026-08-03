import { useFetcher } from "react-router";
import { useForm, type SubmissionResult } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import { makeAddContactSchema } from "~/lib/forms/contacts.schema";
import { Modal, Button } from "@core/shared-ui";
import { SUPPORTED_CONTACT_LOCALES } from "../../../server/lib/i18n/contact-locale";
import { localeLabel } from "~/lib/locales";
import { m } from "~/paraglide/messages";
import type { Contact } from "./contacts-helpers";

export function ContactModal({
  open,
  onClose,
  contact,
}: {
  open: boolean;
  onClose: () => void;
  contact: Contact | null;
}) {
  const fetcher = useFetcher();
  const isEdit = !!contact;

  // Conform: server validation flows back through fetcher.data (same as
  // useActionData but scoped to this fetcher). Cast to SubmissionResult<string[]>
  // so Conform's field accessor types are fully resolved (fields.*.errors is
  // string[] | undefined, not unknown[]).
  const lastResult =
    fetcher.data && typeof fetcher.data === "object" && "ok" in (fetcher.data as object)
      ? undefined // success sentinel — don't feed ok:true as a SubmissionResult
      : (fetcher.data as SubmissionResult<string[]> | undefined);

  const [form, fields] = useForm({
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeAddContactSchema() });
    },
    // eager-after-error: validate on blur first; once there's an error, switch
    // to real-time revalidation on every keystroke (project validation pattern).
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  // Close after a successful submission (fetcher.data has ok:true).
  const fetcherOk = (fetcher.data as { ok?: boolean } | undefined)?.ok;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? m.contacts_modal_edit_title() : m.contacts_action_add()}
      size="lg"
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
        onSubmit={(e) => {
          form.onSubmit(e);
          if (fetcherOk) setTimeout(onClose, 200);
        }}
        noValidate
        className="space-y-4"
      >
        <input type="hidden" name="intent" value={isEdit ? "update" : "create"} />
        {isEdit && <input type="hidden" name="id" value={contact.id} />}

          <div>
            <label htmlFor={fields.type.id} className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">{m.contacts_modal_type_label()}</label>
            <select
              id={fields.type.id}
              name={fields.type.name}
              defaultValue={contact?.type || "client"}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm"
            >
              <option value="client">{m.contacts_type_client()}</option>
              <option value="agent">{m.contacts_type_agent()}</option>
              {/* IA-96 — matches the third `kind` an inspection role can have.
                  Without it, a contact created under a contractor role could
                  never be corrected here: the select had nothing to hold it. */}
              <option value="other">{m.contacts_type_other()}</option>
            </select>
          </div>

          <div>
            <label htmlFor={fields.name.id} className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">{m.contacts_modal_name_label()}</label>
            <input
              id={fields.name.id}
              name={fields.name.name}
              type="text"
              defaultValue={contact?.name || ""}
              placeholder={m.contacts_modal_name_placeholder()}
              aria-invalid={fields.name.errors ? true : undefined}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm"
            />
            {fields.name.errors && (
              <p className="mt-1 text-xs text-ih-bad-fg">{fields.name.errors[0]}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor={fields.email.id} className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">{m.contacts_field_email()}</label>
              <input
                id={fields.email.id}
                name={fields.email.name}
                type="email"
                defaultValue={contact?.email || ""}
                placeholder={m.contacts_modal_email_placeholder()}
                aria-invalid={fields.email.errors ? true : undefined}
                readOnly={isEdit && contact?.type === "agent"}
                className={`w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm ${
                  isEdit && contact?.type === "agent" ? "opacity-60 cursor-not-allowed" : ""
                }`}
              />
              {isEdit && contact?.type === "agent" ? (
                <p className="mt-1 text-xs text-ih-fg-4">{m.contacts_agent_email_locked_hint()}</p>
              ) : fields.email.errors ? (
                <p className="mt-1 text-xs text-ih-bad-fg">{fields.email.errors[0]}</p>
              ) : null}
            </div>
            <div>
              <label htmlFor={fields.phone.id} className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">{m.contacts_field_phone()}</label>
              <input
                id={fields.phone.id}
                name={fields.phone.name}
                type="tel"
                defaultValue={contact?.phone || ""}
                placeholder={m.contacts_modal_phone_placeholder()}
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor={fields.agency.id} className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">{m.contacts_field_agency()}</label>
            <input
              id={fields.agency.id}
              name={fields.agency.name}
              type="text"
              defaultValue={contact?.agency || ""}
              placeholder={m.contacts_modal_agency_placeholder()}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm"
            />
          </div>

          {/* The language to address this person in. Staff set it as a
              CORRECTION — the client said so on the phone, or picked wrong on
              the booking form — so "Not set" has to be reachable again, and is
              the first option rather than a pre-selected English: a stored
              value is a stated preference, and only a stated preference is
              evidence anyone wants another language.

              Same three-state shape and the same option labels as the profile
              picker in Settings, from one table (`app/lib/locales.ts`), over
              the same list of tags the server accepts. */}
          <div>
            <label htmlFor={fields.locale.id} className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">{m.contacts_field_language()}</label>
            <select
              id={fields.locale.id}
              name={fields.locale.name}
              defaultValue={contact?.locale ?? ""}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm"
            >
              <option value="">{m.contacts_modal_language_unset_option()}</option>
              {SUPPORTED_CONTACT_LOCALES.map((tag) => (
                <option key={tag} value={tag}>{localeLabel(tag)}</option>
              ))}
            </select>
          </div>

        {form.errors && (
          <div className="px-3 py-2 rounded-md bg-ih-bad-bg border border-ih-bad text-sm text-ih-bad-fg">
            {form.errors[0]}
          </div>
        )}
      </fetcher.Form>
    </Modal>
  );
}

import { useFetcher } from "react-router";
import { useForm, type SubmissionResult } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import { addContactSchema } from "~/lib/forms/contacts.schema";
import { Modal, Button } from "@core/shared-ui";
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
      return parseWithZod(formData, { schema: addContactSchema });
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
      title={isEdit ? "Edit Contact" : "Add Contact"}
      size="lg"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={form.id}>Save</Button>
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
            <label htmlFor={fields.type.id} className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">Type</label>
            <select
              id={fields.type.id}
              name={fields.type.name}
              defaultValue={contact?.type || "client"}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm"
            >
              <option value="client">Client</option>
              <option value="agent">Agent</option>
            </select>
          </div>

          <div>
            <label htmlFor={fields.name.id} className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">Full Name *</label>
            <input
              id={fields.name.id}
              name={fields.name.name}
              type="text"
              defaultValue={contact?.name || ""}
              placeholder="Jane Smith"
              aria-invalid={fields.name.errors ? true : undefined}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm"
            />
            {fields.name.errors && (
              <p className="mt-1 text-xs text-ih-bad-fg">{fields.name.errors[0]}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor={fields.email.id} className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">Email</label>
              <input
                id={fields.email.id}
                name={fields.email.name}
                type="email"
                defaultValue={contact?.email || ""}
                placeholder="jane@realty.com"
                aria-invalid={fields.email.errors ? true : undefined}
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm"
              />
              {fields.email.errors && (
                <p className="mt-1 text-xs text-ih-bad-fg">{fields.email.errors[0]}</p>
              )}
            </div>
            <div>
              <label htmlFor={fields.phone.id} className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">Phone</label>
              <input
                id={fields.phone.id}
                name={fields.phone.name}
                type="tel"
                defaultValue={contact?.phone || ""}
                placeholder="(555) 123-4567"
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor={fields.agency.id} className="block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5">Agency</label>
            <input
              id={fields.agency.id}
              name={fields.agency.name}
              type="text"
              defaultValue={contact?.agency || ""}
              placeholder="Sunrise Realty"
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm"
            />
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

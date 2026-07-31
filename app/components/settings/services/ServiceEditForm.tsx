import { Form } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import { ServiceFields } from "./ServiceFields";
import { makeUpdateServiceSchema } from "~/lib/forms/settings.schema";
import { m } from "~/paraglide/messages";

interface EditableService {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  durationMinutes: number | null;
  templateId: string | null;
}

/**
 * Editing an existing service.
 *
 * There was no such form. The row's only "Edit" opened the qualified-inspector
 * checkboxes, so name, price, duration and template were writable exactly once —
 * at creation. That made the catalog's own warning unactionable: a service with no
 * template breaks any booking that picks it, the table said so in red, and the
 * only way to act on it was to deactivate the service and create a replacement,
 * losing its id and its history. The API had accepted a full update all along
 * (`PUT /api/services/:id`); only the form was missing.
 *
 * Mounted only for the row being edited, so its `useForm` instance and the
 * defaults below belong to one service and cannot leak into another.
 */
export function ServiceEditForm({
  service,
  templates,
  onCancel,
}: {
  service: EditableService;
  templates: Array<{ id: string; name: string }>;
  onCancel: () => void;
}) {
  const [form, fields] = useForm({
    id: `edit-service-${service.id}`,
    defaultValue: {
      name: service.name,
      description: service.description ?? "",
      durationMinutes: service.durationMinutes == null ? "" : String(service.durationMinutes),
      templateId: service.templateId ?? "",
    },
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeUpdateServiceSchema() });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  return (
    <Form
      method="post"
      id={form.id}
      onSubmit={form.onSubmit}
      noValidate
      className="bg-ih-bg-card border border-ih-border rounded-lg p-4 space-y-3"
    >
      <input type="hidden" name="intent" value="update-service" />
      <input type="hidden" name="id" value={service.id} />
      <p className="text-[13px] font-bold text-ih-fg-1">
        {m.settings_services_edit_heading({ name: service.name })}
      </p>
      <ServiceFields
        fields={fields}
        templates={templates}
        initialPriceCents={service.price}
        initialTemplateId={service.templateId ?? ""}
      />
      {form.errors && (
        <div className="px-3 py-2 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg">
          {form.errors[0]}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-8 px-3 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors"
        >
          {m.common_cancel()}
        </button>
        <button
          type="submit"
          className="h-8 px-4 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600 transition-colors"
        >
          {m.common_save()}
        </button>
      </div>
    </Form>
  );
}

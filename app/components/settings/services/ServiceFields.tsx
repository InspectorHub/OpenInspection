import { useState } from "react";
import { Link } from "react-router";
import { Select } from "@core/shared-ui";
import { MoneyInput } from "~/components/MoneyInput";
import { m } from "~/paraglide/messages";

/**
 * The parts of a Conform field this component reads.
 *
 * `initialValue` matters as much as the other two: without it the edit form
 * rendered empty inputs over a service that HAS a name, a description and a
 * duration — the form said the fields were blank, and saving would have made
 * that true. Conform's `defaultValue` on `useForm` only reaches an input that
 * asks for it.
 */
interface FieldBits {
  id: string;
  name: string;
  errors?: string[] | undefined;
  initialValue?: unknown;
}

/** Conform models a field's value as string | string[] | nested; only text here. */
function initialText(field: FieldBits): string | undefined {
  return typeof field.initialValue === "string" ? field.initialValue : undefined;
}

export interface ServiceFieldMetas {
  name: FieldBits;
  description: FieldBits;
  price: FieldBits;
  durationMinutes: FieldBits;
  templateId: FieldBits;
}

const LABEL_CLS = "block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1";
const INPUT_CLS =
  "w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none";

function FieldError({ errors }: { errors?: string[] | undefined }) {
  if (!errors?.length) return null;
  return <p className="mt-1 text-xs text-ih-bad-fg">{errors[0]}</p>;
}

/**
 * The fields that describe a service — shared by the create form and the edit
 * form, because they describe the same thing.
 *
 * Two decisions live here rather than in either caller:
 *
 * Price and duration sit together. They were diagonal (price top-right, duration
 * bottom-left) which put the two quantities of a service at opposite corners of
 * the form.
 *
 * The template's cost is stated where the choice is made. A service with no
 * template makes any booking that picks it fail in front of the customer, and the
 * form's own default was the value that causes it — so the admin met the
 * consequence only afterwards, as a red line in the table. Now: a single template
 * is preselected (there is nothing to choose), no templates at all says so and
 * points at where to make one, and leaving it blank states what that costs.
 */
export function ServiceFields({
  fields,
  templates,
  initialPriceCents = null,
  initialTemplateId = "",
}: {
  fields: ServiceFieldMetas;
  templates: Array<{ id: string; name: string }>;
  initialPriceCents?: number | null;
  initialTemplateId?: string;
}) {
  // Price is held in integer cents; a hidden field carries dollars so the zod
  // schema (which multiplies by 100) sees the same contract as the API.
  const [priceCents, setPriceCents] = useState<number | null>(initialPriceCents);
  const onlyTemplate = templates.length === 1 ? templates[0].id : "";
  const [templateId, setTemplateId] = useState(initialTemplateId || onlyTemplate);

  return (
    <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
      <div className="md:col-span-3">
        <label htmlFor={fields.name.id} className={LABEL_CLS}>{m.settings_services_name_label()}</label>
        <input
          type="text" id={fields.name.id} name={fields.name.name}
          defaultValue={initialText(fields.name)}
          placeholder={m.settings_services_name_placeholder()}
          aria-invalid={fields.name.errors ? true : undefined}
          className={INPUT_CLS}
        />
        <FieldError errors={fields.name.errors} />
      </div>
      <div className="md:col-span-3">
        <label htmlFor={fields.description.id} className={LABEL_CLS}>{m.settings_services_description_label()}</label>
        <input
          type="text" id={fields.description.id} name={fields.description.name}
          defaultValue={initialText(fields.description)}
          placeholder={m.settings_services_description_placeholder()}
          aria-invalid={fields.description.errors ? true : undefined}
          className={INPUT_CLS}
        />
        <FieldError errors={fields.description.errors} />
      </div>
      <div className="md:col-span-2">
        <label htmlFor={fields.price.id} className={LABEL_CLS}>{m.settings_services_price_label()}</label>
        <MoneyInput
          id={fields.price.id}
          cents={priceCents}
          onChange={setPriceCents}
          ariaLabel={m.settings_services_price_label()}
          className={INPUT_CLS}
        />
        <input type="hidden" name={fields.price.name} value={priceCents == null ? "" : String(priceCents / 100)} />
        <FieldError errors={fields.price.errors} />
      </div>
      {/* Duration — public booking sums it across the chosen services to size the
          appointment; with none set every booking uses the generic slot length. */}
      <div className="md:col-span-2">
        <label htmlFor={fields.durationMinutes.id} className={LABEL_CLS}>{m.settings_services_duration_label()}</label>
        <input
          type="number" min={5} step={5} inputMode="numeric"
          id={fields.durationMinutes.id} name={fields.durationMinutes.name}
          defaultValue={initialText(fields.durationMinutes)}
          placeholder={m.settings_services_duration_placeholder()}
          aria-invalid={fields.durationMinutes.errors ? true : undefined}
          className={INPUT_CLS}
        />
        <FieldError errors={fields.durationMinutes.errors} />
      </div>
      <div className="md:col-span-2">
        <label htmlFor={fields.templateId.id} className={LABEL_CLS}>{m.settings_services_template_label()}</label>
        {templates.length === 0 ? (
          <>
            <input type="hidden" name={fields.templateId.name} value="" />
            <p className="text-[12px] text-ih-fg-3">
              {m.settings_services_template_none_available()}{" "}
              <Link to="/templates" className="font-semibold text-ih-primary hover:underline">
                {m.settings_services_template_create_link()}
              </Link>
            </p>
          </>
        ) : (
          <>
            <Select
              bare
              id={fields.templateId.id}
              name={fields.templateId.name}
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              aria-label={m.settings_services_template_label()}
              options={[
                { value: "", label: m.settings_services_template_none() },
                ...templates.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
            {/* Reserved, not conditional: appearing and disappearing moved the
                form's Save button by two lines, under whatever the cursor was
                already aiming at. */}
            <div className="mt-1 min-h-[30px]">
              {!templateId && (
                <p className="text-[11px] text-ih-watch-fg">{m.settings_services_template_consequence()}</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

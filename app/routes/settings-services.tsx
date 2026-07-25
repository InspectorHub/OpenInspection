import { useEffect, useState } from "react";
import { useLoaderData, Form, useActionData } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import { didSaveService } from "~/lib/settings-services";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/settings-services";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { makeCreateServiceSchema, makeUpdateServiceSchema } from "~/lib/forms/settings.schema";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";
import { SCHEDULING_ROLES_SET } from "~/lib/settings/constants";
import { ServicesCatalogPanel } from "~/components/settings/services/ServicesCatalogPanel";
import { ServiceFields } from "~/components/settings/services/ServiceFields";
import { ServiceEditForm } from "~/components/settings/services/ServiceEditForm";
import { DiscountCodesPanel } from "~/components/settings/services/DiscountCodesPanel";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.settings_services_meta_title() }];
}

interface Service {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  active: boolean;
  /** Minutes. Public booking sums these to size the appointment window. */
  durationMinutes: number | null;
  /** The template a booking builds this service's inspection from. */
  templateId: string | null;
}

/** Template choices for the service's report-template picker. */
interface TemplateOption {
  id: string;
  name: string;
}

interface Discount {
  id: string;
  code: string;
  type: "percent" | "fixed";
  value: number;
  active: boolean;
}

interface Member {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) return { forbidden: true as const };
  try {
    const api = createApi(context, { token });
    const [svcRes, discountRes, membersRes, templatesRes] = await Promise.all([
      api.services.index.$get({}),
      api.services["discount-codes"].$get().catch(() => null),
      api.admin.members.$get().catch(() => null),
      // Needed to offer (and to name) the template a service builds its
      // inspection from — without it the create form cannot set templateId and
      // multi-service booking fails at request time.
      api.inspections.templates.$get({ query: { page: "1", pageSize: "100" } }).catch(() => null),
    ]);
    // GET /api/services returns { success, data: Service[] } — data IS the
    // array (the pre-C-10 admin endpoint wrapped it in { services, discounts },
    // which this loader kept parsing; the list rendered empty ever since).
    const body = svcRes.ok ? ((await svcRes.json()) as Record<string, unknown>) : {};
    const rawServices = (Array.isArray(body.data) ? body.data : []) as Service[];
    const discountBody = discountRes?.ok ? ((await discountRes.json()) as Record<string, unknown>) : {};
    const rawDiscounts = (Array.isArray(discountBody.data) ? discountBody.data : []) as Discount[];

    // Fetch qualification restrictions for all services in parallel (one GET per service).
    // Acceptable at realistic service counts; add a bulk endpoint if this grows.
    const restrictionResults = await Promise.all(
      rawServices.map(async (svc) => {
        try {
          const res = await api.services[":id"].inspectors.$get({ param: { id: svc.id } });
          if (!res.ok) return { serviceId: svc.id, userIds: [] as string[] };
          const rb = (await res.json()) as Record<string, unknown>;
          const rd = (rb.data ?? {}) as Record<string, unknown>;
          return { serviceId: svc.id, userIds: (Array.isArray(rd.userIds) ? rd.userIds : []) as string[] };
        } catch {
          return { serviceId: svc.id, userIds: [] as string[] };
        }
      }),
    );
    const restrictionMap: Record<string, string[]> = {};
    for (const r of restrictionResults) restrictionMap[r.serviceId] = r.userIds;

    let members: Member[] = [];
    if (membersRes?.ok) {
      const mb = (await membersRes.json()) as Record<string, unknown>;
      const raw = ((mb.data ?? []) as Member[]);
      members = raw.filter((m) => SCHEDULING_ROLES_SET.has(m.role));
    }

    let templates: TemplateOption[] = [];
    if (templatesRes?.ok) {
      const tb = (await templatesRes.json()) as { data?: TemplateOption[] };
      templates = (tb.data ?? []).map((t) => ({ id: t.id, name: t.name }));
    }

    return {
      services: rawServices,
      discounts: rawDiscounts,
      restrictionMap,
      members,
      templates,
    };
  } catch {
    return {
      services: [] as Service[],
      discounts: [] as Discount[],
      restrictionMap: {} as Record<string, string[]>,
      members: [] as Member[],
      templates: [] as TemplateOption[],
    };
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const form = await request.formData();
  const intent = form.get("intent");
  const api = createApi(context, { token });

  if (intent === "create-service") {
    const submission = parseWithZod(form, { schema: makeCreateServiceSchema() });
    if (submission.status !== "success") {
      return submission.reply();
    }
    const { name, description, price, durationMinutes, templateId } = submission.value;
    // TODO(C-10 collapse): hono/client collapses api.services.index.$post to a non-callable
    // union; localized assertion until the typed-hono spike resolves it. Binding preserved.
    const res = await (api.services.index.$post as unknown as (args: { json: Record<string, unknown> }) => Promise<Response>)({
      json: {
        name,
        // CreateServiceSchema.description is .optional() — undefined is the
        // only valid "absent" encoding; sending null fails validation (400).
        ...(description ? { description } : {}),
        price: Number(price) * 100 || 0,
        // Same "absent means omitted" rule for both optional fields. A blank
        // duration leaves booking on the time-slot window; a blank template
        // leaves the service unbookable, which the catalog table now says.
        ...(durationMinutes ? { durationMinutes: Number(durationMinutes) } : {}),
        ...(templateId ? { templateId } : {}),
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return submission.reply({
        formErrors: [(err as Record<string, string>)?.message || m.settings_services_error_create_failed()],
      });
    }
    // Tagged so the form can recognise ITS success and close+clear. A bare
    // { ok: true } is also what toggle-service answers, and closing on that
    // would discard whatever was typed in an open create form.
    return { ok: true, intent: "create-service" as const };
  } else if (intent === "update-service") {
    // The same fields the create form writes, on a service that already exists.
    // `PUT /api/services/:id` has always accepted them; until now nothing sent
    // them, so a service created without a template stayed unbookable forever.
    const submission = parseWithZod(form, { schema: makeUpdateServiceSchema() });
    if (submission.status !== "success") {
      return submission.reply();
    }
    const { id, name, description, price, durationMinutes, templateId } = submission.value;
    const res = await api.services[":id"].$put({
      param: { id },
      json: {
        name,
        // Absent-means-omitted for optionals (sending null fails validation),
        // except that clearing a template must be expressible: an empty string
        // is how the API records "no template" on an existing row.
        description: description ?? "",
        price: Number(price) * 100 || 0,
        ...(durationMinutes ? { durationMinutes: Number(durationMinutes) } : { durationMinutes: 0 }),
        templateId: templateId ?? "",
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return submission.reply({
        formErrors: [(err as Record<string, string>)?.message || m.settings_services_error_update_failed()],
      });
    }
    return { ok: true, intent: "update-service" as const };
  } else if (intent === "toggle-service") {
    const id = String(form.get("id") ?? "");
    const active = form.get("active") === "true";
    await api.services[":id"].$put({
      param: { id },
      json: { active: !active },
    });
  } else if (intent === "qualification-save") {
    const id = String(form.get("serviceId") ?? "");
    let userIds: string[];
    try {
      userIds = JSON.parse(String(form.get("userIds") ?? "[]"));
    } catch {
      return { ok: false, intent: "qualification-save", message: m.settings_services_error_invalid_user_ids() };
    }
    const res = await api.services[":id"].inspectors.$put({
      param: { id },
      json: { userIds },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        ok: false,
        intent: "qualification-save",
        message: (err as Record<string, unknown>)?.message as string | undefined ?? m.settings_services_error_save_restrictions_failed(),
        serviceId: id,
      };
    }
    return { ok: true, intent: "qualification-save", serviceId: id };
  }

  return { ok: true };
}

export default function SettingsServices() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [showForm, setShowForm] = useState(false);
  /** Which row is open for editing — at most one, so its form owns its defaults. */
  const [editingId, setEditingId] = useState<string | null>(null);

  // Saving used to leave the form open with every value still in it, and the
  // new row appeared in the table below — so the panel looked like it had not
  // submitted, and a second Save created a duplicate service. Closing on
  // success unmounts the form, which is also what clears the inputs; the new
  // (or changed) row in the table is the confirmation.
  const created = didSaveService(actionData, "create-service");
  useEffect(() => {
    if (created) setShowForm(false);
  }, [created]);

  const updated = didSaveService(actionData, "update-service");
  useEffect(() => {
    if (updated) setEditingId(null);
  }, [updated]);

  // Conform owns only the create-service form. The toggle-service form posts
  // hidden fields only (no text validation), so it stays a plain <Form>. Guard
  // against feeding a non-Conform actionData ({ ok: true }) into useForm.
  const [form, fields] = useForm({
    lastResult: actionData && "status" in actionData ? actionData : undefined,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeCreateServiceSchema() });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  if ("forbidden" in data) return <AccessDenied />;
  const { services, discounts, restrictionMap, members, templates } = data;
  const editingService = services.find((s) => s.id === editingId) ?? null;

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb items={[{ label: m.settings_crumb_settings(), href: "/settings" }, { label: m.settings_services_crumb() }]} />

      <div className="flex items-center justify-between gap-4">
        <p className="text-[13px] text-ih-fg-3">
          {m.settings_services_intro()}
        </p>
        <button
          onClick={() => setShowForm(!showForm)}
          className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors"
        >
          {m.settings_services_add_button()}
        </button>
      </div>

      {/* Inline add service form */}
      {showForm && (
        <Form
          method="post"
          id={form.id}
          onSubmit={form.onSubmit}
          noValidate
          className="bg-ih-bg-card border border-ih-border rounded-lg p-4 space-y-3"
        >
          <input type="hidden" name="intent" value="create-service" />
          <ServiceFields fields={fields} templates={templates} />
          {form.errors && (
            <div className="px-3 py-2 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg">
              {form.errors[0]}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="h-8 px-3 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors">
              {m.common_cancel()}
            </button>
            <button type="submit" className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors">
              {m.common_save()}
            </button>
          </div>
        </Form>
      )}

      {/* Editing an existing service — mounted for one row at a time, above the
          table, in the same slot as the create form so both saves land in the
          same place on screen. */}
      {editingService && (
        <ServiceEditForm
          service={editingService}
          templates={templates}
          onCancel={() => setEditingId(null)}
        />
      )}

      {/* Services table */}
      <ServicesCatalogPanel
        services={services}
        restrictionMap={restrictionMap}
        members={members}
        templateNames={Object.fromEntries(templates.map((t) => [t.id, t.name]))}
        editingId={editingId}
        onEdit={setEditingId}
      />

      {/* Discount codes */}
      <DiscountCodesPanel discounts={discounts} />
    </div>
  );
}

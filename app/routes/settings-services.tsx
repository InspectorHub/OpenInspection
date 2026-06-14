import { useState, useEffect } from "react";
import { Link, useLoaderData, Form, useActionData, useFetcher } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/settings-services";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { createServiceSchema } from "~/lib/forms/settings.schema";

export function meta() {
  return [{ title: "Services & Catalog - Settings - OpenInspection" }];
}

interface Service {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  active: boolean;
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

// Scheduling roles that may be restricted per-service.
const SCHEDULING_ROLES = new Set(["owner", "manager", "inspector"]);

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const [svcRes, discountRes, membersRes] = await Promise.all([
      api.services.index.$get({}),
      api.services["discount-codes"].$get().catch(() => null),
      api.admin.members.$get().catch(() => null),
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
      members = raw.filter((m) => SCHEDULING_ROLES.has(m.role));
    }

    return {
      services: rawServices,
      discounts: rawDiscounts,
      restrictionMap,
      members,
    };
  } catch {
    return {
      services: [] as Service[],
      discounts: [] as Discount[],
      restrictionMap: {} as Record<string, string[]>,
      members: [] as Member[],
    };
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const form = await request.formData();
  const intent = form.get("intent");
  const api = createApi(context, { token });

  if (intent === "create-service") {
    const submission = parseWithZod(form, { schema: createServiceSchema });
    if (submission.status !== "success") {
      return submission.reply();
    }
    const { name, description, price } = submission.value;
    // TODO(C-10 collapse): hono/client collapses api.services.index.$post to a non-callable
    // union; localized assertion until the typed-hono spike resolves it. Binding preserved.
    const res = await (api.services.index.$post as unknown as (args: { json: Record<string, unknown> }) => Promise<Response>)({
      json: {
        name,
        // CreateServiceSchema.description is .optional() — undefined is the
        // only valid "absent" encoding; sending null fails validation (400).
        ...(description ? { description } : {}),
        price: Number(price) * 100 || 0,
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return submission.reply({
        formErrors: [(err as Record<string, string>)?.message || "Failed to create service."],
      });
    }
    return { ok: true };
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
      return { ok: false, intent: "qualification-save", message: "Invalid user IDs format." };
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
        message: (err as Record<string, unknown>)?.message as string | undefined ?? "Failed to save restrictions.",
        serviceId: id,
      };
    }
    return { ok: true, intent: "qualification-save", serviceId: id };
  }

  return { ok: true };
}

// ----------------------------------------------------------------
// Qualified Inspectors widget (per-service)
// ----------------------------------------------------------------

interface QualificationWidgetProps {
  service: Service;
  initialUserIds: string[];
  members: Member[];
}

function QualificationWidget({ service, initialUserIds, members }: QualificationWidgetProps) {
  const fetcher = useFetcher<typeof action>({ key: `qual-${service.id}` });
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialUserIds));
  const [dirty, setDirty] = useState(false);

  // Re-sync local selection when the loader delivers a fresh restrictionMap
  // (e.g. after a full-page navigation or revalidation).
  useEffect(() => {
    setSelected(new Set(initialUserIds));
    setDirty(false);
  }, [initialUserIds]);

  const saving = fetcher.state !== "idle";
  const lastResult = fetcher.state === "idle" ? fetcher.data : undefined;
  const saved =
    !dirty &&
    lastResult !== undefined &&
    "intent" in lastResult &&
    lastResult.intent === "qualification-save" &&
    (lastResult as { ok: boolean }).ok === true &&
    "serviceId" in lastResult &&
    (lastResult as { serviceId: string }).serviceId === service.id;
  const failed =
    !dirty &&
    lastResult !== undefined &&
    "intent" in lastResult &&
    lastResult.intent === "qualification-save" &&
    (lastResult as { ok: boolean }).ok === false &&
    "serviceId" in lastResult &&
    (lastResult as { serviceId: string }).serviceId === service.id;

  const displayLabel =
    initialUserIds.length === 0
      ? "All inspectors"
      : `${initialUserIds.length} inspector${initialUserIds.length !== 1 ? "s" : ""}`;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setDirty(true);
  }

  function handleSave() {
    setDirty(false);
    fetcher.submit(
      {
        intent: "qualification-save",
        serviceId: service.id,
        userIds: JSON.stringify(Array.from(selected)),
      },
      { method: "post" },
    );
  }

  function handleCancel() {
    setSelected(new Set(initialUserIds));
    setDirty(false);
    setOpen(false);
  }

  // Read-only display when no scheduling members are available (non-admin).
  if (members.length === 0) {
    return (
      <div className="text-[12px] text-ih-fg-3">
        <span className="font-medium">Qualified:</span> {displayLabel}
      </div>
    );
  }

  return (
    <div className="mt-2">
      {!open ? (
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-ih-fg-3">
            <span className="font-medium">Qualified:</span> {displayLabel}
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-[12px] font-semibold text-ih-primary hover:underline"
          >
            Edit
          </button>
          {saved && <span className="text-[12px] text-ih-ok-fg font-bold">Saved.</span>}
        </div>
      ) : (
        <div className="border border-ih-border rounded-md p-3 space-y-2 bg-ih-bg-muted">
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-ih-fg-3 mb-2">
            Qualified inspectors
          </p>
          <p className="text-[12px] text-ih-fg-3 mb-2">
            Leave all unchecked to allow all staff.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-40 overflow-y-auto">
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 cursor-pointer select-none py-1">
                <input
                  type="checkbox"
                  checked={selected.has(m.id)}
                  onChange={() => toggle(m.id)}
                  className="h-4 w-4 rounded border-ih-border text-ih-primary"
                />
                <span className="text-[12px] text-ih-fg-1 truncate">
                  {m.email}
                  <span className="ml-1 text-ih-fg-3 text-[11px]">({m.role})</span>
                </span>
              </label>
            ))}
          </div>
          {failed && (
            <p className="text-[12px] text-ih-bad-fg">
              {(lastResult as { message?: string }).message ?? "Save failed. Please try again."}
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="h-7 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="h-7 px-3 rounded-md border border-ih-border text-[12px] font-medium text-ih-fg-2 hover:bg-ih-bg-card transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsServices() {
  const { services, discounts, restrictionMap, members } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [showForm, setShowForm] = useState(false);

  // Conform owns only the create-service form. The toggle-service form posts
  // hidden fields only (no text validation), so it stays a plain <Form>. Guard
  // against feeding a non-Conform actionData ({ ok: true }) into useForm.
  const [form, fields] = useForm({
    lastResult: actionData && "status" in actionData ? actionData : undefined,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: createServiceSchema });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  return (
    <div className="space-y-[18px]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-ih-fg-3">
        <Link to="/settings" className="hover:text-ih-primary transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-ih-fg-1">Services &amp; catalog</span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[19px] font-bold text-ih-fg-1">Services &amp; catalog</h2>
          <p className="text-[13px] text-ih-fg-3 mt-0.5">
            Define the services you offer and their prices, plus discount codes.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors"
        >
          + Add service
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label htmlFor={fields.name.id} className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1">Name</label>
              <input
                type="text" id={fields.name.id} name={fields.name.name}
                placeholder="e.g., Standard Inspection"
                aria-invalid={fields.name.errors ? true : undefined}
                className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
              />
              {fields.name.errors && (
                <p className="mt-1 text-xs text-ih-bad-fg">{fields.name.errors[0]}</p>
              )}
            </div>
            <div>
              <label htmlFor={fields.description.id} className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1">Description</label>
              <input
                type="text" id={fields.description.id} name={fields.description.name}
                placeholder="Optional details"
                aria-invalid={fields.description.errors ? true : undefined}
                className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
              />
              {fields.description.errors && (
                <p className="mt-1 text-xs text-ih-bad-fg">{fields.description.errors[0]}</p>
              )}
            </div>
            <div>
              <label htmlFor={fields.price.id} className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1">Price ($)</label>
              <input
                type="number" id={fields.price.id} name={fields.price.name} min="0" step="0.01"
                placeholder="450.00"
                aria-invalid={fields.price.errors ? true : undefined}
                className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
              />
              {fields.price.errors && (
                <p className="mt-1 text-xs text-ih-bad-fg">{fields.price.errors[0]}</p>
              )}
            </div>
          </div>
          {form.errors && (
            <div className="px-3 py-2 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg">
              {form.errors[0]}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="h-8 px-3 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors">
              Cancel
            </button>
            <button type="submit" className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors">
              Save
            </button>
          </div>
        </Form>
      )}

      {/* Services table */}
      <div className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-ih-border">
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Name</th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Duration</th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Price</th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Status</th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {services.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-[13px] text-ih-fg-3">
                  No services yet. Click "Add service" to create your first.
                </td>
              </tr>
            ) : (
              services.map((svc) => (
                <tr key={svc.id} className="border-b border-ih-border last:border-b-0 hover:bg-ih-bg-muted transition-colors">
                  <td className="py-3 px-4">
                    <p className="text-[13px] font-medium text-ih-fg-1">{svc.name}</p>
                    {svc.description && (
                      <p className="text-[11px] text-ih-fg-3 mt-0.5 line-clamp-1">{svc.description}</p>
                    )}
                    <QualificationWidget
                      service={svc}
                      initialUserIds={restrictionMap[svc.id] ?? []}
                      members={members}
                    />
                  </td>
                  <td className="py-3 px-4 text-[13px] text-ih-fg-3">&mdash;</td>
                  <td className="py-3 px-4 text-[13px] font-bold text-ih-ok-fg">
                    ${((svc.price || 0) / 100).toFixed(2)}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
 svc.active
 ? "bg-ih-ok-bg text-ih-ok-fg"
 : "bg-ih-bg-muted text-ih-fg-3"
 }`}>
                      {svc.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Form method="post" className="inline">
                      <input type="hidden" name="intent" value="toggle-service" />
                      <input type="hidden" name="id" value={svc.id} />
                      <input type="hidden" name="active" value={String(svc.active)} />
                      <button type="submit" className="text-[12px] font-semibold text-ih-primary hover:underline">
                        {svc.active ? "Deactivate" : "Activate"}
                      </button>
                    </Form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Discount codes */}
      <div className="pt-2">
        <h3 className="text-[15px] font-bold text-ih-fg-1 mb-2">Discount codes</h3>
        <p className="text-[13px] text-ih-fg-3 mb-3">Promo codes clients can apply at booking.</p>

        <div className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
          {discounts.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-ih-fg-3">
              No discount codes yet.
            </div>
          ) : (
            <div className="divide-y divide-ih-border">
              {discounts.map((d) => (
                <div key={d.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-4">
                    <code className="font-mono text-[13px] font-bold text-ih-fg-1">{d.code}</code>
                    <span className="text-[12px] text-ih-fg-3">
                      {d.type === "percent" ? `${d.value}% off` : `$${(d.value / 100).toFixed(2)} off`}
                    </span>
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
 d.active
 ? "bg-ih-ok-bg text-ih-ok-fg"
 : "bg-ih-bg-muted text-ih-fg-3"
 }`}>
                      {d.active ? "Active" : "Disabled"}
                    </span>
                  </div>
                  <button className="text-[12px] font-semibold text-ih-primary hover:underline">
                    Edit
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

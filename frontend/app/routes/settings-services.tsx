import { useState } from "react";
import { Link, useLoaderData, Form } from "react-router";
import type { Route } from "./+types/settings-services";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

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

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/admin/services", { token });
    const json = res.ok ? await res.json() : {};
    const d = json as Record<string, unknown>;
    return {
      services: ((d.data as Record<string, unknown>)?.services || []) as Service[],
      discounts: ((d.data as Record<string, unknown>)?.discounts || []) as Discount[],
    };
  } catch {
    return { services: [] as Service[], discounts: [] as Discount[] };
  }
}

export async function action({ request }: Route.ActionArgs) {
  const token = await requireToken(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "create-service") {
    await apiFetch("/api/admin/services", {
      token,
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        description: form.get("description") || null,
        price: Number(form.get("price")) * 100 || 0,
      }),
    });
  } else if (intent === "toggle-service") {
    const id = form.get("id");
    const active = form.get("active") === "true";
    await apiFetch(`/api/admin/services/${id}`, {
      token,
      method: "PATCH",
      body: JSON.stringify({ active: !active }),
    });
  }

  return { ok: true };
}

export default function SettingsServices() {
  const { services, discounts } = useLoaderData<typeof loader>();
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-[18px]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-slate-500">
        <Link to="/settings" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-slate-900 dark:text-slate-100">Services &amp; catalog</span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[19px] font-bold text-slate-900 dark:text-slate-100">Services &amp; catalog</h2>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
            Define the services you offer and their prices, plus discount codes.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="h-8 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 transition-colors"
        >
          + Add service
        </button>
      </div>

      {/* Inline add service form */}
      {showForm && (
        <Form method="post" className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-3">
          <input type="hidden" name="intent" value="create-service" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 mb-1">Name</label>
              <input
                type="text" name="name" required
                placeholder="e.g., Standard Inspection"
                className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-[13px] text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 mb-1">Description</label>
              <input
                type="text" name="description"
                placeholder="Optional details"
                className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-[13px] text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 mb-1">Price ($)</label>
              <input
                type="number" name="price" min="0" step="0.01"
                placeholder="450.00"
                className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-[13px] text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="h-8 px-3 rounded-md border border-slate-200 dark:border-slate-600 text-[13px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
              Cancel
            </button>
            <button type="submit" className="h-8 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 transition-colors">
              Save
            </button>
          </div>
        </Form>
      )}

      {/* Services table */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Name</th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Duration</th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Price</th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Status</th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {services.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-[13px] text-slate-500 dark:text-slate-400">
                  No services yet. Click "Add service" to create your first.
                </td>
              </tr>
            ) : (
              services.map((svc) => (
                <tr key={svc.id} className="border-b border-slate-100 dark:border-slate-700 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                  <td className="py-3 px-4">
                    <p className="text-[13px] font-medium text-slate-900 dark:text-slate-100">{svc.name}</p>
                    {svc.description && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">{svc.description}</p>
                    )}
                  </td>
                  <td className="py-3 px-4 text-[13px] text-slate-600 dark:text-slate-300">&mdash;</td>
                  <td className="py-3 px-4 text-[13px] font-bold text-emerald-700 dark:text-emerald-400">
                    ${((svc.price || 0) / 100).toFixed(2)}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
                      svc.active
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                        : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                    }`}>
                      {svc.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Form method="post" className="inline">
                      <input type="hidden" name="intent" value="toggle-service" />
                      <input type="hidden" name="id" value={svc.id} />
                      <input type="hidden" name="active" value={String(svc.active)} />
                      <button type="submit" className="text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
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
        <h3 className="text-[15px] font-bold text-slate-900 dark:text-slate-100 mb-2">Discount codes</h3>
        <p className="text-[13px] text-slate-500 dark:text-slate-400 mb-3">Promo codes clients can apply at booking.</p>

        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
          {discounts.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-slate-500 dark:text-slate-400">
              No discount codes yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {discounts.map((d) => (
                <div key={d.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-4">
                    <code className="font-mono text-[13px] font-bold text-slate-900 dark:text-slate-100">{d.code}</code>
                    <span className="text-[12px] text-slate-500 dark:text-slate-400">
                      {d.type === "percent" ? `${d.value}% off` : `$${(d.value / 100).toFixed(2)} off`}
                    </span>
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
                      d.active
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                        : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                    }`}>
                      {d.active ? "Active" : "Disabled"}
                    </span>
                  </div>
                  <button className="text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
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

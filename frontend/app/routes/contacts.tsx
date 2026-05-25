import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/contacts";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Contacts - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/contacts", { token });
    const data = res.ok ? await res.json() : {};
    return { contacts: (data as Record<string, unknown[]>)?.data || [] };
  } catch {
    return { contacts: [] };
  }
}

export default function ContactsPage() {
  const { contacts } = useLoaderData<typeof loader>();
  const contactList = contacts as unknown[];
  const [activeTab, setActiveTab] = useState("contacts");

  return (
    <div className="space-y-[18px]">
      {/* PageHeader */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[0.2em] bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400">
            <span className="w-1 h-1 rounded-full bg-current opacity-60" />
            Contacts
          </span>
          <h1 className="text-[26px] font-bold tracking-tight mt-1">
            Contacts
          </h1>
          <p className="text-[13px] text-slate-500 mt-1">
            {contactList.length} contacts
          </p>
        </div>
        <button className="h-9 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 inline-flex items-center gap-2 transition-colors">
          + Add Contact
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-slate-200 dark:border-slate-700">
        {["contacts", "agents"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3.5 py-2.5 border-b-2 text-[13px] font-bold transition-all capitalize ${
              activeTab === tab
                ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Name
              </th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Email
              </th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Phone
              </th>
              <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Type
              </th>
            </tr>
          </thead>
          <tbody>
            {contactList.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="py-12 text-center text-[13px] text-slate-500"
                >
                  No contacts yet. Add one above to get started.
                </td>
              </tr>
            ) : (
              contactList.map((c: unknown) => {
                const contact = c as Record<string, string>;
                return (
                  <tr
                    key={contact.id}
                    className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30"
                  >
                    <td className="py-3 px-4 text-[13px] font-medium text-slate-900 dark:text-slate-100">
                      {contact.name}
                    </td>
                    <td className="py-3 px-4 text-[13px] text-slate-600 dark:text-slate-400">
                      {contact.email}
                    </td>
                    <td className="py-3 px-4 text-[13px] text-slate-600 dark:text-slate-400">
                      {contact.phone}
                    </td>
                    <td className="py-3 px-4 text-[13px] text-slate-500">
                      {contact.type || "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

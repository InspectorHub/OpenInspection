import type { useFetcher } from "react-router";
import { Link } from "react-router";
import { Card, Pill, EmptyState } from "@core/shared-ui";
import type { Contact } from "./contacts-helpers";

export function ContactsTable({
  filtered,
  setEditContact,
  setModalOpen,
  deleteFetcher,
}: {
  filtered: Contact[];
  setEditContact: (c: Contact | null) => void;
  setModalOpen: (open: boolean) => void;
  deleteFetcher: ReturnType<typeof useFetcher>;
}) {
  return (
    <Card className="overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-ih-border">
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Name</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Type</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Email</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Phone</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Agency</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Inspections</th>
                <th className="py-3 px-4 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7}>
                  <EmptyState title="No contacts yet" description="Add one above to get started." />
                </td></tr>
              ) : (
                filtered.map((c) => (
                  <tr key={c.id} className="border-b border-ih-border hover:bg-ih-bg-muted/50">
                    <td className="py-3 px-4 text-[13px] font-medium">
                      <Link to={`/contacts/${c.id}`} className="text-ih-fg-1 hover:text-ih-primary hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-[13px]">
                      <Pill tone={c.type === "agent" ? "info" : "info"}>{c.type}</Pill>
                    </td>
                    <td className="py-3 px-4 text-[13px] text-ih-fg-3">{c.email || "—"}</td>
                    <td className="py-3 px-4 text-[13px] text-ih-fg-3">{c.phone || "—"}</td>
                    <td className="py-3 px-4 text-[13px] text-ih-fg-3">{c.agency || "—"}</td>
                    <td className="py-3 px-4 text-[13px] text-ih-fg-3">{c.inspectionCount ?? 0}</td>
                    <td className="py-3 px-4 text-right">
                      <button onClick={() => { setEditContact(c); setModalOpen(true); }} className="text-ih-primary text-[12px] font-bold hover:underline mr-3">Edit</button>
                      <deleteFetcher.Form method="post" className="inline">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="id" value={c.id} />
                        <button type="submit" className="text-ih-bad-fg text-[12px] font-bold hover:underline">Delete</button>
                      </deleteFetcher.Form>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
  );
}

import type { useFetcher } from "react-router";
import { Link } from "react-router";
import { Card, Pill, EmptyState, Table } from "@core/shared-ui";
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
      <Table<Contact>
        rows={filtered}
        getRowKey={(c) => c.id}
        empty={<EmptyState title="No contacts yet" description="Add one above to get started." />}
        columns={[
          {
            label: "Name",
            cell: (c) => (
              <Link to={`/contacts/${c.id}`} className="font-medium text-ih-fg-1 hover:text-ih-primary hover:underline">
                {c.name}
              </Link>
            ),
          },
          { label: "Type", cell: (c) => <Pill tone="info">{c.type}</Pill> },
          { label: "Email", cell: (c) => <span className="text-ih-fg-3">{c.email || "—"}</span> },
          { label: "Phone", cell: (c) => <span className="text-ih-fg-3">{c.phone || "—"}</span> },
          { label: "Agency", cell: (c) => <span className="text-ih-fg-3">{c.agency || "—"}</span> },
          { label: "Inspections", cell: (c) => <span className="text-ih-fg-3">{c.inspectionCount ?? 0}</span> },
          {
            label: <span className="sr-only">Actions</span>,
            align: "right",
            cell: (c) => (
              <>
                <button onClick={() => { setEditContact(c); setModalOpen(true); }} className="text-ih-primary text-[12px] font-bold hover:underline mr-3">Edit</button>
                <deleteFetcher.Form method="post" className="inline">
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="id" value={c.id} />
                  <button type="submit" className="text-ih-bad-fg text-[12px] font-bold hover:underline">Delete</button>
                </deleteFetcher.Form>
              </>
            ),
          },
        ]}
      />
    </Card>
  );
}

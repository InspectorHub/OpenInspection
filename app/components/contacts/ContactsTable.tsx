import type { useFetcher } from "react-router";
import { Link } from "react-router";
import { Card, Pill, EmptyState, Table } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
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
        empty={<EmptyState title={m.contacts_table_empty_title()} description={m.contacts_table_empty_desc()} />}
        columns={[
          {
            label: m.contacts_table_col_name(),
            cell: (c) => (
              <Link to={`/contacts/${c.id}`} className="font-medium text-ih-fg-1 hover:text-ih-primary hover:underline">
                {c.name}
              </Link>
            ),
          },
          { label: m.contacts_modal_type_label(), cell: (c) => <Pill tone="info">{c.type}</Pill> },
          { label: m.contacts_field_email(), cell: (c) => <span className="text-ih-fg-3">{c.email || "—"}</span> },
          { label: m.contacts_field_phone(), cell: (c) => <span className="text-ih-fg-3">{c.phone || "—"}</span> },
          { label: m.contacts_field_agency(), cell: (c) => <span className="text-ih-fg-3">{c.agency || "—"}</span> },
          { label: m.contacts_field_inspections(), cell: (c) => <span className="text-ih-fg-3">{c.inspectionCount ?? 0}</span> },
          {
            label: <span className="sr-only">{m.contacts_table_col_actions()}</span>,
            align: "right",
            cell: (c) => (
              <>
                <button onClick={() => { setEditContact(c); setModalOpen(true); }} className="text-ih-primary text-[12px] font-bold hover:underline mr-3">{m.common_edit()}</button>
                <deleteFetcher.Form method="post" className="inline">
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="id" value={c.id} />
                  <button type="submit" className="text-ih-bad-fg text-[12px] font-bold hover:underline">{m.common_delete()}</button>
                </deleteFetcher.Form>
              </>
            ),
          },
        ]}
      />
    </Card>
  );
}

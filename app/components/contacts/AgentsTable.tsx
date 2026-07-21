import { Card, EmptyState, Table } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import type { Contact } from "./contacts-helpers";

export function AgentsTable({
  agentContacts,
  onEdit,
  onArchive,
}: {
  agentContacts: Contact[];
  onEdit: (c: Contact) => void;
  onArchive: (c: Contact) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <Table<Contact>
        rows={agentContacts}
        getRowKey={(a) => a.id}
        empty={<EmptyState title={m.contacts_agents_empty_title()} description={m.contacts_agents_empty_desc()} />}
        columns={[
          { label: m.contacts_table_col_name(), cell: (a) => <span className="font-medium text-ih-fg-1">{a.name}</span> },
          { label: m.contacts_field_agency(), cell: (a) => <span className="text-ih-fg-3">{a.agency || "—"}</span> },
          { label: m.contacts_field_email(), cell: (a) => <span className="text-ih-fg-3">{a.email || "—"}</span> },
          { label: m.contacts_field_phone(), cell: (a) => <span className="text-ih-fg-3">{a.phone || "—"}</span> },
          { label: m.contacts_agents_col_referrals(), cell: (a) => <span className="text-ih-fg-1 font-medium tabular-nums">{a.referralCount ?? 0}</span> },
          {
            label: <span className="sr-only">{m.contacts_table_col_actions()}</span>,
            align: "right",
            cell: (a) => (
              <>
                <button onClick={() => onEdit(a)} className="text-ih-primary text-[12px] font-bold hover:underline mr-3">{m.common_edit()}</button>
                <button onClick={() => onArchive(a)} className="text-ih-fg-3 text-[12px] font-bold hover:text-ih-fg-1 hover:underline">{m.contacts_action_archive()}</button>
              </>
            ),
          },
        ]}
      />
    </Card>
  );
}

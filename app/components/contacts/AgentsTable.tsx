import { Card, Pill, EmptyState, Table } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import type { Agent } from "./contacts-helpers";

export function AgentsTable({ agentList }: { agentList: Agent[] }) {
  return (
    <Card className="overflow-hidden">
      <Table<Agent>
        rows={agentList}
        getRowKey={(a) => a.id}
        empty={<EmptyState title={m.contacts_agents_empty_title()} />}
        columns={[
          { label: m.contacts_type_agent(), cell: (a) => <span className="font-medium text-ih-fg-1">{a.name}</span> },
          { label: m.contacts_agents_col_status(), cell: (a) => <Pill tone={a.status === "active" ? "sat" : "monitor"}>{a.status}</Pill> },
          { label: m.contacts_agents_col_linked(), cell: (a) => <span className="text-ih-fg-3">{a.linkedAt || "—"}</span> },
          {
            label: <span className="sr-only">{m.contacts_table_col_actions()}</span>,
            align: "right",
            cell: () => <button className="text-ih-bad-fg text-[12px] font-bold hover:underline">{m.contacts_agents_revoke()}</button>,
          },
        ]}
      />
    </Card>
  );
}

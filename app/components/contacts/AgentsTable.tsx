import { Card, Pill, EmptyState, Table } from "@core/shared-ui";
import type { Agent } from "./contacts-helpers";

export function AgentsTable({ agentList }: { agentList: Agent[] }) {
  return (
    <Card className="overflow-hidden">
      <Table<Agent>
        rows={agentList}
        getRowKey={(a) => a.id}
        empty={<EmptyState title="No agent partners yet" />}
        columns={[
          { label: "Agent", cell: (a) => <span className="font-medium text-ih-fg-1">{a.name}</span> },
          { label: "Status", cell: (a) => <Pill tone={a.status === "active" ? "sat" : "monitor"}>{a.status}</Pill> },
          { label: "Linked", cell: (a) => <span className="text-ih-fg-3">{a.linkedAt || "—"}</span> },
          {
            label: <span className="sr-only">Actions</span>,
            align: "right",
            cell: () => <button className="text-ih-bad-fg text-[12px] font-bold hover:underline">Revoke</button>,
          },
        ]}
      />
    </Card>
  );
}

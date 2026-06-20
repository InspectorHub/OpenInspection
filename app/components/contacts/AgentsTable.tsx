import { Card, Pill, EmptyState } from "@core/shared-ui";
import type { Agent } from "./contacts-helpers";

export function AgentsTable({ agentList }: { agentList: Agent[] }) {
  return (
    <Card className="overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-ih-border">
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Agent</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Status</th>
                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Linked</th>
                <th className="py-3 px-4 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {agentList.length === 0 ? (
                <tr><td colSpan={4}>
                  <EmptyState title="No agent partners yet" />
                </td></tr>
              ) : (
                agentList.map((a) => (
                  <tr key={a.id} className="border-b border-ih-border hover:bg-ih-bg-muted/50">
                    <td className="py-3 px-4 text-[13px] font-medium text-ih-fg-1">{a.name}</td>
                    <td className="py-3 px-4">
                      <Pill tone={a.status === "active" ? "sat" : "monitor"}>{a.status}</Pill>
                    </td>
                    <td className="py-3 px-4 text-[13px] text-ih-fg-3">{a.linkedAt || "—"}</td>
                    <td className="py-3 px-4 text-right">
                      <button className="text-ih-bad-fg text-[12px] font-bold hover:underline">Revoke</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
  );
}

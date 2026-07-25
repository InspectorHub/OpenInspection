// The agent repair-list policy, re-exported for app-side use (same idiom as
// app/lib/status.ts). The definition stays server-side because that is where it
// is ENFORCED; the portal reads the same functions so it can never offer an
// action the API refuses.

export {
  agentMayReadRepairList,
  agentMayWriteRepairList,
  type AgentRepairAccess,
} from '../../server/lib/people/agent-repair-access';

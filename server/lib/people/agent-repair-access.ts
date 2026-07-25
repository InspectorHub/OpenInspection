/**
 * How much an agent may do with a company's repair list.
 *
 * One definition, read by every side that has to agree: the API that enforces
 * it (resolveBuilderAccess) and the agent portal that decides whether to offer
 * the action at all. When the two disagree, the product shows an agent a button
 * that answers 403 — the failure mode this audit keeps finding.
 */
export type AgentRepairAccess = 'off' | 'read' | 'readwrite';

interface InspectionPrefsLike {
    agentRepairAccess?: AgentRepairAccess | undefined;
}

/**
 * Unset means `readwrite`: agents could always use the repair builder, so a
 * company that never touched the setting keeps what it had.
 */
export function resolveAgentRepairAccess(prefs: InspectionPrefsLike | null | undefined): AgentRepairAccess {
    return prefs?.agentRepairAccess ?? 'readwrite';
}

/** Whether the agent may open the list at all. */
export function agentMayReadRepairList(access: AgentRepairAccess): boolean {
    return access !== 'off';
}

/** Whether the agent may create or change a list (and therefore share one). */
export function agentMayWriteRepairList(access: AgentRepairAccess): boolean {
    return access === 'readwrite';
}

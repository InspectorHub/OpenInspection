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
 * Unset means `read`.
 *
 * It meant `readwrite` until 2026-08-14, on the reasoning that agents could
 * always use the repair builder so a company that never touched the setting
 * kept what it had. That argument covers companies which predate the setting
 * and nobody else: a company created afterwards never had anything to keep,
 * so the value was our choice made on their behalf — and the choice let an
 * external third party WRITE to a homebuyer's defect list at a company that
 * had never been asked.
 *
 * The default is now the narrower one for every company, old and new alike,
 * rather than a date-scoped split. Deliberate: two defaults for one setting
 * means the answer to "what can an agent do here" depends on when the company
 * signed up, which nobody can hold in their head. Agents keep read access;
 * a company that wants them writing turns it on and knows it did.
 */
export function resolveAgentRepairAccess(prefs: InspectionPrefsLike | null | undefined): AgentRepairAccess {
    return prefs?.agentRepairAccess ?? 'read';
}

/** Whether the agent may open the list at all. */
export function agentMayReadRepairList(access: AgentRepairAccess): boolean {
    return access !== 'off';
}

/** Whether the agent may create or change a list (and therefore share one). */
export function agentMayWriteRepairList(access: AgentRepairAccess): boolean {
    return access === 'readwrite';
}

const RANK: Record<AgentRepairAccess, number> = { off: 0, read: 1, readwrite: 2 };

/**
 * The effective repair-list access for one agent on one inspection: the
 * STRICTER of the tenant's policy and the role's own bit. Neither can widen
 * the other — a tenant on `read` is not overridden to `readwrite` by a role,
 * and a role on `read` is read-only even where the tenant allows writing.
 */
export function effectiveRepairAccess(tenant: AgentRepairAccess, role: AgentRepairAccess): AgentRepairAccess {
    return RANK[tenant] <= RANK[role] ? tenant : role;
}

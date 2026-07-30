/**
 * The contact-party axis: what a person IS on an inspection.
 *
 * Distinct from users.role (the staff seat) even though both use the word
 * "agent" — see the two-layer role model design §1.1. Every consumer derives
 * from here so the role-literal guard can stop exempting whole directories on
 * account of this axis.
 */
export const ROLE_KINDS = ['client', 'agent', 'other'] as const;
export type RoleKind = typeof ROLE_KINDS[number];

export const ROLE_KIND = {
    CLIENT: 'client',
    AGENT: 'agent',
    OTHER: 'other',
} as const satisfies Record<string, RoleKind>;

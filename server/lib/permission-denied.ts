/**
 * The 403 a person reads when a permission stops them.
 *
 * A refusal that only names a code ("Requires the 'scheduleOthers' capability") tells
 * the person nothing they can act on. Every refusal built here says three things, in
 * this order: what was being attempted, who the server thinks is asking (the role) and
 * what that role lacks, and the one way to get past it. The same facts travel in
 * `details` for a screen that wants to render them differently.
 *
 * Capability names in the messages are the labels the Team page shows, not the code
 * identifiers, so the person can find the switch the message mentions.
 */
import type { Context } from 'hono';
import type { AppError} from './errors';
import { Errors } from './errors';
import { ROLE, ROLE_LABELS, isRole, type Role } from './auth/roles';
import { pinnedCapabilities, type Capability } from './auth/capabilities';
import type { HonoConfig } from '../types/hono';

/** Mirrors the labels in the Team page's permission list (messages/en/labels.json). A new capability is a compile error here. */
const CAPABILITY_LABELS: Record<Capability, string> = {
    publish: 'Publish reports',
    scheduleOthers: 'Schedule for others',
    inspectionFees: 'Inspection fees',
    companyFinance: 'Company finances',
    manageContacts: 'Manage contacts',
    viewCommunication: 'View sent messages & notices',
    templateCreate: 'Create templates',
    templateEdit: 'Edit templates',
    templateDelete: 'Delete templates',
    templateImport: 'Import templates',
    deleteInspection: 'Delete inspections',
    editReports: 'Edit report content',
    viewAllInspections: 'See all inspections',
};

export const capabilityLabel = (cap: Capability): string => CAPABILITY_LABELS[cap];

/** How a role is introduced in a sentence; a caller with no recognised role is described as such. */
const WHO_IS: Record<Role, string> = {
    owner: 'an Owner',
    manager: 'a Manager',
    inspector: 'an Inspector',
    staff: 'an office staff member',
    agent: 'an Agent',
};

function whoIs(role: unknown): string {
    return typeof role === 'string' && isRole(role) ? WHO_IS[role] : 'a user with no recognised role';
}

/** The caller, as a request context or, where only the role is at hand, a role string. */
type Viewer = Context<HonoConfig> | string | null | undefined;

function roleOf(viewer: Viewer): string | undefined {
    if (typeof viewer === 'string') return viewer;
    return viewer ? (viewer.get('userRole') as string | undefined) : undefined;
}

const joinOr = (items: string[]) =>
    items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;

const sentence = (text: string | undefined) => {
    const t = (text ?? '').trim();
    return t === '' ? '' : `${t.replace(/[.!?]*$/, '')}. `;
};

/**
 * 403 for a missing permission. `what` is the sentence naming what was attempted
 * ("You cannot act on an inspection you are not on."); leave it out and the message
 * starts at who is asking.
 */
export function deniedNeedsPermission(c: Context<HonoConfig>, cap: Capability, what?: string): AppError {
    const role = c.get('userRole') as string | undefined;
    const label = CAPABILITY_LABELS[cap];
    const fixedForRole = typeof role === 'string' && isRole(role) && pinnedCapabilities(role as Role).includes(cap);
    // A manager cannot change their own permissions, so for them the only person who can is an owner.
    const grantor = role === ROLE.MANAGER ? 'an owner' : 'an owner or manager';
    // An agent account is a separate kind of login; no switch or Team-page role change gives it company permissions.
    const fix = role === ROLE.AGENT
        ? 'Agent accounts can only use the agent portal.'
        : fixedForRole
        ? `That permission cannot be given to ${ROLE_LABELS[role as Role]} accounts. To do this, ask an owner to change your role to Inspector or Manager on the Team page.`
        : `Ask ${grantor} to turn on "${label}" for you on the Team page.`;
    return Errors.Forbidden(
        `${sentence(what)}You are signed in as ${whoIs(role)}, which does not have the "${label}" permission. ${fix}`,
        { role: role ?? null, requiredCapability: cap, fix: role === ROLE.AGENT ? 'none' : fixedForRole ? 'change_role' : 'grant_permission' },
    );
}

/** 403 for a role that is not on the list of roles allowed to do this. */
export function deniedNeedsRole(viewer: Viewer, roles: readonly Role[], what?: string): AppError {
    const role = roleOf(viewer);
    const names = joinOr(roles.map((r) => ROLE_LABELS[r]));
    const ownerOnly = roles.length === 1 && roles[0] === ROLE.OWNER;
    const agentOnly = roles.length === 1 && roles[0] === ROLE.AGENT;
    // An agent area cannot be reached by changing a team role: agents are separate accounts.
    const fix = agentOnly
        ? 'This area is for agent accounts. Sign out and sign in with an agent account.'
        : role === ROLE.AGENT
        ? 'Agent accounts can only use the agent portal.'
        : `Ask ${ownerOnly ? 'an owner' : 'an owner or manager'} to do this, or to change your role on the Team page.`;
    return Errors.Forbidden(
        `${sentence(what)}This needs the ${names} role, and you are signed in as ${whoIs(role)}. ${fix}`,
        { role: role ?? null, requiredRoles: [...roles] },
    );
}

/** The `details.rule` of every `deniedByRule` refusal: a stable value to match on; the sentence is in `message`. */
export const DENIED_BY_RULE = 'denied_by_rule';

/**
 * 403 for a rule about the state of the thing rather than a missing permission or role: "office staff cannot
 * cancel a job that has started". `who` names the people who can still do it ("An owner or manager").
 */
export function deniedByRule(viewer: Viewer, what: string, who: string): AppError {
    const role = roleOf(viewer);
    return Errors.Forbidden(
        `${sentence(what)}You are signed in as ${whoIs(role)}. ${who} can do this.`,
        { role: role ?? null, rule: DENIED_BY_RULE },
    );
}

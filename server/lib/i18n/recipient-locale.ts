/**
 * Reading a RECIPIENT's locale out of the database.
 *
 * `contact-locale.ts` owns the PRECEDENCE and is deliberately pure — it is in
 * the browser bundle. This module is the database half: it fetches the inputs
 * that precedence needs and hands them over. Keeping the two apart is what lets
 * the booking form and the cron sweeper agree on what a person's language is
 * without the form pulling D1 into the client bundle.
 *
 * WHY THIS EXISTS AT ALL: a notification is rendered FOR someone, and a trigger
 * fires from another user's request, from cron, or from a queue consumer, where
 * there is no request and `getLocale()` answers `baseLocale`. Every ambient read
 * on a recipient-facing string is therefore wrong in exactly the cases nobody
 * tests. Rendering takes the locale from here, explicitly, or it is a bug.
 *
 * FAIL-SOFT throughout: every lookup that throws degrades one rung down the
 * chain and the resolver still answers. A locale lookup must never be the reason
 * a notification did not go out.
 */
import { eq, and } from 'drizzle-orm';
import { contacts, users, tenantConfigs } from '../db/schema';
import { resolveContactLocale, type ContactLocale } from './contact-locale';

/**
 * Who is being written to. Automation recipients are a XOR: `contacts.id` for
 * clients/agents, `users.id` for staff and the assigned inspector (the trigger
 * path carries the user id in the same field — `isStaffRecipient(roleKey)` is
 * what says which). Passing the wrong `kind` reads the wrong table and quietly
 * lands on the tenant default, so the caller must decide it from the role key,
 * not from the shape of the id.
 */
interface RecipientRef {
    kind: 'user' | 'contact';
    id: string;
}

/** Resolves a recipient to the language to address them in. */
export type RecipientLocaleResolver = (ref: RecipientRef | null) => Promise<ContactLocale>;

// The two drivers (async D1, synchronous better-sqlite3) share this builder
// surface; the automation path already types its db handles this way.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/**
 * A resolver bound to one tenant, memoized for the life of one trigger firing
 * or one flush batch. The memo matters: a rule fanning out to eight staff would
 * otherwise re-read the same tenant config eight times, and the whole point of
 * doing this per-recipient is that it is cheap enough to.
 */
export function createRecipientLocaleResolver(db: AnyDb, tenantId: string): RecipientLocaleResolver {
    const perRecipient = new Map<string, Promise<ContactLocale>>();
    let tenantDefault: Promise<string | null> | undefined;

    const loadTenantDefault = (): Promise<string | null> => {
        tenantDefault ??= (async () => {
            try {
                const cfg = await db.select({ defaultLocale: tenantConfigs.defaultLocale })
                    .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
                return (cfg?.defaultLocale as string | null) ?? null;
            } catch { return null; }
        })();
        return tenantDefault;
    };

    const load = async (ref: RecipientRef): Promise<ContactLocale> => {
        const fallbackDefault = await loadTenantDefault();
        if (ref.kind === 'user') {
            let locale: string | null = null;
            try {
                const row = await db.select({ locale: users.locale }).from(users)
                    .where(and(eq(users.id, ref.id), eq(users.tenantId, tenantId))).get();
                locale = (row?.locale as string | null) ?? null;
            } catch { /* leave null: fall through to the tenant default */ }
            // A staff member's own UI locale IS a stated preference, so it goes
            // in the top slot rather than the `linkedUserLocale` one.
            return resolveContactLocale({ contactLocale: locale, tenantDefault: fallbackDefault });
        }
        let contactLocale: string | null = null;
        let linkedUserLocale: string | null = null;
        try {
            // One query, left-joined: a contact bound to an account
            // (`contacts.agent_user_id`) has made an explicit language choice
            // too, just in a different place. Scoped to the tenant on BOTH
            // sides — a resolver is a read path like any other.
            const row = await db.select({ locale: contacts.locale, linked: users.locale })
                .from(contacts)
                .leftJoin(users, and(eq(users.id, contacts.agentUserId), eq(users.tenantId, tenantId)))
                .where(and(eq(contacts.id, ref.id), eq(contacts.tenantId, tenantId))).get();
            contactLocale = (row?.locale as string | null) ?? null;
            linkedUserLocale = (row?.linked as string | null) ?? null;
        } catch { /* both stay null; the tenant default carries it */ }
        // NULL is an ABSENCE, never English — `resolveContactLocale` owns that
        // distinction and this function must not pre-empt it. The booking form
        // deliberately does not ask for a language on the agent-on-behalf
        // branch, so a null here is the common case, not an anomaly.
        return resolveContactLocale({ contactLocale, linkedUserLocale, tenantDefault: fallbackDefault });
    };

    return async (ref) => {
        if (!ref?.id) {
            // Nothing identifies this recipient. Answer with the tenant's own
            // language rather than refusing: the alternative is not sending.
            return resolveContactLocale({ tenantDefault: await loadTenantDefault() });
        }
        const key = `${ref.kind}:${ref.id}`;
        let p = perRecipient.get(key);
        if (!p) { p = load(ref); perRecipient.set(key, p); }
        return p;
    };
}

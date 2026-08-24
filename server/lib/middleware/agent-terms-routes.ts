/**
 * One row per agent-reachable endpoint, each answering the same question.
 *
 * The question is stated once, in the doc comment of `agent-terms-gate.ts`, and
 * it is the rule the exemption list is a consequence of:
 *
 *   does using this require the agent to be bound by the Agent Terms?
 *
 * `EXEMPT_PATHS` used to be the primary artifact — a short hand-kept Set, and
 * the only place a decision about a route was recorded. That has one failure
 * mode and the mechanism exists to prevent exactly it: the route that nobody
 * added. A hand-kept list cannot distinguish "we decided this one is gated"
 * from "nobody has looked at this one", because both are spelled as absence.
 *
 * So the list is now DERIVED from this table, and the table has to be complete.
 * `scripts/check-agent-terms-classification.mjs` reads the routers the
 * application mounts, requires an entry here for every path it finds, and fails
 * the commit when one is missing. Adding a route without answering the question
 * is a build failure rather than a default.
 *
 * ── How to add an entry ─────────────────────────────────────────────────────
 * `path` is the path AS MOUNTED — the mount prefix from `server/index.ts` plus
 * the path the route declares. Read both; do not copy one out of prose. The
 * match in the gate is `EXEMPT_PATHS.has(c.req.path)`, exact and never a
 * prefix, so a path that is off by one letter compiles, reviews clean, and
 * exempts nothing at all. That has happened here, with the singular spelling of
 * a plural mount, and it is why two entries below carry a warning of their own.
 *
 * For the same reason an exemption may not be written as a route PATTERN. The
 * gate compares against a concrete request path, so `/api/agent/notices/:id`
 * can never match one. Patterned paths are fine on a `requiresBinding: true`
 * row — nothing is derived from those — and are refused on a false one, by the
 * gate script and by `tests/unit/legal/agent-terms-classification.spec.ts`.
 *
 * `why` is prose and is required. It is the part a reader six months from now
 * needs, and the part a code cannot carry: a reason can be argued with, and a
 * classification that cannot be argued with cannot be corrected either.
 */

/** One route, and the answer to the question above. */
export interface AgentRouteBinding {
    /** The mounted path, exactly as a request presents it. */
    readonly path: string;
    /**
     * `true` — reaching this is using the product, and the gate applies.
     * `false` — this path is exempt, and `EXEMPT_PATHS` is derived from it.
     */
    readonly requiresBinding: boolean;
    /** Why, in words. Never a code, never blank. */
    readonly why: string;
}

export const AGENT_ROUTE_BINDING: ReadonlyArray<AgentRouteBinding> = [
    // ── The way in, and the way back out ────────────────────────────────────
    {
        path: '/api/agent/accept-terms',
        requiresBinding: false,
        why: 'Records the acceptance. A gate that sits in front of the endpoint '
            + 'which opens it is not a gate, it is a lockout.',
    },
    {
        path: '/api/agent-signup/terms',
        requiresBinding: false,
        why: 'The text itself. The signup page reads it with no session at all, '
            + 'so it is already public — listed anyway, because a session-bearing '
            + 'read of the document you are being asked to accept must never '
            + 'depend on that happening to be true.',
    },
    {
        path: '/api/agent-signup',
        requiresBinding: false,
        why: 'Signup records an acceptance as part of creating the account. An '
            + 'agent who is already signed in does not come through here, but a '
            + 'second tab might.',
    },
    {
        path: '/api/identities/account/delete',
        requiresBinding: false,
        // ⚠️ This string is the MOUNT plus the route path — `server/index.ts`
        // mounts identityRoutes at `/api/identities` (plural). Two comments in
        // the tree named this endpoint differently (`server/api/identity.ts`
        // header said `/api/identity/…`, `server/lib/db/schema/tenant/user.ts`
        // said `/api/account/…`); both were wrong, and both were corrected for
        // THIS endpoint when it was added. The sweep stopped at the delete line
        // — the export line beside it in `identity.ts` stayed singular until the
        // entry below was written. Because the matching is exact, either of
        // those spellings would have compiled, passed review, and exempted
        // nothing.
        why: 'Account exit. A gate whose only exits are "agree" and "keep an '
            + 'account you no longer want" is the coercion this whole mechanism '
            + 'exists to avoid, so leaving is exempt even though it is an '
            + 'authenticated write.',
    },
    {
        path: '/api/identities/account/export',
        requiresBinding: false,
        // ⚠️ Same mount trap as the entry above, and it had NOT been swept for
        // this one: `server/index.ts` mounts identityRoutes at `/api/identities`
        // (plural) and `server/api/identity.ts` declares the route as
        // `/account/export`, so the string is `/api/identities/account/export`.
        // That file's own header said `POST /api/identity/account/export`
        // (singular) until this entry was added, and it was corrected then — the
        // singular spelling compiles, reviews clean, and exempts nothing at all.
        why: 'A data export is an access request: the agent is asking for their '
            + 'own data, and answering "not until you accept these terms" would '
            + 'price a privacy-rights mechanism at a signature. NOT covered by '
            + 'the deletion entry above — the two are different acts, this one is '
            + 'not an exit, and an exact-match Set gives no family discounts.',
    },

    // ── The doors a session is minted at ────────────────────────────────────
    // All four are normally reached with no session, so the gate returns on its
    // first line and never sees them. They are classified for the case that is
    // left: a request that arrives carrying an agent cookie. Refusing that is
    // harmless — the caller already holds the session they are asking for — and
    // it keeps the default in the safe direction.
    {
        path: '/api/agent/login',
        requiresBinding: true,
        why: 'The password door. Reached without a session in every normal flow; '
            + 'a session-bearing call is a re-login by somebody already signed in.',
    },
    {
        path: '/api/agent/login-link',
        requiresBinding: true,
        why: 'Asks for a sign-in link by email. Same shape as the password door '
            + 'beside it: unauthenticated in every normal flow.',
    },
    {
        path: '/api/agent/magic-login/request',
        requiresBinding: true,
        why: 'Emails a single-use sign-in link to the account inbox behind a '
            + 'report-link token. Unauthenticated by design, so the gate does not '
            + 'reach it; an agent who already holds a session does not need it.',
    },
    {
        path: '/api/agent/report-context',
        requiresBinding: true,
        why: 'An unauthenticated probe that resolves a report token to a role '
            + 'kind for the landing page. It answers about a TOKEN, not about the '
            + 'caller, and it is reached before any session exists.',
    },

    // ── Reading and doing the work the account is for ───────────────────────
    // The straightforward half of the question. Each of these is the product:
    // an agent uses it because they hold an agent account, which is the case the
    // gate is written for.
    {
        path: '/api/agent/my-reports',
        requiresBinding: true,
        why: 'Lists the reports on the inspections this agent referred. Ordinary '
            + 'use of the account, and the reason the account exists.',
    },
    {
        path: '/api/agent/my-repair-items',
        requiresBinding: true,
        why: 'Defects from the agent\'s delivered inspections, grouped for the '
            + 'repair view. Ordinary use of the account.',
    },
    {
        path: '/api/agent/referrals',
        requiresBinding: true,
        why: 'The agent-portal dashboard list of referred inspections. Ordinary '
            + 'use of the account.',
    },
    {
        path: '/api/agent/inspectors',
        requiresBinding: true,
        why: 'Lists the inspecting teams this agent is linked with, for building '
            + 'shareable booking links. Ordinary use of the account.',
    },
    {
        path: '/api/agent/leaderboard',
        requiresBinding: true,
        why: 'A ranking across the agents a company works with. Ordinary use of '
            + 'the account.',
    },
    {
        path: '/api/agent/inspections/:id/photo',
        requiresBinding: true,
        why: 'Streams a defect photo to an agent associated with the inspection. '
            + 'Ordinary use of the account. Carries a route parameter, which is '
            + 'allowed here and would not be on an exempt row.',
    },
    {
        path: '/api/agent/concierge-book',
        requiresBinding: true,
        why: 'Books an inspection on a client\'s behalf. This is the clearest '
            + 'case in the table: acting through the product for somebody else is '
            + 'squarely what being bound by the terms is for.',
    },
    {
        path: '/api/agent/profile',
        requiresBinding: true,
        why: 'Reads and updates the agent\'s public profile and booking slug. It '
            + 'shapes what the product publishes on their behalf, which is use of '
            + 'the product rather than access to a record about them.',
    },

    // ── The notices inbox ───────────────────────────────────────────────────
    {
        path: '/api/agent/notices',
        requiresBinding: true,
        why: 'The inbox a company\'s notices to this agent land in. Reading it is '
            + 'ordinary use of the account.',
    },
    {
        path: '/api/agent/notices/mark-read',
        requiresBinding: true,
        why: 'Marks notices read. Housekeeping inside the inbox above, and it '
            + 'shares its answer.',
    },
    {
        path: '/api/agent/notices/:id',
        requiresBinding: true,
        why: 'Archives one notice for this agent — never a row deletion, so it is '
            + 'not an erasure request wearing a DELETE verb. Housekeeping inside '
            + 'the inbox.',
    },
    {
        path: '/api/agent/notices/:id/optin-link',
        requiresBinding: true,
        why: 'Mints the opt-in page URL for a notice\'s contact. It hands out a '
            + 'link the agent then sends to somebody else, which is use of the '
            + 'product on another person\'s behalf.',
    },

    // ── Reading the record of what you signed ───────────────────────────────
    {
        path: '/api/agent/terms/history',
        requiresBinding: false,
        why: 'Returns the agent their own acceptance record — every version they '
            + 'accepted, when, and the text that was shown at the time. It takes '
            + 'no account identifier, because the only account it can answer for '
            + 'is the one holding the session. That is a record ABOUT the reader, '
            + 'and specifically the record that says whether they are bound at '
            + 'all; refusing it until they accept is a loop, and it lands hardest '
            + 'on the agent who believes they already signed and wants to check. '
            + 'It belongs beside the export entry above rather than beside the '
            + 'product surface. The handler checks the session itself and refuses '
            + 'an anonymous caller, so this is an exemption from the gate and not '
            + 'from authentication.',
    },

    // ── Rows that are open questions, not settled answers ───────────────────
    // Recorded here as gated because that is what the code does today, and a
    // table that disagreed with the running system would be worse than no table.
    // Not written as conclusions.
    //
    // ⚠️ The four preference paths below are gated, and the argument for that
    // rests on a MEASURED fact about the mail rather than on a view about
    // preferences. Every suppressible message sent to an agent carries its own
    // unsubscribe link (`lib/notifications/unsubscribe-footer.ts`); the page it
    // lands on is mounted under `/api/public` and is structurally outside this
    // gate; and the write it performs covers every subject the address stands
    // for, which is at least as much as the in-product switch writes. A blocked
    // agent can therefore already stop the mail — what they cannot do is manage
    // it from inside the product.
    //
    // Three conditions carry that, and if any stops holding the reasoning goes
    // with it: the link is minted only where the send has a resolved tenant, a
    // signing secret and a configured public base URL. A deployment with no
    // base URL sends the message with no footer at all, and then there is no way
    // out other than accepting.
    {
        path: '/api/agent/notification-preferences',
        requiresBinding: true,
        why: 'One path, two methods, and the table is keyed on the path: the GET '
            + 'reads what each company sends this agent, the PUT changes one '
            + 'switch. The PUT is not a withdrawal endpoint — it takes `enabled` '
            + 'as a boolean, so the same call that switches a message off '
            + 'switches it on. The GET is gated with it rather than on its own '
            + 'because it is the loader for one screen whose every control is one '
            + 'of these writes, and a read that renders a page of buttons that '
            + 'all refuse is a worse answer than the one the page gives today.',
    },
    {
        path: '/api/agent/notification-preferences/bulk',
        requiresBinding: true,
        why: 'Applies one action to a whole row, column or grid. Not a withdrawal '
            + 'endpoint: the action is enable, disable or reset, so the same path '
            + 'that switches messages off switches them on. Gated for that reason '
            + 'and not for a view about what a preference is.',
    },
    {
        path: '/api/agent/notification-preferences/sms-consent',
        requiresBinding: true,
        why: 'Turns text messages back ON at one company. Listed apart from the '
            + 'rows above even though the URL makes it look like a sibling: '
            + 'GRANTING consent is not the same act as withdrawing it, and an '
            + 'exemption here would produce a consent record made by somebody who '
            + 'was being told to sign something at the time. If these ever '
            + 'diverge, this is the one that stays.',
    },
];

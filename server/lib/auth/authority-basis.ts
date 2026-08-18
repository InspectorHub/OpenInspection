/**
 * review A5 — on what basis does an acceptance bind anyone?
 *
 * The binary a row has to answer is: *can this person bind this company?* Not
 * "what is their role" — role is a different axis, and conflating the two is the
 * defect this vocabulary closes.
 *
 * ── ONE VOCABULARY ACROSS THE SEAM ──────────────────────────────────────────
 * These values are byte-identical to `AUTHORITY_BASES` in the portal
 * (`server/lib/auth/authority-basis.ts` there). The portal's copy already said
 * so — "these are also the values the engine's `account_acceptances.authority_basis`
 * declares" — while this file did not exist, so the claim was true about an
 * intention rather than about code. It is true about code now.
 *
 * The list is duplicated rather than shared because the two repositories do not
 * import from each other: the engine is open source and deployable by anyone,
 * and a runtime dependency on a private SaaS package would make that false. The
 * cost of duplication is that they can drift, which is why the acceptance block
 * arriving over the seam is validated against THIS enum on the way in — a
 * projection naming a basis this side cannot hold is refused at the boundary
 * rather than stored and discovered later.
 */
export const AUTHORITY_BASES = [
    /** Created the company. Binds it. */
    'owner',
    /**
     * An administrator the company has authorised to bind it. NOT derivable
     * from a membership role — a role is an operational projection and says
     * nothing about signing authority — so nothing writes this yet. It is
     * declared because an authorisation record, when one exists, must have
     * somewhere true to go rather than being squeezed into 'owner'.
     */
    'authorised_admin',
    /**
     * Someone presenting explicit written authority to act for the company
     * (power of attorney, signed delegation). Recorded, never inferred.
     */
    'explicit_representative',
    /**
     * THEY HAVE READ IT. IT DOES NOT BIND THE COMPANY. This is what an invited
     * member's acceptance is, and writing it down is the point: without it their
     * row is indistinguishable from an owner's.
     */
    'individual_acknowledgement',
] as const;

export type AuthorityBasis = (typeof AUTHORITY_BASES)[number];

/**
 * How a person arrived at the acceptance. This — not their role, and not their
 * position in the users table — is what determines the basis.
 */
export interface AuthorityContext {
    /**
     * The door they came through.
     *
     * `setup` is the standalone `/setup` wizard, where the person is bringing the
     * workspace into existence. `invite` is `joinTeam`. `portal_command` is an
     * account created by a portal-originated `cmd.tenant.update`, where the
     * acceptance was captured in the portal and travels with the command — so
     * the basis is the one the PORTAL determined and this side records it rather
     * than deriving a second opinion.
     */
    path: 'setup' | 'invite' | 'portal_command';
    /** Only for `portal_command`: the basis the portal captured. */
    declared?: AuthorityBasis | undefined;
}

/**
 * Derive the authority basis at ACCEPTANCE TIME, to be stamped on the row.
 *
 * Takes a door, not a database. It cannot look at the users table, and that is
 * deliberate: review ruled that inferring authority — "they were the first user,
 * so they must be the owner" — must stop being treated as a legal fact. The
 * function's only input is how the person arrived.
 */
export function deriveAuthorityBasis(ctx: AuthorityContext): AuthorityBasis {
    switch (ctx.path) {
        case 'setup':
            // They brought the workspace into existence in this same request.
            return 'owner';
        case 'invite':
            // An invited member acknowledges. An invited ADMIN also only
            // acknowledges: being handed operational access is not being handed
            // the authority to sign for the company.
            return 'individual_acknowledgement';
        case 'portal_command':
            // The portal captured the acceptance and determined the basis at the
            // door the person actually used. Re-deriving here would be a second
            // writer for a fact the other side owns, and the two would disagree
            // the first time either door changed.
            if (!ctx.declared) {
                throw new Error(
                    'portal_command acceptance carries no declared authority basis — '
                    + 'refusing to substitute one, because a basis this side invented '
                    + 'would assert an authority nobody checked',
                );
            }
            return ctx.declared;
    }
}

/**
 * Which single credential answers a surface that has room for exactly one.
 *
 * These are pure rules over a resolved list, and they live HERE rather than in
 * `CredentialService` because the report renderer needs them and importing the
 * service would pull drizzle and the D1 schema into the client bundle for the
 * sake of two `.find()` calls.
 *
 * Both rules read the same way — FIRST MATCH IN THE INSPECTOR'S OWN ORDER —
 * which is the point. The inspector orders their credentials once, in Licenses
 * & affiliations, and that single act decides both the licence line and the
 * badge beside the signature. No second "primary" flag to drift out of sync
 * with the list it describes.
 */

/** The shape both rules read. Structural, so callers need not import the DTO. */
export interface PrimaryCandidate {
  memberNumber: string | null;
  imageUrl: string | null;
}

/**
 * The LICENCE among a set of credentials, or null.
 *
 * "First entry carrying a member number" works because the backfill seeds the
 * state licence at `sort_order = -1`; that sort order was chosen for this.
 */
export function primaryLicenseOf(credentials: PrimaryCandidate[]): string | null {
  return credentials.find((c) => (c.memberNumber ?? '').trim())?.memberNumber?.trim() || null;
}

/**
 * The ONE badge that stands beside the signature, or null.
 *
 * The report cover shows every badge; the signature block has room for one, and
 * which one it got used to be decided by an inline `.find()` in JSX — so the
 * answer was "whichever row happened to sort first", with no way for the
 * inspector to say which they meant. The rule itself was never wrong; being
 * unnamed and unreachable was, because a rule you cannot state is a rule you
 * cannot deliberately satisfy.
 */
export function primaryBadgeOf(credentials: PrimaryCandidate[]): string | null {
  return credentials.find((c) => c.imageUrl)?.imageUrl ?? null;
}

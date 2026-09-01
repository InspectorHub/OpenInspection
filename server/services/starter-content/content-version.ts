/**
 * Which release of the bundled starter content a workspace has been given.
 *
 * ── Why a constant and not the build commit ─────────────────────────────────
 * `BUILD.commit` changes on every deploy, so using it here would re-sweep every
 * workspace on a deploy that changed no content at all. The sweep is idempotent
 * and would insert nothing, but it would still spend one Worker invocation per
 * workspace to discover that — and the Workers Free ceiling punishes a Worker
 * that runs over CONSISTENTLY far more than one that runs over once, so a
 * pointless recurring sweep is not free even when it writes nothing.
 *
 * The same reasoning produced `RENDER_VERSION` in `server/lib/pdf.ts`, and this
 * is deliberately the same shape so the two read as one idiom.
 *
 * ── When to bump it ─────────────────────────────────────────────────────────
 * Whenever the bundled content changes: a new canned comment, a new seed
 * template, another default role profile, a marketplace pack whose semver
 * moved. Bumping it is what makes existing workspaces receive the addition;
 * NOT bumping it means only workspaces created after this release get it, which
 * is the exact failure this whole mechanism exists to remove.
 *
 * You are not expected to remember. `npm run lint:content-version` hashes every
 * file the seeder ships and fails when that hash moved and this string did not
 * — the repository's own rule that a "keep these in sync" comment should be
 * executable rather than prose (CLAUDE.md, Comment Rules).
 *
 * ── Format ──────────────────────────────────────────────────────────────────
 * `c<n>`, monotonic, no meaning beyond inequality. It is compared with `!==`
 * and never parsed or ordered: a workspace stamped with an unknown value is
 * simply swept again, which is safe.
 *
 * c1 — first version. Everything created before this constant existed is
 *      unstamped (`tenants.content_version IS NULL`), so the first sweep after
 *      this release reaches every workspace that predates it. That is intended
 *      rather than incidental: a seeder that joins the starter content later
 *      than a workspace was created has never run for that workspace, and
 *      `contact_role_profiles` is the example that made this visible — a People
 *      section with no role to assign, on a deployment where nothing had
 *      failed.
 */
export const STARTER_CONTENT_VERSION = 'c1';

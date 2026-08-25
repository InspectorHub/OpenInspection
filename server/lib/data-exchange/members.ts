/**
 * The tenant-member view of the `users` table as a file.
 *
 * Two things about this manifest are worth stating once.
 *
 * FIRST: `users` carries credentials, and the members export never sees them —
 * BY CONSTRUCTION, not by a filter. `password_hash`, `totp_secret` and
 * `totp_recovery_codes` are simply not among the fields below, and the
 * projection reads the fields. That is a stronger guarantee than the one
 * `server/lib/compliance/account-export-manifest.ts` had to build: that export
 * star-selects, so it needs EVERY column classified to be safe. This one names
 * what it takes. The three credential columns still appear in `notExported`
 * below, and their reasons cross-reference that file rather than re-arguing it.
 *
 * SECOND: a members round trip is a RE-INVITATION, not a restoration. `id` is
 * `exportOnly`, so an import creates rows and the existing seat and conflict
 * machinery decides what happens to somebody who is already a member.
 *
 * ⚠️ A reason here is prose, and prose is not evidence. Before relying on one,
 * go read what writes the column.
 */
import type { ExchangeVocabulary } from './types';

/** The one reason the three credential columns share; see the file header. */
const CREDENTIAL_REASON =
    'an authentication credential, classified `withhold` with its full argument in '
    + 'server/lib/compliance/account-export-manifest.ts. Not restated here: this export '
    + 'never selects it, so its absence is structural rather than a rule to be kept';

export const MEMBER_EXCHANGE: ExchangeVocabulary = {
    entity: 'member',
    intent: 'members.invite',
    table: 'users',
    fields: [
        {
            field: 'id', column: 'id', header: 'id', aliases: [],
            disposition: 'exportOnly', serialize: 'text',
            reason: 'a key this deployment minted. Exported so a support conversation and a second export of the same team name the same person. Never importable: an invitation creates an account, and an account that accepted a foreign identifier as its own would be a different person wearing this deployment\'s key',
        },
        {
            field: 'email', column: 'email', header: 'email',
            aliases: ['email', 'e-mail', 'email address'],
            disposition: 'roundTrip', serialize: 'text',
            reason: 'where the invitation goes, and what per-tenant uniqueness is on. Required by the bundle format for exactly that reason',
        },
        {
            field: 'name', column: 'name', header: 'name',
            aliases: ['name', 'full name', 'fullname', 'contact', 'contact name'],
            disposition: 'roundTrip', serialize: 'text',
            reason: 'the member\'s display name. Nullable on the row — an invited account has no name until its owner sets one',
        },
        {
            field: 'role', column: 'role', header: 'role',
            aliases: ['role', 'permission', 'access'],
            disposition: 'roundTrip', serialize: 'text',
            reason: 'what the account is permitted to do. Read from a column when the file names one and answered by the entry point when it does not — the same two lines the contacts arm runs for `type`',
        },
        {
            field: 'createdAt', column: 'created_at', header: 'created_at', aliases: [],
            disposition: 'exportOnly', serialize: 'isoTimestamp',
            reason: 'when the account was created. Exported because it is the file\'s only ordering signal. Never importable: an invitation stamps its own creation time, and a file-supplied one would claim an account existed before the run that made it',
        },
    ],
    notExported: [
        {
            column: 'tenant_id',
            reason: 'the export IS one tenant\'s team; a tenant id in the file is a value an import must never be allowed to honour',
        },
        { column: 'password_hash', reason: CREDENTIAL_REASON },
        { column: 'totp_secret', reason: CREDENTIAL_REASON },
        { column: 'totp_recovery_codes', reason: CREDENTIAL_REASON },
        {
            column: 'phone',
            reason: 'a staff member\'s own contact number. The invitation path never asks for one, so a column carrying it would be a promise no import could keep',
        },
        {
            column: 'photo_url',
            reason: 'points at storage this deployment owns; the URL means nothing to a reader of the file and nothing to an import',
        },
        {
            column: 'default_signature_base64',
            reason: 'the saved signature drawing, embedded image data. Not a credential, and still not a column a team roster should carry: it is neither readable in a spreadsheet nor settable by an invitation',
        },
        {
            column: 'is_signature_enabled',
            reason: 'a per-account preference about the member\'s own signature block, set by that member after they accept',
        },
        {
            column: 'slug',
            reason: 'the public URL slug, derived from the name and unique per tenant. An import that honoured one would collide the first time two rosters were merged',
        },
        {
            column: 'onboarding_state',
            reason: 'one-time UI flags recording what this member has dismissed. Behavioural state of an existing account, meaningless for an invitation',
        },
        {
            column: 'is_totp_enabled',
            reason: 'whether the member turned on a second factor. Their decision to make after they accept, never one a roster file can set for them',
        },
        {
            column: 'totp_verified_at',
            reason: 'when this account last completed a second-factor challenge — an event in its own history, not a property to be restored',
        },
        {
            column: 'last_active_at',
            reason: 'a debounced activity timestamp for presence and seat accounting; it describes a live session, and a file cannot carry one',
        },
        {
            column: 'deleted_at',
            reason: 'the account soft-delete marker. A deletion travelling in a file is an instruction, not a fact about the person',
        },
        {
            column: 'terms_accepted',
            reason: 'acceptance EVIDENCE — a version, a content hash and the time and place it was given. Evidence is generated by the person accepting; an import that wrote one would be manufacturing a signature',
        },
        {
            column: 'permission_overrides',
            reason: 'per-account capability diffs off the role template. Out of scope for this round: the roster carries the role, and an override arriving as an unreadable JSON cell would widen what a file can grant',
        },
        {
            column: 'timezone',
            reason: 'a display preference this member sets for themselves; it affects their own chrome and nothing anybody else reads',
        },
        {
            column: 'locale',
            reason: 'a display preference this member sets for themselves — the same class as `timezone` above',
        },
        {
            column: 'date_format',
            reason: 'a display preference this member sets for themselves — the same class as `timezone` above',
        },
        {
            column: 'time_format',
            reason: 'a display preference this member sets for themselves — the same class as `timezone` above',
        },
        {
            column: 'service_origin_address',
            reason: 'where this inspector starts their day, possibly their home address. It reaches the staff member\'s OWN account export; a team roster handed around a workspace is a different audience',
        },
        {
            column: 'service_origin_lat',
            reason: 'the geocode half of the routing origin above, and withheld with it',
        },
        {
            column: 'service_origin_lng',
            reason: 'the geocode half of the routing origin above, and withheld with it',
        },
    ],
};

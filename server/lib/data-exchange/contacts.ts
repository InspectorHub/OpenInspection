/**
 * The `contacts` table as a file: what the export writes, and what an import
 * may read back.
 *
 * Why a classification with a mandatory reason rather than a denylist or an
 * allowlist is argued once, in `types.ts`, which in turn points at
 * `server/lib/compliance/account-export-manifest.ts:15-46` for the original
 * statement of the same argument. It is not restated here.
 *
 * FIELD ORDER IS THE EXPORT'S WIRE ORDER and is deliberately unchanged from the
 * hand-written header this manifest replaced (`id,type,name,email,phone,agency,
 * notes,created_at`). Reordering a CSV header is a silent breaking change for
 * anything that reads by index.
 *
 * ⚠️ A reason here is prose, and prose is not evidence. Before relying on one,
 * go read what writes the column.
 */
import type { ExchangeVocabulary } from './types';

export const CONTACT_EXCHANGE: ExchangeVocabulary = {
    entity: 'contact',
    intent: 'contacts.import',
    table: 'contacts',
    fields: [
        {
            field: 'id', column: 'id', header: 'id', aliases: [],
            disposition: 'exportOnly', serialize: 'text',
            reason: 'a key this deployment minted. Exported because it is what a support conversation and a second export of the same book both hang off. Never importable: an import mints its own, so a foreign identifier accepted as ours is how two vendors\' colliding ids quietly merge two people — the bundle format states the same rule for itself: it "carries NO primary keys of its own"',
        },
        {
            field: 'type', column: 'type', header: 'type', aliases: ['type', 'contact type'],
            disposition: 'roundTrip', serialize: 'text',
            reason: 'load-bearing rather than descriptive — agent signup binds only to a contact already typed `agent`, and the booking path reuses only a `client`. Two spellings and no more: a wrong bind is worse than a manual bind, and an unrecognised word becomes a repair row rather than a silent retype',
        },
        {
            field: 'name', column: 'name', header: 'name',
            aliases: ['name', 'full name', 'fullname', 'contact', 'contact name'],
            disposition: 'roundTrip', serialize: 'text',
            reason: 'who the contact is; the one field a contact row cannot be without',
        },
        {
            field: 'email', column: 'email', header: 'email',
            aliases: ['email', 'e-mail', 'email address'],
            disposition: 'roundTrip', serialize: 'text',
            reason: 'where correspondence goes, and what the active-contact unique index is on',
        },
        {
            field: 'phone', column: 'phone', header: 'phone',
            aliases: ['phone', 'tel', 'mobile', 'phone number'],
            disposition: 'roundTrip', serialize: 'text',
            reason: 'the contact\'s own number, free text because a contact book holds every punctuation habit there is',
        },
        {
            field: 'agency', column: 'agency', header: 'agency',
            aliases: ['agency', 'company', 'organization', 'organisation', 'brokerage', 'firm'],
            disposition: 'roundTrip', serialize: 'text',
            reason: 'the agent\'s brokerage or firm — the one contact field that leaves the product, as the QuickBooks CompanyName and as the referral leaderboard\'s grouping key',
        },
        {
            field: 'notes', column: 'notes', header: 'notes', aliases: ['notes', 'note'],
            disposition: 'roundTrip', serialize: 'text',
            reason: 'free prose the operator wrote about this person. `comments` is deliberately NOT an alias: in an inspection-adjacent export that heading names a template\'s canned-comment library far more often than a contact\'s note',
        },
        {
            field: 'createdAt', column: 'created_at', header: 'created_at', aliases: [],
            disposition: 'exportOnly', serialize: 'isoTimestamp',
            reason: 'when this contact entered the book. Exported because it is the file\'s only ordering signal and the operator\'s own record. Never importable: the write path stamps `new Date()` at insert, and a file-supplied value would claim a row was created before the run that created it',
        },
    ],
    notExported: [
        {
            column: 'tenant_id',
            reason: 'the export IS one tenant\'s book; a tenant id in the file is a value an import must never be allowed to honour',
        },
        {
            column: 'created_by_user_id',
            reason: 'names a `users` row the receiving deployment does not have; an import would either invent the reference or drop it',
        },
        {
            column: 'archived_at',
            reason: 'a soft-delete marker travelling in a file is an instruction, not a fact about the person',
        },
        {
            column: 'agent_user_id',
            reason: 'the binding between this contact and a global agent account. Account bindings are granted by the account holder, never by an uploaded file',
        },
        {
            column: 'agent_linked_at',
            reason: 'half of the agent account binding above; a timestamp for a binding the file does not carry describes nothing',
        },
        {
            column: 'agent_revoked_at',
            reason: 'half of the agent account binding above; a revocation is an act of this deployment, not a value to be restored from a file',
        },
        {
            column: 'locale',
            reason: 'A REAL GAP, DELIBERATELY LEFT OPEN. The column\'s own comment calls a stored value "the demand signal this column exists to produce", and it survives neither side today. Adding it is a widening, and this manifest\'s job is to make the existing surface honest first. Recorded here so it is a decision with a date rather than an omission',
        },
    ],
};

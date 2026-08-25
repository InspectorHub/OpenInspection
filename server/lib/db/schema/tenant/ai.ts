import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/**
 * A workspace's AI settings, and the statement it made about its own key.
 *
 * ## Why these are not columns on `tenant_configs`
 *
 * They were, until these tables existed — seventeen of them, on a table that
 * had reached one hundred columns. D1 will not create a table wider than that,
 * so the next AI field could not be added at all: the ceiling was reached by a
 * subsystem that keeps growing, sitting in a table it shares with booking,
 * branding, legal and PDF settings that do not grow at the same rate.
 *
 * Width was the trigger, not the reason. `tenant_configs` is FK-referenced,
 * which on D1 means a column can only ever be APPENDED — every AI field there
 * carried a comment saying so, and the reading order of that table stopped
 * matching its subject matter long ago. These tables are referenced by nothing,
 * so a field goes where it belongs and the file reads in the order a person
 * would explain it.
 *
 * ## Why TWO tables and not one
 *
 * The two halves are different KINDS of fact, and only the split makes that
 * legible:
 *
 *   `tenant_ai_configs` is current settings — overwritten in place, and only
 *   the present value means anything. Written by the settings page.
 *
 *   `tenant_ai_attestations` is a dated STATEMENT the workspace made, against a
 *   named revision of terms it was shown. Written by the secrets save, in the
 *   same `db.batch()` as the key it is about.
 *
 * ⚠️ **The attestation is still one row per workspace, overwritten on
 * re-attestation, exactly as it behaved as columns.** That is deliberate: this
 * change moves these fields and changes nothing about what they mean, because a
 * relocation that also altered semantics would leave no way to tell which half
 * broke something. But a record whose whole value is "what was said, and when"
 * is a poor fit for a shape that keeps only the latest — re-attesting discards
 * the previous statement, including the terms revision it was made against.
 * Making this append-only is the change the split was the prerequisite for; it
 * is not this change.
 *
 * ## What did NOT come across
 *
 * Seven of the seventeen columns were declared and never wired, and they were
 * left behind rather than carried into a new table, because moving a field
 * nothing writes only relocates the question of whether it should exist:
 *
 *   `ai_provider_kind` — an enum with one member; no code path ever set it.
 *   `ai_key_attestation_endpoint` / `_model` / `_service_tier` /
 *   `_intended_use` / `_config_version` — the "record the destination, not just
 *   the key" half of the attestation. `AiKeyAttestationRecord` carries none of
 *   these fields, so the secrets save could not write them even in principle;
 *   the only thing that ever set them was a spec that inserted them with
 *   Drizzle and asserted they came back.
 *
 * The seventh, `ai_config_version`, DID come across — production code bumps it
 * on every save. Its READER is what was never built: nothing passes a version
 * to `recordProvenance`, so `ai_call_provenance.config_version` is NULL on
 * every row, and the join that was supposed to answer "which configuration was
 * in force when this data was processed" has no left-hand side. The counter is
 * kept because removing it is a product decision; the gap is recorded here so
 * the next person reads a fact instead of a promise.
 *
 * Neither table declares `.references()`. Per the repo's schema rules a
 * referenced table can never be rebuilt on D1, and being referenced by nothing
 * is what buys these tables the freedom the one they came from lost. Rows are
 * removed by the tenant purge path in the service layer, like every other
 * tenant-scoped table.
 */
export const tenantAiConfigs = sqliteTable('tenant_ai_configs', {
    tenantId: text('tenant_id').primaryKey(),
    /**
     * Whether this workspace may be offered AI at all.
     *
     * A PROVISIONING answer, not a permission: whether a given call is allowed
     * is decided in `resolveAi`, where a provider is actually built. Defaults
     * TRUE, so a workspace that has never opened the page is unaffected.
     */
    isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
    /**
     * Root of an OpenAI-compatible API. NULL means the deployment default
     * (`AI_BASE_URL`). A self-hosted operator may point this at an address on
     * their own network.
     */
    baseUrl: text('base_url'),
    /** Model id as the chosen backend names it. NULL means the deployment
     *  default (`AI_MODEL`). No value is compiled in at either level. */
    model: text('model'),
    /**
     * Monotonic version of this workspace's AI configuration. Bumped on every
     * saved change to endpoint or model.
     *
     * ⚠️ Nothing reads it yet — see the note on unwired fields above. It exists
     * to answer "which destination was in force when this inspection data was
     * processed?", and answering that needs `recordProvenance` to be given the
     * version, which no call site does.
     *
     * Starts at 0 so an untouched workspace still has a version to cite; a call
     * recorded against no version records NULL, which is a different statement
     * from "version 0".
     */
    configVersion: integer('config_version').notNull().default(0),
    /**
     * Whether this workspace may PRODUCE courtesy translations of a report.
     *
     * ⚠️ It gates production and never consumption. Switching it off must not
     * alter a single already-published report: reader paths answer from
     * `report_translations` rows and never consult this column, so turning the
     * feature off stops new translations being made and can never strip one
     * from a document already delivered. Removal of a translation stays
     * available while it is off, because cleaning up after switching off is
     * exactly when it is needed.
     *
     * Defaults to FALSE, unlike `is_enabled` above, and the asymmetry is
     * deliberate. That column means "nothing switched off"; this one is a
     * decision to spend money on every publish, and off is the absence of a
     * choice rather than a choice.
     */
    isCourtesyTranslationEnabled: integer('is_courtesy_translation_enabled', { mode: 'boolean' }).notNull().default(false),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * What a workspace stated about its own AI provider key, and when.
 *
 * Recorded verbatim from the secrets save. Nothing here is measured or
 * verified, and the distinction is the whole point of the table:
 *
 *   - It proves that, at a stated moment and against a named revision of the
 *     terms it was shown, the workspace asserted these facts. That is a record
 *     of what was represented, and its evidential value is exactly that.
 *   - It does NOT prove the key was usable, that the provider account is what
 *     was claimed, or that the content sent was the content described. Only
 *     `ai_call_provenance` speaks to what actually ran, and it speaks by
 *     observation, off the adapter instance.
 *
 * Reading a row here as evidence of what happened, rather than of what was
 * claimed, is the one misuse it must not be put to.
 *
 * **A row exists exactly when an attested key is on file.** That is the shape
 * change worth noticing: as six nullable columns, "attested" meant all six
 * non-null together, an invariant no constraint could hold and every reader had
 * to re-check. Here the row IS the attestation — clearing the key deletes it,
 * because a statement outliving the credential it was made about would read as
 * covering a key nobody attested to.
 */
export const tenantAiAttestations = sqliteTable('tenant_ai_attestations', {
    tenantId: text('tenant_id').primaryKey(),
    /**
     * Which provider the key belongs to. Deliberately not narrowed to one
     * vendor — a destination the WORKSPACE chose is not one this codebase gets
     * to enumerate. ⚠️ `buildAiKeyAttestationRecord` still hardcodes `gemini`,
     * so the second member is reachable in the type and not yet in the data.
     * Type-layer only in Drizzle; no DDL is emitted for an enum change.
     */
    provider: text('provider', { enum: ['gemini', 'openai_compatible'] }).notNull(),
    /** The arrangement attested: the tenant's OWN key, never a managed one. */
    mode: text('mode', { enum: ['tenant_key'] }).notNull(),
    /**
     * Whose provider account the key bills to — and therefore whose provider
     * terms govern the content sent to it.
     */
    accountOwner: text('account_owner', { enum: ['tenant'] }).notNull(),
    /**
     * Stamped from `AI_PROVIDER_TERMS_VERSION` at write time. A later bump of
     * that constant does NOT invalidate stored rows — the runtime check
     * requires a row to exist and ignores the value — so re-confirmation stays
     * a deliberate pass rather than an outage caused by a one-character edit.
     */
    termsVersion: text('terms_version').notNull(),
    attestedAt: integer('attested_at', { mode: 'timestamp_ms' }).notNull(),
    /**
     * Stamped from `AI_KEY_ATTESTATION_POLICY_VERSION` — the revision of OUR
     * statements, which moves independently of the provider terms above.
     */
    policyVersion: text('policy_version').notNull(),
});

/**
 * The `kind='statutory'` half of the catalogue import.
 *
 * The kind exists as its own branch rather than as a flavour of 'templates'
 * because of what is in this file: a statutory catalogue row carries a
 * declaration that the tenant-facing template schema refuses, and refusing it
 * there is the closed door that stops a workspace declaring its own official
 * form. The import for this one kind validates with the extended schema
 * instead — and nothing else in the codebase may.
 */
import { StatutoryTemplateSchema } from '../../lib/validations/statutory-template.schema';
import { Errors } from '../../lib/errors';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { fieldMapFor } from '../../lib/statutory/forms';
import { unsuppliableRequiredFields, unsuppliableRefusal } from '../statutory/install-gaps';
import { r2Keys } from '../../lib/r2-keys';
import { versionForInspection, type StatutoryFormVersion } from '../../lib/statutory/form-registry';
import type { StatutoryFormDeclaration } from '../../types/statutory-declaration';

/**
 * Gate a `kind='statutory'` catalogue entry on the EXTENDED validator.
 *
 * ⚠️ THE ONLY CALLER OF `StatutoryTemplateSchema`, and it must stay that way.
 * A boolean on the ordinary validator would have done the same job and is
 * exactly what this avoids: a flag that switches off a door is one call site
 * away from being passed by something that should not have it.
 *
 * The relaxation is safe only because the catalogue is unreachable from user
 * input — every write to it is the seeder or a downloadCount increment, which
 * is what `lint:catalogue-writes` exists to keep true. If that gate is removed,
 * this stops being a validator and becomes a door.
 */
function assertStatutorySchema(schema: unknown): void {
    // The column is `mode: 'json'`, but a row written as a JSON string reads
    // back as one — the same thing `TemplateService.validateSchema` handles.
    let parsed: unknown = schema;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            throw Errors.BadRequest('Invalid statutory template: schema is not valid JSON');
        }
    }
    const result = StatutoryTemplateSchema.safeParse(parsed);
    if (!result.success) {
        const first = result.error.issues[0];
        const path = first?.path?.join('.') || 'schema';
        throw Errors.BadRequest(`Invalid statutory template: ${path} — ${first?.message ?? 'invalid'}`);
    }
}

/**
 * Everything a statutory pack must satisfy before a row is written for it: a
 * declaration the extended validator accepts, and the authority's own PDF
 * already in storage for the revision it produces.
 *
 * One function because both halves run at every one of the three moments a
 * statutory template is minted — install, update and reinstall. An update mints
 * a local template exactly as an install does, and "updated but unable to
 * produce" is the worse of the two: the workspace's working copy has already
 * been retired by the time anybody finds out.
 */
export async function assertStatutoryInstallable(
    bucket: R2Bucket | undefined,
    schema: unknown,
    versions: readonly StatutoryFormVersion[],
    /**
     * The workspace, for the second "installed but unusable" check: whether
     * anybody here can supply the profile-level facts the form REQUIRES.
     *
     * Required rather than optional on purpose. An optional argument that
     * callers may omit turns a check nobody ran into a check that passed, and
     * that is precisely the fault this whole function exists to prevent.
     */
    workspace: { db: DrizzleD1Database<Record<string, unknown>>; tenantId: string },
): Promise<void> {
    assertStatutorySchema(schema);
    const declaration = statutoryDeclarationOf(schema);
    // Unreachable after the validator, which requires the declaration. Written
    // as a return rather than an assertion so a future change to either side
    // cannot turn a missing declaration into an unchecked install.
    if (declaration === null) return;
    await assertStatutorySourcePresent({ bucket, versions, declaration, now: Date.now() });
    await assertSomebodyCanSupplyIt({ ...workspace, versions, declaration, now: Date.now() });
}

/**
 * The other half of "installed but unusable": the form's profile-level required
 * fields, and whether ANY member can supply them.
 *
 * Same standard as the PDF check above and deliberately not a stricter one --
 * NOBODY, never EVERYBODY. A workspace where one inspector has a licence and
 * three do not can produce this form, and refusing that would gate work
 * somebody can already do. A workspace where nobody has one has installed a
 * template that renders for no inspection anyone creates.
 *
 * Skips silently when no revision can be named, exactly as the PDF check does
 * and for the same reason: there is no field map to read `requiredFields` from,
 * so there is no question to ask.
 */
async function assertSomebodyCanSupplyIt(input: {
    db: DrizzleD1Database<Record<string, unknown>>;
    tenantId: string;
    versions: readonly StatutoryFormVersion[];
    declaration: StatutoryFormDeclaration;
    now: number;
}): Promise<void> {
    const { declaration, versions } = input;
    const version = typeof declaration.revision === 'string'
        ? versions.find((v) => v.formId === declaration.formId && v.version === declaration.revision)
        : versionForInspection(declaration.formId, input.now, versions);
    if (!version) return;
    const map = fieldMapFor(version.formId, version.version);
    if (!map) return;

    const gaps = await unsuppliableRequiredFields(input.db, input.tenantId, map, declaration);
    if (gaps.length > 0) {
        throw Errors.Conflict(unsuppliableRefusal(version.formId, version.version, gaps));
    }
}

/** The declaration a statutory catalogue row carries, or null if it carries none. */
function statutoryDeclarationOf(schema: unknown): StatutoryFormDeclaration | null {
    let parsed: unknown = schema;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return null;
        }
    }
    const declaration = (parsed as { statutoryForm?: StatutoryFormDeclaration } | null)?.statutoryForm;
    return declaration ?? null;
}

/**
 * Refuse an install whose authority PDF is not in storage yet.
 *
 * ── WHY INSTALL IS THE PLACE ────────────────────────────────────────────────
 * A statutory template renders onto the issuing agency's own document, and this
 * repository does not carry that document: it is fetched from object storage at
 * produce time under a shared `_platform/` key. Nothing about installing put it
 * there. Without this check the catalogue says INSTALLED and the button says
 * error — "installed" and "usable" quietly meaning different things, which is
 * among the hardest classes of fault to trace, because every surface a person
 * can see reports success.
 *
 * Refused BEFORE any row is written, so the workspace is not left in the state
 * this is meant to prevent: nothing is installed, and the message says which
 * file is missing and where it goes.
 *
 * ── WHICH REVISION'S BYTES ──────────────────────────────────────────────────
 * The one the pack's declaration names, when it names one: bindings are authored
 * against a single revision's field map and cannot be inherited across, so that
 * is the only revision this template can legitimately produce. When it names
 * none — templates predating the key — the revision in force TODAY is checked
 * instead, because that is the one an inspection created today resolves to.
 *
 * ⚠️ It never GUESSES. When neither can be named — a deployment whose published
 * catalogue covers nothing today, which is every deployment until an operator
 * publishes a revision — there is no key to look for, so nothing is checked and
 * nothing is refused. The produce path already refuses that case in its own
 * words ("this software publishes no revision …"), which is a legible failure
 * rather than the invisible one this check exists for.
 */
async function assertStatutorySourcePresent(input: {
    bucket: R2Bucket | undefined;
    versions: readonly StatutoryFormVersion[];
    declaration: StatutoryFormDeclaration;
    now: number;
}): Promise<void> {
    const { declaration, versions } = input;

    let version: StatutoryFormVersion | null;
    if (typeof declaration.revision === 'string') {
        version = versions.find(
            (v) => v.formId === declaration.formId && v.version === declaration.revision,
        ) ?? null;
        if (version === null) {
            // The pack names a revision this deployment does not publish. There
            // is no field map for it and no recorded hash to verify bytes
            // against, so installing would produce a template that can never
            // render — refused here rather than discovered at produce time.
            throw Errors.Conflict(
                `This package is built for revision ${declaration.revision} of `
                + `${declaration.formId}, and this software publishes no such revision. `
                + 'Upgrade the deployment to a version that publishes it, then install again.',
            );
        }
    } else {
        version = versionForInspection(declaration.formId, input.now, versions);
        if (version === null) return;
    }

    const key = r2Keys.statutoryFormSource(version.formId, version.version);

    if (input.bucket === undefined) {
        // Fail closed. No storage binding means the bytes cannot be there, and
        // an unchecked install is exactly the "installed but unusable" state.
        throw Errors.Conflict(
            `Installing ${version.formId} needs the authority's published PDF for revision `
            + `${version.version}, and this deployment has no object storage bound to look in.`,
        );
    }

    const head = await input.bucket.head(key);
    if (head !== null) return;

    throw Errors.Conflict(
        `This package needs the official file first. Revision ${version.version} of `
        + `${version.formId} renders onto the issuing authority's own published PDF, and this `
        + 'deployment does not have it. Upload it at POST /api/admin/statutory-forms/'
        + `${version.formId}/source with revision "${version.version}" — it is checked against `
        + 'the sha256 this revision records, and the revision is printed on the document itself. '
        + `The authority publishes it at ${version.sourceUrl}. Nothing was installed.`,
    );
}

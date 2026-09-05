import { and, eq, isNull, ne } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { templates, users } from '../../lib/db/schema';
import { r2Keys } from '../../lib/r2-keys';
import { versionForInspection } from '../../lib/statutory/form-registry';
import type { StatutoryFormVersion } from '../../lib/statutory/form-registry';

/**
 * Can this deployment produce a statutory form for a job booked today?
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Producing one needs THREE things, each owned by a different person and each
 * enforced somewhere else:
 *
 *   1. a template that declares the form   — an administrator installs it
 *   2. the authority's PDF, for the revision in force — the OWNER supplies it
 *   3. the inspector's printed licence class — the inspector types it
 *
 * Every one of those refuses well in its own words. None of them can be seen
 * from where the others are, and the person who discovers a gap is generally
 * not the person who can close it: the inspector meets #2 mid-job, on a screen
 * only the owner can open. So the failure this answers is not "the product did
 * not say" — it is "nobody could see all three at once, before the inspection
 * rather than during it".
 *
 * ── WHY "TODAY" AND NOT "EVERY REVISION" ────────────────────────────────────
 * A form's revisions are date-bounded, and an inspection is governed by the
 * revision in force on ITS OWN date. A readiness view that ticked green because
 * some superseded revision's PDF happens to be stored would be answering a
 * question nobody asked. This resolves the revision applicable NOW, and reports
 * on that one — which is the revision a job booked today will need.
 *
 * That makes the answer perishable ON PURPOSE: it goes red by itself when a
 * cutover passes and the new revision's document has not been supplied. A
 * once-true tick that never expires is how the second half of a lockout goes
 * unnoticed for six days.
 *
 * ── WHY THE INSPECTOR COUNT IS A FRACTION, NOT A FLAG ───────────────────────
 * "Some inspectors can produce this and some cannot" is the true and useful
 * state, and it is invisible to a boolean. The denominator is deliberately
 * every active non-agent member rather than "inspectors who have done one
 * before": a workspace that has never produced a statutory form is exactly the
 * one this screen is for.
 */
// Not exported: nothing imports the row on its own, and a dead export is
// what the dead-code gate is for.
interface StatutoryFormReadiness {
    formId: string;
    formTitle: string;
    /** The revision in force today, or null when the form has none right now. */
    currentRevision: string | null;
    /** A template in THIS workspace declares this form. */
    templateInstalled: boolean;
    /** The authority's PDF for `currentRevision` is in this deployment's storage. */
    sourceStored: boolean;
}

export interface StatutoryReadiness {
    forms: StatutoryFormReadiness[];
    /** Active members who could sign a form, and how many have a licence class. */
    licenceClass: { filled: number; total: number };
}

/** The `statutoryForm` declaration a platform-supplied template carries. */
function declaredFormId(schema: unknown): string | null {
    const declaration = (schema as { statutoryForm?: { formId?: unknown } } | null)?.statutoryForm;
    const formId = declaration?.formId;
    return typeof formId === 'string' && formId.length > 0 ? formId : null;
}

export async function statutoryReadiness(input: {
    db: DrizzleD1Database<Record<string, never>>;
    tenantId: string;
    /** Undefined where no bucket is bound — every form then reads as not stored. */
    bucket: R2Bucket | undefined;
    versions: readonly StatutoryFormVersion[];
    now: number;
}): Promise<StatutoryReadiness> {
    const { db, tenantId, bucket, versions, now } = input;

    // Read the declarations in ONE pass rather than per form. The column is
    // JSON, so this is a scan either way; doing it once keeps it to one.
    const rows = await db
        .select({ schema: templates.schema })
        .from(templates)
        .where(eq(templates.tenantId, tenantId));
    const installed = new Set(
        rows.map((r) => declaredFormId(r.schema)).filter((id): id is string => id !== null),
    );

    const formIds = [...new Set(versions.map((v) => v.formId))];
    const forms = await Promise.all(formIds.map(async (formId) => {
        // `versionForInspection` — the same selector the editor and the
        // produce path use. Nothing is re-derived here.
        const version = versionForInspection(formId, now, versions);
        const formTitle = version?.formTitle
            // A form with no revision in force today still has a name, taken
            // from any revision of it: the row must not read as an unnamed id.
            ?? versions.find((v) => v.formId === formId)?.formTitle
            ?? formId;
        const sourceStored = version === null || bucket === undefined
            ? false
            : (await bucket.head(r2Keys.statutoryFormSource(formId, version.version))) !== null;
        return {
            formId,
            formTitle,
            currentRevision: version?.version ?? null,
            templateInstalled: installed.has(formId),
            sourceStored,
        };
    }));

    // Agents are not staff and cannot sign anything; a denominator that counted
    // them would make a fully-configured workspace read as partly configured.
    const members = await db
        .select({ licence: users.statutoryLicenseType })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), isNull(users.deletedAt), ne(users.role, 'agent')));

    return {
        forms,
        licenceClass: {
            filled: members.filter((m) => (m.licence ?? '').trim() !== '').length,
            total: members.length,
        },
    };
}

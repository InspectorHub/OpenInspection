/**
 * Refuse structural edits to a template the platform supplies.
 *
 * WHY THIS RUNS BEFORE THE BODY VALIDATOR, AND NOT INSIDE THE HANDLER. The
 * realistic client shape is: fetch the template, change one thing, send the
 * whole document back. The statutory declaration rides along in that body, and
 * the tenant schema is `.strict()` — so left alone, zod answers first and
 * answers `unrecognized_keys`. That tells an inspector the software does not
 * recognise one of its own fields, when the true answer is that this template
 * belongs to the platform and its structure is not theirs to change.
 *
 * ⚠️ THE `.strict()` IS NOT THE PROBLEM AND MUST NOT BE RELAXED. It is the
 * closed door that stops a declaration being smuggled in on a template a
 * workspace authors. This middleware exists so that the door has a sign on it,
 * not so the door can be opened.
 *
 * The stored row is what is consulted, never the submitted body — a caller that
 * simply omits the declaration from the payload must not thereby acquire the
 * right to edit the template.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { eq, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { templates, inspections } from '../db/schema';
import { Errors } from '../errors';
import type { HonoConfig } from '../../types/hono';

/** The one sentence a workspace sees. It names the owner and the consequence,
 *  and deliberately says nothing about keys, schemas or validation. */
const STATUTORY_TEMPLATE_READ_ONLY =
    'This template produces an official form and is supplied with the software, '
    + 'so its structure is read-only. Duplicate it to build your own version.';

/**
 * Does this stored template declare that it produces a statutory form?
 *
 * Takes `unknown` on purpose. The column is declared as text on one table and
 * as json mode on another, so what arrives is a string in one case and an
 * already-parsed object in the other. Narrowing here keeps both callers honest
 * instead of putting a cast at each call site.
 */
function declaresStatutoryForm(raw: unknown): boolean {
    if (raw === null || raw === undefined) return false;
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
        try {
            parsed = JSON.parse(raw);
        } catch {
            // A row we cannot parse is not a row we can call platform-supplied.
            // Let the ordinary path deal with it rather than refusing on a guess.
            return false;
        }
    }
    if (typeof parsed !== 'object' || parsed === null) return false;
    const declaration = (parsed as { statutoryForm?: unknown }).statutoryForm;
    return declaration !== undefined && declaration !== null;
}

/**
 * Guards a route whose `id` param names a template.
 *
 * Tenant-scoped: the id comes from the path but the row is fetched with the
 * `tenantId` from the verified session, so this can never read — or refuse on
 * the basis of — another workspace's template.
 */
export function refuseStatutoryTemplateEdit(): MiddlewareHandler<HonoConfig> {
    return async (c: Context<HonoConfig>, next) => {
        const id = c.req.param('id');
        const tenantId = c.get('tenantId');
        if (!id || !tenantId) return next();

        const row = await drizzle(c.env.DB)
            .select({ schema: templates.schema })
            .from(templates)
            .where(and(eq(templates.id, id), eq(templates.tenantId, tenantId)))
            .get();

        if (row && declaresStatutoryForm(row.schema)) {
            throw Errors.Forbidden(STATUTORY_TEMPLATE_READ_ONLY);
        }
        return next();
    };
}

/**
 * The same rule, on the inspection's own copy.
 *
 * The editor does structural edits against `inspections.template_snapshot` and
 * PATCHes the whole document back. `stripRuntimeKeys` rebuilds sections and
 * items from allowlists but does NOT filter top-level keys, so a declaration on
 * that snapshot survives the round trip and reaches the same `.strict()` schema
 * — and produces the same unhelpful `unrecognized_keys`.
 *
 * Two guards rather than one because the two routes key off different rows: one
 * names a template, the other names an inspection. A single guard would have to
 * guess which, and guessing wrong fails open.
 */
export function refuseStatutorySnapshotEdit(): MiddlewareHandler<HonoConfig> {
    return async (c: Context<HonoConfig>, next) => {
        const id = c.req.param('id');
        const tenantId = c.get('tenantId');
        if (!id || !tenantId) return next();

        const row = await drizzle(c.env.DB)
            .select({ snapshot: inspections.templateSnapshot })
            .from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
            .get();

        // A json-mode column, so this arrives parsed rather than as text --
        // which `declaresStatutoryForm` handles, so both guards answer the
        // question the same way.
        if (declaresStatutoryForm(row?.snapshot)) {
            throw Errors.Forbidden(STATUTORY_TEMPLATE_READ_ONLY);
        }
        return next();
    };
}

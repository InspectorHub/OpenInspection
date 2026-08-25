/**
 * Regenerating and removing the courtesy translation of a report.
 *
 * ONE route with an action discriminator, not two, because the two actions
 * answer the same question — "what should the translated half of this document
 * be" — and a person choosing between them is choosing once. It also keeps the
 * pair visibly together: a surface that offers regenerate must offer removal,
 * and removal has to stay reachable when production is switched off.
 *
 * ## What this route does NOT do
 *
 * It does not cut a new report version. Regenerating a translation changes no
 * English byte, so a new version would record an amendment that did not happen
 * and would push the amendment trail out of step with what a reader sees.
 *
 * ## Regenerate is also the un-withhold path
 *
 * A translation is withheld when the English it was made from has moved. The
 * repair is to translate the CURRENT English and stamp a fresh `english_hash`,
 * which is exactly what regenerate does — so the inspector's answer to "where
 * did the Spanish go" is one button rather than a support conversation.
 *
 * ## The switch gates production only
 *
 * `is_courtesy_translation_enabled` refuses a regenerate. It never refuses a
 * removal, and no reader ever consults it.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { createApiResponseSchema } from '../../lib/validations/shared.schema';
import { auditFromContext } from '../../lib/audit';
import { getTenantId } from '../../lib/route-helpers';
import { Errors } from '../../lib/errors';
import { SUPPORTED_CONTACT_LOCALES } from '../../lib/i18n/contact-locale';
import { generateCourtesyTranslation, removeCourtesyTranslation } from '../../lib/translation/generate';
import { readTranslationState } from '../../lib/translation/read-for-report';
import { listReports } from '../../lib/inspection/reports';
import { getDrizzle } from '../../lib/route-helpers';
import { isCourtesyTranslationEnabled } from '../../lib/translation/production-switch';

/**
 * The locales a translation may be produced in.
 *
 * Reuses the contact-locale set rather than declaring its own: the reason a
 * translation exists at all is that a recipient reads that language, and two
 * lists would let a workspace request one nothing else in the product can
 * address. `en` is filtered out — a courtesy translation of English into
 * English is not a thing to spend money on.
 */
const TRANSLATABLE_LOCALES: readonly string[] =
    SUPPORTED_CONTACT_LOCALES.filter((l) => l !== 'en');

const bodySchema = z.object({
    action: z.enum(['regenerate', 'remove'])
        .describe('regenerate translates the CURRENT English and replaces the stored copy; remove takes it down.'),
    locale: z.string().trim().min(2).max(20)
        .describe('BCP-47 target locale, e.g. es-419.'),
    reportId: z.string().trim().min(1).optional()
        .describe('Which deliverable. Absent means the primary report of this inspection.'),
});

const reportTranslationRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/report-translation',
    tags: ['inspections'],
    summary: 'Regenerate or remove the courtesy translation of a report',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().min(1).describe('Inspection id') }),
        body: { content: { 'application/json': { schema: bodySchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({
                action: z.enum(['regenerate', 'remove']).describe('Which action ran.'),
                locale: z.string().describe('The target locale acted on.'),
                reportId: z.string().nullable().describe('The deliverable acted on, or null when the inspection has no report row.'),
                segmentCount: z.number().describe('Segments stored. Zero on a removal.'),
                changed: z.boolean().describe('False on a removal that found nothing to remove.'),
            })) } },
            description: 'Translation regenerated or removed',
        },
        400: { description: 'Unsupported locale, nothing translatable, or production is switched off for this workspace.' },
    },
    operationId: 'updateInspectionReportTranslation',
    description: 'Regenerates or removes the courtesy translation of one report. Regenerate always translates the report as it stands right now, so it is also how a translation withheld by an edit is brought back. It does not cut a new report version. Removal stays available when translation production is switched off for the workspace.',
}, { scopes: ['write'], tier: 'extended' }));

/**
 * GET the state of every deliverable's translation on one inspection.
 *
 * Its own read rather than a field on the hub payload: computing it costs a
 * content hash PER REPORT, and the hub is the page's one aggregate round trip.
 * A card that needs it asks for it.
 */
const reportTranslationStateRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/report-translation',
    tags: ['inspections'],
    summary: 'Courtesy-translation state for each report on this inspection',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().min(1).describe('Inspection id') }),
        query: z.object({ locale: z.string().optional().describe('Target locale; defaults to the one this deployment offers.') }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({
                locale: z.string(),
                reports: z.array(z.object({
                    reportId: z.string(),
                    state: z.enum(['none', 'live', 'withheld'])
                        .describe('none = never translated. live = delivered and current. withheld = translated, then the report changed, so it is not being shown — regenerate translates the report as it stands now.'),
                })),
            })) } },
            description: 'Per-report translation state',
        },
    },
    operationId: 'getInspectionReportTranslationState',
    description: 'The three states a report translation can be in, per deliverable. The withheld state is the one that is otherwise silent: a report edited and republished stops showing its translation by design, and without this nobody is told until a client asks where it went.',
}, { scopes: ['read'], tier: 'extended' }));

const reportTranslationRoutes = createApiRouter()
    .openapi(reportTranslationStateRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const locale = c.req.valid('query').locale || (TRANSLATABLE_LOCALES[0] ?? '');
        const deps = {
            db: c.env.DB,
            inspection: c.var.services.inspection,
            translations: c.var.services.reportTranslation,
        };
        const rows = await listReports(getDrizzle(c), tenantId, id);
        const reports = [];
        for (const r of rows) {
            reports.push({
                reportId: r.id,
                state: await readTranslationState(deps, {
                    tenantId, inspectionId: id, reportId: r.id, locale,
                }),
            });
        }
        return c.json({ success: true as const, data: { locale, reports } }, 200);
    })
    .openapi(reportTranslationRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const { action, locale, reportId } = c.req.valid('json');

        if (!TRANSLATABLE_LOCALES.includes(locale)) {
            throw Errors.BadRequest(
                `This deployment does not produce translations in '${locale}'. `
                + `Offered: ${TRANSLATABLE_LOCALES.join(', ')}.`,
            );
        }

        const translations = c.var.services.reportTranslation;

        if (action === 'remove') {
            // Deliberately BEFORE the production switch is consulted.
            const { reportId: resolved, removed } = await removeCourtesyTranslation(
                { db: c.env.DB, translations },
                { tenantId, inspectionId: id, ...(reportId ? { reportId } : {}), locale },
            );
            auditFromContext(c, 'inspection.report_translation_removed', 'inspection', {
                entityId: id,
                metadata: { locale, reportId: resolved, removed },
            });
            return c.json({
                success: true as const,
                data: { action, locale, reportId: resolved, segmentCount: 0, changed: removed },
            }, 200);
        }

        if (!await isCourtesyTranslationEnabled(c.env.DB, tenantId)) {
            throw Errors.BadRequest(
                'Courtesy translation is switched off for this workspace. Turn it on in '
                + 'Settings before producing a new translation.',
            );
        }

        const result = await generateCourtesyTranslation(
            { db: c.env.DB, ai: c.var.services.ai, inspection: c.var.services.inspection, translations },
            { tenantId, inspectionId: id, ...(reportId ? { reportId } : {}), locale },
        );
        auditFromContext(c, 'inspection.report_translation_regenerated', 'inspection', {
            entityId: id,
            metadata: { locale, reportId: result.reportId, segmentCount: result.segmentCount },
        });
        return c.json({
            success: true as const,
            data: {
                action, locale, reportId: result.reportId,
                segmentCount: result.segmentCount, changed: true,
            },
        }, 200);
    })
;

export default reportTranslationRoutes;

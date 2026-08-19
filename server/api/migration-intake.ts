import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { desc, eq } from 'drizzle-orm';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { capabilitiesFor } from '../lib/middleware/require-capability';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { getDrizzle } from '../lib/route-helpers';
import { Errors } from '../lib/errors';
import { migrationBatches, type MigrationIntent } from '../lib/db/schema';
import { MIGRATION_BATCH_STATUS } from '../lib/status/migration-batch-status';
import type { HonoConfig } from '../types/hono';
import { assertSourceSizeWithin, limitsFor } from '../lib/migration-intake/limits';
import { buildBundle, defaultMappingFor, matchAdapter } from '../lib/migration-intake/adapters/registry';
import { MigrationStageService } from '../services/migration-intake/stage.service';
import { MigrationReportService } from '../services/migration-intake/report.service';
import { MigrationSourceFileService, extForFileName } from '../services/migration-intake/source-file.service';
import { expiryFor } from '../services/migration-intake/assistance.service';
import {
    IntakeBatchParamsSchema,
    IntakeListQuerySchema,
    IntakeReportQuerySchema,
    IntakeUploadFormSchema,
} from '../lib/validations/migration-intake.schema';

/**
 * The vendors this deployment can read without a person, listed for the refusal
 * message. A refusal that does not say what WOULD work sends the operator back
 * to the same file.
 */
const SUPPORTED_SOURCES = ['a Spectora template export (JSON)', 'a spreadsheet saved as CSV or Excel'];

/**
 * Whether this actor may run THIS import.
 *
 * Per intent rather than one gate on the shared route, because a single gate is
 * wrong in one direction or the other by construction: it either hands template
 * import to somebody without the capability, or shuts out somebody who is
 * allowed to import contacts. The gates reused here are the ones the rest of
 * the product already enforces for the same actions.
 *
 * `assisted.full` is tightened to owner alone. It is a decision to put a file
 * containing third-party personal data in front of somebody outside the
 * company, which is not the same question as who may import data.
 *
 * Module-private, and it stays that way: the routes that edit an existing run
 * live in this file too, so they reach it directly. Exporting it would put a
 * second spelling of this gate within reach of somewhere that is not an import
 * route, which is how a gate and the thing it guards come apart.
 */
async function assertIntentAllowed(c: Context<HonoConfig>, intent: MigrationIntent): Promise<void> {
    if (intent === 'assisted.full') {
        if (c.get('userRole') !== 'owner') {
            throw Errors.Forbidden('Only an owner can send a file to be converted.');
        }
        return;
    }
    if (intent === 'contacts.import' || intent === 'members.invite') {
        // The role floor on the route is the whole gate here, matching the
        // existing contact-import and invite paths.
        return;
    }
    const caps = await capabilitiesFor(c);
    // BOTH, because the entry point that leads here is gated on
    // `templateImport` (the Templates page renders its import button behind it,
    // and POST /api/templates/import mounts requireCapability('templateImport'))
    // while creating a template is gated on `templateCreate`. A route reached
    // from a button must not accept somebody the button would have hidden from,
    // and must not accept somebody who could not create the thing it is about
    // to create.
    if (!caps.templateImport) throw Errors.Forbidden("Requires the 'templateImport' capability");
    if (!caps.templateCreate) throw Errors.Forbidden("Requires the 'templateCreate' capability");
    if (intent === 'templates.overwrite' && !caps.templateEdit) {
        throw Errors.Forbidden("Requires the 'templateEdit' capability");
    }
}

const createBatchRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/',
    tags: ['imports'],
    summary: 'Start an import run from an uploaded file',
    description: 'Accepts an uploaded export or spreadsheet, stores it, and stages an import run from it. When no adapter can read the file the run is opened in a waiting state instead — and where no support path exists, the upload is refused before anything is stored.',
    middleware: [requireRole('owner', 'manager')] as const,
    request: {
        body: {
            content: {
                'multipart/form-data': { schema: IntakeUploadFormSchema },
            },
        },
    },
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true),
                        data: z.object({
                            batchId: z.string().describe('Id of the run just created, used for every later step'),
                            status: z.string().describe('Lifecycle state the run was opened in'),
                            needsAssistance: z.boolean().describe('Whether this run is waiting for a person to convert its file'),
                        }),
                    }),
                },
            },
            description: 'Import run created',
        },
        403: { description: 'Not allowed to run this kind of import' },
        422: { description: 'Nothing here can read the file, and it was not stored' },
    },
    operationId: 'createImportRun',
    // A file upload is not expressible as a tool call, so this one is not
    // offered as one. Every other route in this module is.
}, { scopes: ['write'], tier: 'excluded' }));

const listBatchesRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/',
    tags: ['imports'],
    summary: 'List import runs for this workspace',
    description: 'Returns this workspace\'s import runs, newest first, so somebody can see what was imported and reach the undo for any of it.',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { query: IntakeListQuerySchema },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true),
                        data: z.object({
                            items: z.array(z.object({
                                id: z.string().describe('Id of the import run'),
                                intent: z.string().describe('Which entry point started it'),
                                vendor: z.string().describe('Where the file came from, for display only'),
                                status: z.string().describe('Lifecycle state of the run'),
                                createdAt: z.string().describe('When the run was started, as an ISO timestamp'),
                                expiresAt: z.string().nullable().describe('When the run and its file stop being kept, as an ISO timestamp'),
                            })).describe('Import runs, newest first'),
                        }),
                    }),
                },
            },
            description: 'Import runs',
        },
    },
    operationId: 'listImportRuns',
}, { scopes: ['read'], tier: 'extended' }));

const getBatchRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{batchId}',
    tags: ['imports'],
    summary: 'Read what an import run will do',
    description: 'Returns the run counts split into three exclusive buckets, the entries that still need a person, and the sentence explaining why the run cannot be applied yet when it cannot.',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { params: IntakeBatchParamsSchema, query: IntakeReportQuerySchema },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true),
                        data: z.unknown().describe('The full import-run report, including counts, problem entries and the blocked reason'),
                    }),
                },
            },
            description: 'Import run report',
        },
        404: { description: 'No such import run in this workspace' },
    },
    operationId: 'getImportRun',
}, { scopes: ['read'], tier: 'extended' }));

/**
 * Mounted at `/api/imports` rather than under a per-entity prefix: one run can
 * carry templates, contacts or team members, so filing it under any one of them
 * would hide it from readers of the other two.
 */
const migrationIntakeRoutes = createApiRouter()
    .openapi(createBatchRoute, async (c) => {
        const tenantId = c.get('tenantId');
        // `userId` is not a context variable in this app; the verified JWT
        // payload is, and the subject is its `sub`.
        const userId = c.get('user').sub;
        const profile = c.var.profile;
        const limits = limitsFor(profile);

        const form = c.req.valid('form');
        const intent = form.intent;
        await assertIntentAllowed(c, intent);

        if (form.uploadAuthorized !== 'true') {
            throw Errors.BadRequest('The file can only be kept with your agreement, and this upload did not carry it.');
        }
        const staffAccessAuthorized = form.staffAccessAuthorized === 'true';

        const file = (await c.req.formData()).get('file');
        if (!(file instanceof File)) throw Errors.BadRequest('Attach the file you exported.');
        const text = await file.text();
        if (!text.trim()) throw Errors.BadRequest('That file is empty.');

        const ext = extForFileName(file.name);
        assertSourceSizeWithin(limits, ext, new TextEncoder().encode(text).length);

        const source = { fileName: file.name, text };
        const stage = new MigrationStageService(c.env.DB);
        const files = new MigrationSourceFileService(c.env.PHOTOS);
        const now = new Date();

        /**
         * The id the stored object is filed under.
         *
         * Its own id, not the run's. The run does not exist yet — the staging
         * service mints that id as it writes the row — and a batch has to carry
         * the key from its FIRST write, because a row that names no file is a
         * run nothing can resume and the sweep cannot delete by key. Nothing
         * rebuilds this key from a batch id: every reader takes it off
         * `migration_batches.source_key`, which is where the tie between the two
         * actually lives.
         */
        const sourceId = crypto.randomUUID();

        /**
         * Runs a write that the stored object only makes sense alongside, and
         * takes the object back out if it refuses.
         *
         * Leaving it for the sweep instead would retain a third party's file
         * under an authorisation given for a run that does not exist.
         */
        const withStoredFile = async <T>(write: (sourceKey: string) => Promise<T>): Promise<T> => {
            const sourceKey = await files.put(tenantId, sourceId, ext, text);
            try {
                return await write(sourceKey);
            } catch (err) {
                await files.remove([sourceKey]);
                throw err;
            }
        };

        /**
         * Nothing here can read it. On a deployment with a support path the run
         * waits; on one without, it is refused BEFORE the file is stored —
         * keeping a third party's personal data we can do nothing with has no
         * reason behind it.
         */
        const openWaitingRun = async () => {
            if (!profile.hasAssistedMigration) {
                throw Errors.UnprocessableEntity(
                    `Nothing here can read that file, so it has not been kept. This import accepts ${SUPPORTED_SOURCES.join(', or ')}.`,
                );
            }
            if (!staffAccessAuthorized) {
                throw Errors.UnprocessableEntity(
                    'Nothing here can read that file. It can be converted by a person, which needs your '
                    + 'agreement for somebody to open it — the file has not been kept in the meantime. '
                    + `This import otherwise accepts ${SUPPORTED_SOURCES.join(', or ')}.`,
                );
            }
            const created = await withStoredFile((sourceKey) => stage.createAssistanceBatch({
                tenantId,
                createdBy: userId,
                intent,
                targetId: form.targetId ?? null,
                sourceKey,
                expiresAt: expiryFor(true, now),
                uploadAuthorizedBy: userId,
                staffAccessAuthorizedBy: userId,
            }));
            return c.json({
                success: true as const,
                data: {
                    batchId: created.batchId,
                    status: MIGRATION_BATCH_STATUS.NEEDS_ASSISTANCE,
                    needsAssistance: true,
                },
            }, 201);
        };

        // Asked before the adapters are, and not by them: this entry point
        // exists for a file nobody could classify, so letting it guess would be
        // the inference every other entry point is built to avoid.
        if (intent === 'assisted.full') return openWaitingRun();

        const match = matchAdapter(intent, source);
        if (!match) return openWaitingRun();

        const built = buildBundle(match.vendor, source, defaultMappingFor(intent, match.inspection, source));
        if (!built.ok) throw Errors.UnprocessableEntity(built.error.message);

        const staged = await withStoredFile((sourceKey) => stage.stage({
            tenantId,
            createdBy: userId,
            intent,
            targetId: form.targetId,
            bundle: built.bundle,
            limits,
            sourceKey,
            expiresAt: expiryFor(false, now),
            uploadAuthorizedBy: userId,
        }));
        return c.json({
            success: true as const,
            data: {
                batchId: staged.batchId,
                status: MIGRATION_BATCH_STATUS.STAGED,
                needsAssistance: false,
            },
        }, 201);
    })
    .openapi(listBatchesRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { limit } = c.req.valid('query');
        const db = getDrizzle(c);
        const rows = await db.select({
            id: migrationBatches.id,
            intent: migrationBatches.intent,
            vendor: migrationBatches.vendor,
            status: migrationBatches.status,
            createdAt: migrationBatches.createdAt,
            expiresAt: migrationBatches.expiresAt,
        })
            .from(migrationBatches)
            .where(eq(migrationBatches.tenantId, tenantId))
            .orderBy(desc(migrationBatches.createdAt))
            .limit(limit ?? 50)
            .all();
        return c.json({
            success: true as const,
            data: {
                items: rows.map((r) => ({
                    id: r.id,
                    intent: r.intent,
                    vendor: r.vendor,
                    status: r.status,
                    createdAt: r.createdAt.toISOString(),
                    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
                })),
            },
        }, 200);
    })
    .openapi(getBatchRoute, async (c) => {
        const { batchId } = c.req.valid('param');
        const { page, pageSize } = c.req.valid('query');
        const report = new MigrationReportService(c.env.DB);
        const data = await report.build({
            // The verified tenant, never one named in the request: this id is
            // the whole of the scoping on a report that reads staged entries.
            tenantId: c.get('tenantId'),
            batchId,
            page,
            pageSize,
            seatQuotaEnforced: c.var.profile.hasSeatQuota,
        });
        return c.json({ success: true as const, data }, 200);
    });

export type MigrationIntakeApi = typeof migrationIntakeRoutes;
export default migrationIntakeRoutes;

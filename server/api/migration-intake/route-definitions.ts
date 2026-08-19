/**
 * The import-run routes as SHAPES — method, path, role floor, and what each one
 * answers with. No behaviour.
 *
 * Split from server/api/migration-intake.ts as pure movement, the same way
 * repair-builder/crud-routes.ts is split from repair-builder.ts. The handlers
 * stay chained onto the single router in the parent module, so every path,
 * method and the exported `MigrationIntakeApi` type are unchanged — and, more
 * to the point, the per-intent gate the handlers share stays module-private
 * over there rather than becoming an export that anything could reach.
 *
 * Nine routes, one prefix: a run can carry templates, contacts or team members,
 * so filing any of them under a per-entity prefix would hide it from readers of
 * the other two.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import {
    ApplyRequestSchema,
    AssistanceRequestSchema,
    IntakeBatchParamsSchema,
    IntakeListQuerySchema,
    IntakeReportQuerySchema,
    IntakeRowParamsSchema,
    IntakeUploadFormSchema,
    RemapRequestSchema,
    RepairRowRequestSchema,
} from '../../lib/validations/migration-intake.schema';

export const createBatchRoute = createRoute(withMcpMetadata({
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

export const listBatchesRoute = createRoute(withMcpMetadata({
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

export const getBatchRoute = createRoute(withMcpMetadata({
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

export const remapRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/{batchId}/mapping',
    tags: ['imports'],
    summary: 'Change which column feeds which field',
    description: 'Re-reads the file this run was created from, rebuilds every entry with the given column mapping, and replaces the run entries. Allowed only while the run is still being prepared, and it discards any correction made since the last mapping — the count of what it replaced is returned so that can be said out loud.',
    middleware: [requireRole('owner', 'manager')] as const,
    request: {
        params: IntakeBatchParamsSchema,
        body: { content: { 'application/json': { schema: RemapRequestSchema } } },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true),
                        data: z.object({
                            rowCount: z.number().describe('How many entries the new mapping produced'),
                            replacedRowCount: z.number().describe('How many entries it threw away, every one of which is gone'),
                        }),
                    }),
                },
            },
            description: 'Run rebuilt from the new mapping',
        },
        404: { description: 'No such import run in this workspace' },
        409: { description: 'The run is no longer being prepared, or its file is gone' },
    },
    operationId: 'remapImportRun',
}, { scopes: ['write'], tier: 'extended' }));

export const repairRowRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/{batchId}/rows/{rowId}',
    tags: ['imports'],
    summary: 'Correct one entry of an import run',
    description: 'Writes a corrected entry back in place and recomputes whether it clashes with anything. A still-incomplete correction is saved anyway, and what remains wrong is returned.',
    middleware: [requireRole('owner', 'manager')] as const,
    request: {
        params: IntakeRowParamsSchema,
        body: { content: { 'application/json': { schema: RepairRowRequestSchema } } },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true),
                        data: z.object({
                            resolved: z.boolean().describe('Whether this entry can now be imported as it stands'),
                            problem: z.unknown().nullable().describe('What is still wrong with the entry, or null when nothing is'),
                        }),
                    }),
                },
            },
            description: 'Entry corrected',
        },
        404: { description: 'No such import run in this workspace, or no such entry in it' },
        409: { description: 'The run is no longer being prepared' },
    },
    operationId: 'repairImportRunEntry',
}, { scopes: ['write'], tier: 'extended' }));

export const applyRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{batchId}/apply',
    tags: ['imports'],
    summary: 'Apply a prepared import run',
    description: 'Writes every prepared entry to its real table, settling clashes by the chosen policy, and sends any invitations the run created. Resumable: pressing it again finishes a run that stopped part way, without repeating what already landed. Invitation delivery is reported as two numbers rather than folded into success, because a message that did not go out does not take its invitation back.',
    middleware: [requireRole('owner', 'manager')] as const,
    request: {
        params: IntakeBatchParamsSchema,
        body: { content: { 'application/json': { schema: ApplyRequestSchema } } },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true),
                        data: z.object({
                            status: z.string().describe('Lifecycle state the run finished in'),
                            applied: z.number().describe('Entries written to a real table'),
                            skipped: z.number().describe('Entries deliberately left alone'),
                            failed: z.number().describe('Entries that could not be written, each carrying its reason'),
                            invitesSent: z.number().describe('Invitation emails that went out'),
                            invitesFailed: z.number().describe('Invitations created whose email could not be delivered; the invitation and its seat still stand, and resending is a team-page action'),
                        }),
                    }),
                },
            },
            description: 'Run applied',
        },
        402: { description: 'Not enough seats for the people this run would invite' },
        404: { description: 'No such import run in this workspace' },
        409: { description: 'The run is already being applied, or has been applied' },
    },
    operationId: 'applyImportRun',
}, { scopes: ['write'], tier: 'extended' }));

export const revertRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{batchId}/revert',
    tags: ['imports'],
    summary: 'Undo an applied import run',
    description: 'Takes back everything this run created or replaced, entry by entry. An entry that cannot be taken back does not stop the others; each refusal is named with its reason.',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { params: IntakeBatchParamsSchema },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true),
                        data: z.object({
                            status: z.string().describe('Lifecycle state the run finished in'),
                            reverted: z.number().describe('Entries taken back'),
                            refused: z.array(z.unknown()).describe('Entries that could not be taken back, each with the reason'),
                        }),
                    }),
                },
            },
            description: 'Run undone',
        },
        400: { description: 'The run was never applied, or has already been undone' },
        404: { description: 'No such import run in this workspace' },
    },
    operationId: 'revertImportRun',
}, { scopes: ['write'], tier: 'extended' }));

export const assistanceRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{batchId}/assistance',
    tags: ['imports'],
    summary: 'Allow a person to convert this file',
    description: 'Records agreement for somebody on the support side to open the uploaded file and convert it, together with the version of the wording that agreement was given under.',
    middleware: [requireRole('owner', 'manager')] as const,
    request: {
        params: IntakeBatchParamsSchema,
        body: { content: { 'application/json': { schema: AssistanceRequestSchema } } },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true),
                        data: z.object({ status: z.string().describe('Lifecycle state the run is now in') }),
                    }),
                },
            },
            description: 'Agreement recorded',
        },
        403: { description: 'Only an owner can give this agreement' },
        404: { description: 'No such import run in this workspace' },
        409: { description: 'This run is not waiting for anybody to convert it' },
    },
    operationId: 'authoriseImportRunAssistance',
}, { scopes: ['write'], tier: 'extended' }));

export const abandonRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/{batchId}',
    tags: ['imports'],
    summary: 'Abandon an import run and its file',
    description: 'Deletes a run that was never applied, together with its prepared entries and the file it was created from. A run that has been applied cannot be deleted, because its entries are the only record of where the imported rows came from.',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { params: IntakeBatchParamsSchema },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true),
                        data: z.object({ deleted: z.literal(true).describe('The run and its file are gone') }),
                    }),
                },
            },
            description: 'Run abandoned',
        },
        404: { description: 'No such import run in this workspace' },
        409: { description: 'The run has been applied and cannot be deleted' },
    },
    operationId: 'abandonImportRun',
}, { scopes: ['write'], tier: 'extended' }));

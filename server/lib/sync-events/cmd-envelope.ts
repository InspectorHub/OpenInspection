import { z } from 'zod';

/**
 * Consumer-side contract for the portal -> core COMMAND seam (A-21 batch 1).
 * Mirror of the sync seam's tolerant-reader rules (see envelope.ts in this
 * directory): stable `type`, `dataschema` carries the version, unknown
 * type/version PARKS (never 400s/retries). Lives in lib/sync-events (outside
 * server/portal/) for the same isolation-gate reason as envelope.ts.
 * `tenantseq` is REQUIRED: the per-tenant monotonic sequence used by the
 * stale-command guard (`tenants.applied_cmd_seq`).
 */

const KNOWN_CMD_TYPES: Record<string, readonly string[]> = {
    'io.inspectorhub.cmd.tenant.update': ['cmd-tenant-update/v1'],
    'io.inspectorhub.cmd.tenant.sync_quota': ['cmd-tenant-sync-quota/v1'],
    'io.inspectorhub.cmd.tenant.seed_starter_content': ['cmd-tenant-seed-starter-content/v1'],
    // A-21 batch 3 — offboarding data plane.
    'io.inspectorhub.cmd.tenant.data_export': ['cmd-tenant-data-export/v1'],
    'io.inspectorhub.cmd.tenant.purge': ['cmd-tenant-purge/v1'],
};

const cmdEnvelopeSchema = z.object({
    specversion: z.literal('1.0'),
    id: z.string().min(1),
    type: z.string().min(1),
    source: z.string().min(1),
    time: z.string().min(1),
    dataschema: z.string().min(1),
    tenantseq: z.number().int().nonnegative(),
    // A-21 batch 2 (additive-optional — no dataschema bump):
    /** Producer wants a `reply.tenant.updated` routed here (`wf:onboarding:<id>`). */
    replyto: z.string().optional(),
    /** Credential-stream sequence; present ONLY on credential-bearing commands.
     *  Guarded by `tenants.applied_cred_seq` (a stale credential never
     *  overwrites a newer one). Absent = legacy in-flight → apply unguarded. */
    credseq: z.number().int().positive().optional(),
    data: z.record(z.string(), z.unknown()),
});
export type CmdEnvelope = z.infer<typeof cmdEnvelopeSchema>;

/** Per-type data validation (appliers call these — invalid data throws there,
 *  exhausts retries, and surfaces as a `failed` outbox row on portal). */
export const cmdTenantUpdateDataSchema = z.object({
    tenantId: z.string(),
    slug: z.string(),
    status: z.string(),
    tier: z.string().optional(),
    name: z.string().optional(),
    maxUsers: z.number().optional(),
    adminEmail: z.string().optional(),
    adminPasswordHash: z.string().optional(),
});
export const cmdSyncQuotaDataSchema = z.object({
    tenantId: z.string(),
    maxUsers: z.number(),
});
export const cmdSeedStarterContentDataSchema = z.object({
    tenantId: z.string(),
});
/** A-21 batch 3 — export straight into the shared EXPORTS_BUCKET. The r2Key is
 *  allocated by the portal workflow (stable across step retries) so a re-sent
 *  command overwrites the same object — idempotent. */
export const cmdDataExportDataSchema = z.object({
    tenantId: z.string(),
    r2Key: z.string(),
});
export const cmdPurgeDataSchema = z.object({
    tenantId: z.string(),
});

export function parseCmdEnvelope(json: unknown): CmdEnvelope | null {
    let candidate: unknown = json;
    if (typeof candidate === 'string') {
        try { candidate = JSON.parse(candidate); } catch { return null; }
    }
    const result = cmdEnvelopeSchema.safeParse(candidate);
    return result.success ? result.data : null;
}

export function isKnownCmd(type: string, dataschema: string): boolean {
    const versions = KNOWN_CMD_TYPES[type];
    return versions !== undefined && versions.includes(dataschema);
}

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

export const KNOWN_CMD_TYPES: Record<string, readonly string[]> = {
    'io.inspectorhub.cmd.tenant.update': ['cmd-tenant-update/v1'],
    'io.inspectorhub.cmd.tenant.sync_quota': ['cmd-tenant-sync-quota/v1'],
};

export const cmdEnvelopeSchema = z.object({
    specversion: z.literal('1.0'),
    id: z.string().min(1),
    type: z.string().min(1),
    source: z.string().min(1),
    time: z.string().min(1),
    dataschema: z.string().min(1),
    tenantseq: z.number().int().nonnegative(),
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

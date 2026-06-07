import { openSecrets, sealSecrets, unwrapDek, wrapDek } from './config-crypto';

export interface SecretsRow { tenantId: string; blob: string; dekEnc: string | null }
export interface SecretsStore {
    listRows(): Promise<SecretsRow[]>;
    updateRow(tenantId: string, patch: { blob?: string; dekEnc?: string }): Promise<void>;
    bustCache(tenantId: string): Promise<void>;
}
export interface ReencryptReport {
    migrated: number;       // legacy → envelope (blob + dek written)
    rewrapped: number;      // DEK re-wrapped under current KEK (blob untouched)
    alreadyCurrent: number;
    failed: { tenantId: string; reason: string }[];
}

/**
 * JWT_SECRET rotation / legacy-format convergence. Idempotent: run any number
 * of times; converged rows land in alreadyCurrent. SOP:
 * docs/saas-ops/jwt-secret-rotation-sop.md (superrepo).
 */
export async function reencryptAllTenantSecrets(
    store: SecretsStore,
    jwtSecret: string,
    previousJwtSecret?: string,
): Promise<ReencryptReport> {
    const report: ReencryptReport = { migrated: 0, rewrapped: 0, alreadyCurrent: 0, failed: [] };
    for (const row of await store.listRows()) {
        try {
            if (row.blob.startsWith('v2:') && row.dekEnc) {
                try {
                    await unwrapDek(row.dekEnc, row.tenantId, jwtSecret);
                    report.alreadyCurrent++;
                    continue;
                } catch { /* not under current KEK — try previous */ }
                if (!previousJwtSecret) throw new Error('DEK does not unwrap with current secret and JWT_SECRET_PREVIOUS is not set');
                const dek = await unwrapDek(row.dekEnc, row.tenantId, previousJwtSecret);
                const dekEnc = await wrapDek(dek, row.tenantId, jwtSecret);
                await store.updateRow(row.tenantId, { dekEnc });
                report.rewrapped++;
            } else {
                const data = await openSecrets(row.blob, row.dekEnc, row.tenantId, jwtSecret, previousJwtSecret);
                const sealed = await sealSecrets(data, row.tenantId, jwtSecret);
                await store.updateRow(row.tenantId, { blob: sealed.blob, dekEnc: sealed.dekEnc });
                report.migrated++;
            }
            await store.bustCache(row.tenantId);
        } catch (err) {
            report.failed.push({ tenantId: row.tenantId, reason: err instanceof Error ? err.message : String(err) });
        }
    }
    return report;
}

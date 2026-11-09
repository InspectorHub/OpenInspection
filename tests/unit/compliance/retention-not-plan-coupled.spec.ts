/**
 * Retention sweeps run on the clocks in `retention-windows.ts` and on nothing else: the plan a company is on
 * (or was on) never moves a deletion date.
 *
 * Two halves. (1) No code on the retention path reads the plan, the tier or a billing state. (2) The retention
 * windows that decide how long history survives are pinned, so changing one is a decision made in this diff and
 * not a side effect of a refactor.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    AUDIT_LOG_ANONYMIZE_MONTHS, REPORT_VERSION_RETENTION_MONTHS, REPORT_PDF_DEFAULT_RETENTION_MONTHS,
    NOTIFICATION_RETENTION_MONTHS, AI_ASSURANCE_RETENTION_MONTHS, DESTRUCTION_RECORD_RETENTION_MONTHS,
} from '../../../server/lib/compliance/retention-windows';

const RETENTION_FILES = [
    ...fs.readdirSync('server/lib/compliance').filter((f) => f.endsWith('.ts')).map((f) => `server/lib/compliance/${f}`),
    'server/cron/jobs/agreements.ts',
    'server/cron/jobs/daily.ts',
    'server/cron/jobs/media.ts',
];

const PLAN_OR_BILLING = /plan-quota|\bisPaidPlan\b|\breadTenantTier\b|\breadTenantPlan\b|\btenantTier\b|\btenants\.tier\b|\.tier\b|\bPlanQuotaGuard\b|\bFREE_TIER|billing_?status|billingStatus|billing_?subscription|\bmaxUsers\b|\bmax_users\b/i;

function code(file: string): string {
    return fs.readFileSync(path.normalize(file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .filter((l) => !l.trim().startsWith('//'))
        .join('\n');
}

describe('retention is not coupled to the plan', () => {
    it('scans a real set of retention files (both numbers print)', () => {
        const existing = RETENTION_FILES.filter((f) => fs.existsSync(f));
        console.info(`[retention-not-plan-coupled] scanned ${existing.length} of ${RETENTION_FILES.length} retention files`);
        expect(existing).toEqual(RETENTION_FILES);
        expect(existing.length).toBeGreaterThan(20);
    });

    it('no retention file reads the plan, the tier, the seat limit or a billing state', () => {
        const hits = RETENTION_FILES.filter((f) => PLAN_OR_BILLING.test(code(f)));
        expect(
            hits,
            `Retention code must not depend on the plan: ${hits.join(', ')}. A company whose paid plan ended keeps its `
            + 'history, so no deletion date may move with the tier or a billing state. Remove the plan read from the retention path.',
        ).toEqual([]);
    });

    it('the detector fires on a plan read (so the scan above is not blind)', () => {
        for (const sample of ['readTenantTier(db, id)', 'row.tier === "free"', 'tenants.tier', 'billingStatus', 'isPaidPlan(p)']) {
            expect(PLAN_OR_BILLING.test(sample), sample).toBe(true);
        }
    });
});

describe('retention windows that bound how long history survives are pinned', () => {
    it('keeps the windows as decided (changing one is a decision, made in this diff)', () => {
        expect({
            report_versions_months: REPORT_VERSION_RETENTION_MONTHS,
            report_pdfs_months: REPORT_PDF_DEFAULT_RETENTION_MONTHS,
            audit_logs_months: AUDIT_LOG_ANONYMIZE_MONTHS,
            notifications_months: NOTIFICATION_RETENTION_MONTHS,
            ai_assurance_months: AI_ASSURANCE_RETENTION_MONTHS,
            destruction_records_months: DESTRUCTION_RECORD_RETENTION_MONTHS,
        }).toEqual({
            report_versions_months: 84,
            report_pdfs_months: 84,
            audit_logs_months: 36,
            notifications_months: 24,
            ai_assurance_months: 36,
            destruction_records_months: 36,
        });
    });

    it('keeps the signed-agreement default at six years, in the sweep and in the setting it falls back to', () => {
        expect(code('server/cron/jobs/agreements.ts')).toMatch(/coalesce\(\$\{tenantConfigs\.agreementRetentionYears\}, 6\)/);
        expect(code('server/api/admin/admin-settings.ts')).toMatch(/agreementRetentionYears: config\?\.agreementRetentionYears \?\? 6,/);
    });
});

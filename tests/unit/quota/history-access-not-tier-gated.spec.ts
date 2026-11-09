/**
 * Reading, downloading and exporting stored records must not depend on the tenant's plan.
 *
 * A tenant whose paid plan ended (tier 'free') keeps viewing and downloading its history. The plan only
 * decides what a tenant may CREATE or SEND, and which backend takes a NEW video. This test lists every file
 * that touches the plan (the tier column, the plan-quota feature, the paying-plan predicate) and the one reason
 * each may. A new file that reads the plan fails here until its author registers it, and a registration under
 * a read, download or export surface fails regardless.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

type Kind = 'create' | 'send' | 'ai' | 'video-new' | 'display' | 'routing' | 'portal-sync' | 'definition';

/** file (repo relative) -> why it may read the plan. */
const ALLOWED: Record<string, Kind> = {
    // The plan-quota feature itself.
    'server/features/plan-quota/policy.ts': 'definition',
    'server/features/plan-quota/guard.ts': 'definition',
    'server/features/plan-quota/month-usage.ts': 'display',
    'server/features/plan-quota/notice.ts': 'display',
    // Creating records counts against the monthly allowance.
    'server/api/inspections/create-support.ts': 'create',
    'server/services/booking.service.ts': 'create',
    'server/services/booking/fulfill-booking.ts': 'create',
    'server/services/concierge.service.ts': 'create',
    'server/services/inspection-request.service.ts': 'create',
    'server/services/inspection.service.ts': 'create',
    'server/services/inspection/inspection-core.service.ts': 'create',
    'server/services/inspection/inspection-create-variants.service.ts': 'create',
    'server/services/inspection/inspection-reinspection.service.ts': 'create',
    // Sending built-in email or text counts against the monthly allowance.
    'server/api/inspections/send-sms.ts': 'send',
    'server/api/message-templates.ts': 'send',
    'server/api/sms.ts': 'send',
    'server/cron/jobs/automation.ts': 'send',
    'server/lib/email/build-email-service.ts': 'send',
    'server/lib/email/tenant-email-resolver.ts': 'send',
    'server/lib/email-templates/catalog/system.ts': 'send',
    'server/lib/sms/send-gate.ts': 'send',
    'server/services/automation/delivery.ts': 'send',
    'server/services/automation/send-one-sms.ts': 'send',
    'server/services/automation/shared.ts': 'send',
    'server/services/automation/sms.ts': 'send',
    'server/services/email/transactional.ts': 'send',
    'server/workflows/sign-completion-email.ts': 'send',
    // Platform-funded AI.
    'server/lib/ai/build-ai-service.ts': 'ai',
    'server/lib/ai/metering.ts': 'ai',
    'server/portal/ai-provisioning.ts': 'ai',
    // Which backend takes a NEW video upload.
    'server/services/video/resolve.ts': 'video-new',
    // Showing the plan to the tenant.
    'server/api/billing.ts': 'display',
    'server/api/session-context.ts': 'display',
    'server/api/usage.ts': 'display',
    'server/portal/usage-report.ts': 'display',
    // Carrying the plan along a request, or applying a sync from the control plane.
    'server/features/tenant-routing/resolve-by-fixed-tenant.ts': 'routing',
    'server/features/tenant-routing/resolve-by-inspection-id.ts': 'routing',
    'server/features/tenant-routing/resolve-by-path-param.ts': 'routing',
    'server/lib/middleware/di.ts': 'routing',
    'server/types/auth.ts': 'routing',
    'server/portal/apply-commands.ts': 'portal-sync',
};

/** Surfaces that read, download or export stored records. None may read the plan. */
const HISTORY_SURFACES: RegExp[] = [
    /^server\/api\/public-/,
    /^server\/api\/admin\/admin-data\.ts$/,
    /^server\/api\/inspections\/(report|pdf|export|download|compliance|media)/,
    /(^|\/)report-[^/]*\.ts$/,
    /^server\/services\/(report|data-export|portal-access)/,
    /^server\/lib\/compliance\//,
    /^server\/cron\/jobs\/(agreements|daily|media)\.ts$/,
];

const PLAN_READ = /features\/plan-quota|\bisPaidPlan\b|\breadTenantTier\b|\breadTenantPlan\b|\btenantTier\b|\btenants\.tier\b|\bPlanQuotaGuard\b|\bFREE_TIER_CAPS\b/;

function stripLeadingComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .filter((l) => !l.trim().startsWith('//'))
        .join('\n');
}

function walk(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); continue; }
        if (!/\.(ts|tsx)$/.test(e.name) || /\.(test|spec)\.tsx?$/.test(e.name) || e.name.endsWith('.d.ts')) continue;
        out.push(p.split(path.sep).join('/'));
    }
    return out;
}

const allFiles = [...walk('server'), ...walk('app')];
const readers = allFiles.filter((f) => PLAN_READ.test(stripLeadingComments(fs.readFileSync(f, 'utf8')))).sort();
const onSurface = (f: string) => HISTORY_SURFACES.some((re) => re.test(f));

describe('history access is not tier gated', () => {
    it('scanned a real tree and found the plan readers (both numbers print)', () => {
        console.info(`[history-access] scanned ${allFiles.length} files, ${readers.length} read the plan, ${Object.keys(ALLOWED).length} registered`);
        expect(allFiles.length).toBeGreaterThan(500);
        expect(readers.length).toBeGreaterThan(30);
    });

    it('every file that reads the plan is registered with its reason', () => {
        const unregistered = readers.filter((f) => !(f in ALLOWED));
        expect(
            unregistered,
            `These files read the tenant plan but are not registered: ${unregistered.join(', ')}.\n`
            + 'A tenant whose paid plan ended must keep viewing, downloading and exporting its history, so a read, '
            + 'download or export path must never depend on the plan. If this file creates, sends, calls AI, picks a '
            + 'backend for a NEW video or only displays the plan, add it to ALLOWED in this spec with that kind. '
            + 'If it serves stored records, remove the plan read instead.',
        ).toEqual([]);
    });

    it('no registered file is stale', () => {
        const stale = Object.keys(ALLOWED).filter((f) => !readers.includes(f));
        expect(stale, `Registered but no longer reading the plan (remove from ALLOWED): ${stale.join(', ')}`).toEqual([]);
    });

    it('no read, download or export surface is registered or reads the plan', () => {
        expect(Object.keys(ALLOWED).filter(onSurface)).toEqual([]);
        expect(readers.filter(onSurface)).toEqual([]);
    });

    it.each(HISTORY_SURFACES.map((re) => [String(re), re] as const))(
        'the surface pattern %s matches real files (so the check above is not vacuous)',
        (_name, re) => {
            expect(allFiles.filter((f) => re.test(f)).length).toBeGreaterThan(0);
        },
    );

    it('every registered kind is one of the known reasons', () => {
        const kinds: Kind[] = ['create', 'send', 'ai', 'video-new', 'display', 'routing', 'portal-sync', 'definition'];
        for (const [f, k] of Object.entries(ALLOWED)) expect(kinds, f).toContain(k);
    });
});

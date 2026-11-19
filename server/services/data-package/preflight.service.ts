/**
 * Import preflight service (J2b).
 *
 * Read-only: inspects the package's declared metadata against the target
 * workspace and decides ok/blocked, estimates D1 writes and days, decides
 * whether keep-ids is available, and formulates the questions the server cannot
 * answer itself (paid plan, CPU budget). No package row is written here; the
 * client records the owner's answers and replays them on apply.
 *
 * Tenant scoping: the target tenant id comes from the verified job, never from
 * the package. The package's sourceTenantId is used only for the keep-ids
 * precondition comparison, never to select data.
 */
import { eq, sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../lib/db/scoped';
import { tenants, inspections } from '../../lib/db/schema';
import { NO_STARTER_CONTENT, STARTER_CONTENT_VERSION } from '../starter-content/content-version';
import {
    assertNotNewer, classifyFingerprint, upgradePath, type FingerprintClass,
} from '../../lib/data-package/upgraders';

/** The profile fields preflight needs (a subset of DeploymentProfile for testability). */
interface PreflightProfile {
    mode: 'standalone' | 'saas';
    fixedTenantId: string | null;
    importMaxRows: number;
    hasBilling: boolean;
    hasUsageQuota: boolean;
}

export interface PreflightInput {
    formatVersion: number;
    columnFingerprint: string;
    schemaVersion: string;
    sourceTenantId: string;
    sourceMode: 'standalone' | 'saas';
    counts: Record<string, number>;
    /** Owner answers to server-undetectable questions, replayed from the job. */
    answers?: Record<string, string>;
    /** Lenient preview: unknown shapes are reported as reasons but do not block. */
    lenient?: boolean;
}

export interface PreflightQuestion {
    id: string;
    prompt: string;
}

interface PreflightEstimate {
    rows: number;
    writes: number;
    days: number;
}

export interface PreflightResult {
    ok: boolean;
    reasons: string[];
    /** Non-blocking notes (e.g. cross-mode settings filtering) shown in preview. */
    advisories: string[];
    keepIds: boolean;
    estimate: PreflightEstimate;
    questions: PreflightQuestion[];
    fingerprintClass: FingerprintClass;
    answers: Record<string, string>;
}

export interface PreflightDeps {
    now: () => number;
    profile: PreflightProfile;
    schemaFingerprint: () => Promise<string>;
}

/** One imported source row costs roughly 6 D1 writes (row + indexes + id-map). */
const WRITES_PER_ROW = 6;
/** Free-tier D1 daily write ceiling; a paid plan has no such daily cap. */
const FREE_DAILY_WRITES = 100_000;

export class DataPackagePreflightService {
    constructor(
        private readonly db: DrizzleDB,
        private readonly deps: PreflightDeps,
    ) {}

    /** True when the target has only starter content and no data of its own. */
    private async isBlankTarget(tenantId: string): Promise<boolean> {
        const row = await this.db.select({ contentVersion: tenants.contentVersion })
            .from(tenants).where(eq(tenants.id, tenantId)).limit(1).get();
        if (!row) return false;
        if (row.contentVersion !== NO_STARTER_CONTENT && row.contentVersion !== STARTER_CONTENT_VERSION) {
            return false; // unstamped/older workspace — may hold real data
        }
        // Representative business table: the target must have no inspections of
        // its own. The package may contain many; those are not in the target yet.
        const counted = await this.db.select({ n: sql<number>`count(*)` })
            .from(inspections).where(eq(inspections.tenantId, tenantId)).get();
        return Number(counted?.n ?? 0) === 0;
    }

    /** Questions for things the server cannot detect in this deployment mode. */
    private questions(): PreflightQuestion[] {
        const out: PreflightQuestion[] = [];
        // On SaaS the plan is known from the tenant row at apply time; preflight
        // still asks when the caller has not declared it, so the answer travels
        // with the job and is auditable.
        if (this.deps.profile.mode === 'standalone' || !this.deps.profile.hasBilling) {
            out.push({ id: 'paid_plan', prompt: 'Is the target workspace on a paid plan?' });
        }
        out.push({ id: 'cpu_budget', prompt: 'Does the target allow more than the free-tier per-request CPU budget?' });
        return out;
    }

    async run(tenantId: string, input: PreflightInput): Promise<PreflightResult> {
        const reasons: string[] = [];
        const advisories: string[] = [];

        // A package made in one deployment mode may be imported into another,
        // but its settings are filtered to the TARGET mode's allowlist on apply.
        if (input.sourceMode !== this.deps.profile.mode) {
            advisories.push(this.deps.profile.mode === 'saas'
                ? 'package was exported in standalone mode; only settings valid in the hosted target will be kept (others reported as dropped)'
                : 'package was exported in hosted mode; settings are filtered to this self-hosted target');
        }
        // 1. Layout version: refuse newer, ensure a registered path if older.
        try {
            assertNotNewer(input.formatVersion);
        } catch (e) {
            reasons.push(e instanceof Error ? e.message : 'format version rejected');
        }
        try {
            upgradePath(input.formatVersion, 1); // FORMAT_VERSION
        } catch (e) {
            // Same-version is a no-op; an older version needs a real upgrader.
            if (input.formatVersion < 1) reasons.push(e instanceof Error ? e.message : 'no upgrade path');
        }

        // 2. Fingerprint: current / known-old / unknown.
        const current = await this.deps.schemaFingerprint();
        const fingerprintClass = classifyFingerprint(input.columnFingerprint, current);
        if (fingerprintClass === 'unknown') {
            reasons.push('package schema fingerprint is unknown (refuse unless lenient preview accepts each unknown column)');
        } else if (fingerprintClass === 'known-old') {
            reasons.push('package uses a known older column set; an upgrader path is required before apply');
        }

        // 3. Cap on declared rows.
        const rows = Object.values(input.counts).reduce((a, b) => a + (Number.isFinite(b) && b >= 0 ? b : 0), 0);
        if (rows > this.deps.profile.importMaxRows) {
            reasons.push(`package declares ${rows} rows, above this workspace's import cap of ${this.deps.profile.importMaxRows}`);
        }

        // 4. keep-ids precondition: blank target whose configured id equals source.
        const blank = await this.isBlankTarget(tenantId);
        const keepIds = blank && this.deps.profile.fixedTenantId !== null
            && this.deps.profile.fixedTenantId === input.sourceTenantId;

        // 5. Estimate.
        const writes = rows * WRITES_PER_ROW;
        const days = this.deps.profile.hasUsageQuota
            ? 1
            : Math.max(1, Math.ceil(writes / FREE_DAILY_WRITES));

        const questions = this.questions();
        const answers = { ...(input.answers ?? {}) };

        if (input.lenient && fingerprintClass === 'unknown') {
            // Lenient preview: drop the unknown-shape blocking reason and replace
            // it with an advisory. The advisory is reported but never blocks.
            const filtered = reasons.filter((r) => !/fingerprint is unknown|unknown shape/i.test(r));
            return {
                ok: filtered.length === 0,
                reasons: [...filtered, 'lenient preview: unknown columns are reported, not applied — apply still requires a known shape'],
                advisories, keepIds, estimate: { rows, writes, days }, questions, fingerprintClass, answers,
            };
        }

        return {
            ok: reasons.length === 0,
            reasons, advisories, keepIds, estimate: { rows, writes, days }, questions, fingerprintClass, answers,
        };
    }
}

/**
 * Design System 0520 subsystem D phase 7 task 7.2 — ReportVersionService.
 *
 * snapshot-on-publish:
 *   - read inspections row + inspection_results.data + inspection_units
 *   - serialise into a single JSON blob (≤ 1 MB enforced here)
 *   - INSERT next-version row keyed by (inspectionId, max(version)+1)
 *
 * Read APIs (list / get / diff) feed the Republish UX + the diff
 * viewer page (task 8.1 — separate commit).
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, desc } from 'drizzle-orm';
import { reports, reportVersions, inspections, inspectionResults, inspectionUnits, users, inspectionInspectors, templates, tenantConfigs } from '../lib/db/schema';
import { computeDiff, SNAPSHOT_SCHEMA_VERSION, type Snapshot, type SnapshotInspector, type DiffPayload } from '../lib/version-diff';
import { CredentialService } from './credential.service';
import { resolveProfile } from '../lib/report-style/resolve';
import { sha256Hex } from '../lib/sha256';
import { SigningKeyService, base64UrlEncode, base64UrlDecode } from './signing-key.service';

const MAX_SNAPSHOT_BYTES = 1024 * 1024;  // 1 MB

export interface SnapshotResult {
    versionNumber: number;
    summary?:      string;
}

type ResultsData = Record<string, Record<string, unknown>>;

function parseResultsData(raw: unknown): ResultsData {
    if (raw == null) return {};
    if (typeof raw === 'string') {
        try { return JSON.parse(raw) as ResultsData; } catch { return {}; }
    }
    return raw as ResultsData;
}

export class ReportVersionService {
    constructor(private db: D1Database, private encryptionSecret: string) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    /**
     * Resolve which report a publish belongs to.
     *
     * Callers that predate multi-report publishing pass only an inspection, and
     * for them the answer is its primary report. Callers that know which
     * deliverable they are publishing pass `reportId` and skip this.
     */
    private async resolveReportId(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db: any, tenantId: string, inspectionId: string, reportId?: string,
    ): Promise<string | null> {
        if (reportId) return reportId;
        const primary = await db.select({ id: reports.id }).from(reports)
            .where(and(
                eq(reports.tenantId, tenantId),
                eq(reports.inspectionId, inspectionId),
                eq(reports.kind, 'primary'),
            ))
            .get();
        return primary?.id ?? null;
    }

    async snapshotOnPublish(
        tenantId: string,
        inspectionId: string,
        publishedBy: string,
        summary?: string,
        reportId?: string,
    ): Promise<SnapshotResult> {
        const db = this.getDrizzle();
        const targetReportId = await this.resolveReportId(db, tenantId, inspectionId, reportId);

        // Version numbers and the prevHash chain are per REPORT, not per
        // inspection. Two reports on one order publish independently — the
        // standard report on Tuesday, radon on Thursday — and interleaving them
        // into one chain fails verification for BOTH, including for versions
        // published before the second report existed.
        const prev = await db.select().from(reportVersions)
            .where(and(
                eq(reportVersions.tenantId, tenantId),
                targetReportId
                    ? eq(reportVersions.reportId, targetReportId)
                    : eq(reportVersions.inspectionId, inspectionId),
            ))
            .orderBy(desc(reportVersions.versionNumber))
            .limit(1)
            .get();
        const nextVersion = (prev?.versionNumber ?? 0) + 1;

        // Read snapshot sources.
        const ins = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!ins) throw new Error('Inspection not found');

        const results = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();
        const data = parseResultsData(results?.data);

        const units = await db.select().from(inspectionUnits)
            .where(and(eq(inspectionUnits.tenantId, tenantId), eq(inspectionUnits.inspectionId, inspectionId)))
            .all();

        const snapshot: Snapshot = {
            schemaVersion: SNAPSHOT_SCHEMA_VERSION,
            inspection: ins as unknown as Record<string, unknown>,
            data,
            units,
            // Spec B §1: report surfaces snapshot credentials + resolved layout
            // at publish; live surfaces read current state. Before this, the
            // report resolved credentials LIVE on every read — so an inspector
            // who left an association silently rewrote the cover of every report
            // they had ever delivered, including ones a client downloaded months
            // earlier and may be relying on.
            inspectors: await this.resolveInspectors(tenantId, inspectionId, ins),
            styleProfile: await this.resolveStyleProfile(tenantId, ins),
        };
        const snapshotJson = JSON.stringify(snapshot);
        if (snapshotJson.length > MAX_SNAPSHOT_BYTES) {
            throw new Error('Snapshot exceeds 1 MB limit');
        }

        const contentHash = await sha256Hex(snapshotJson);
        const prevHash = prev?.contentHash ?? null;

        const signing = new SigningKeyService(this.db, this.encryptionSecret);
        const { privateKey, fingerprint } = await signing.ensureKeypair(tenantId);
        const sigBytes = new Uint8Array(await crypto.subtle.sign(
            { name: 'Ed25519' }, privateKey, new TextEncoder().encode(contentHash),
        ));
        const signature = base64UrlEncode(sigBytes);
        const verificationToken = crypto.randomUUID();

        await db.insert(reportVersions).values({
            id:             crypto.randomUUID(),
            tenantId,
            inspectionId,
            reportId:       targetReportId,
            versionNumber:  nextVersion,
            snapshotJson,
            summary:        summary ?? null,
            publishedAt:    new Date(),
            publishedBy,
            createdAt:      new Date(),
            contentHash,
            prevHash,
            signature,
            keyFingerprint: fingerprint,
            isAmendment:    nextVersion > 1,
            verificationToken,
        });

        return { versionNumber: nextVersion, ...(summary ? { summary } : {}) };
    }

    /**
     * Everyone the report credits, and the credentials they held right now.
     *
     * OPTION A ON THE COVER, A LIST IN THE PAYLOAD. Only the lead's badges are
     * rendered today, matching the report's single inspector name and single
     * signer — a helper holding the certification gets no credit, which is
     * acceptable only while the line reads "Lead inspector". Both are captured
     * here regardless, because deciding otherwise later must not mean migrating
     * every snapshot that already exists.
     *
     * `inspection_inspectors` is where the roster lives; `leadInspectorId` and
     * `helperInspectorIds` survive only as request-payload field names
     * (`schedule.schema.ts`, `wizard.schema.ts`) that get synced into this
     * table on write. When the table holds nothing (older inspections that
     * never synced) the inspection's own `inspectorId` is the lead.
     */
    private async resolveInspectors(
        tenantId: string,
        inspectionId: string,
        ins: Record<string, unknown>,
    ): Promise<SnapshotInspector[]> {
        const db = this.getDrizzle();
        const links = await db.select({ userId: inspectionInspectors.userId, role: inspectionInspectors.role })
            .from(inspectionInspectors)
            .where(and(
                eq(inspectionInspectors.tenantId, tenantId),
                eq(inspectionInspectors.inspectionId, inspectionId),
            )).all();

        const assignments: Array<{ userId: string; role: 'lead' | 'helper' }> = links.length
            ? links.map((l) => ({ userId: l.userId, role: l.role }))
            : (typeof ins.inspectorId === 'string' && ins.inspectorId
                ? [{ userId: ins.inspectorId, role: 'lead' as const }]
                : []);
        if (!assignments.length) return [];

        // Lead first, so a reader of the raw snapshot sees the same order the
        // cover does rather than whatever the link table happened to return.
        assignments.sort((a, b) => (a.role === 'lead' ? -1 : 1) - (b.role === 'lead' ? -1 : 1));

        const credentials = new CredentialService(this.db);
        const out: SnapshotInspector[] = [];
        for (const a of assignments) {
            const u = await db.select({ name: users.name, email: users.email })
                .from(users).where(and(eq(users.id, a.userId), eq(users.tenantId, tenantId))).get();
            out.push({
                userId: a.userId,
                // Never derived from the address: this snapshot is hashed and
                // signed, so an invented name is sealed into the integrity chain.
                name: u?.name ?? null,
                role: a.role,
                // The shared mapper, so the badge URL in a snapshot and the badge
                // URL on the live page cannot disagree about their form.
                credentials: await credentials.listRenderable(tenantId, a.userId),
            });
        }
        return out;
    }

    /**
     * The appearance profile as resolved on publish day.
     *
     * Same three-tier resolution the report read path runs
     * (inspection override -> template default -> tenant default), captured so a
     * tenant switching their house style later does not restyle documents that
     * were already delivered.
     */
    private async resolveStyleProfile(
        tenantId: string,
        ins: Record<string, unknown>,
    ): Promise<Record<string, unknown> | null> {
        const db = this.getDrizzle();
        let templateDefault: string | null = null;
        if (typeof ins.templateId === 'string' && ins.templateId) {
            const t = await db.select({ defaultProfileId: templates.defaultProfileId })
                .from(templates).where(and(eq(templates.id, ins.templateId), eq(templates.tenantId, tenantId))).get();
            templateDefault = t?.defaultProfileId ?? null;
        }
        const cfg = await db.select({ defaultProfileId: tenantConfigs.defaultProfileId })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();

        return resolveProfile(
            {
                profileOverride: (ins.profileOverride as string | null) ?? null,
                badgeLayoutOverride: (ins.badgeLayoutOverride as string | null) ?? null,
                reportPhotoColumns: (ins.reportPhotoColumns as number | null) ?? null,
            },
            { defaultProfileId: templateDefault },
            { defaultProfileId: cfg?.defaultProfileId ?? null },
        ) as unknown as Record<string, unknown>;
    }

    async verifyByToken(token: string) {
        const db = this.getDrizzle();
        const row = await db.select().from(reportVersions)
            .where(eq(reportVersions.verificationToken, token)).get();
        if (!row) return null;

        const legacy = !row.contentHash || !row.signature;
        const recomputed = await sha256Hex(row.snapshotJson);
        const hashValid = !legacy && recomputed === row.contentHash;

        // Verified against the key THIS row was sealed with, resolved by the
        // fingerprint it recorded — not the tenant's current key. Reading the
        // current one would make every version published before a key rotation
        // report `signatureValid: false` on the public verifier page, which says
        // "this document does not check out" about a document that does.
        let signatureValid = false;
        let keyMissing = false;
        if (!legacy) {
            const signing = new SigningKeyService(this.db, this.encryptionSecret);
            const pub = row.keyFingerprint
                ? await signing.getPublicKeyByFingerprint(row.tenantId, row.keyFingerprint)
                : null;
            // No key on file for this row: unverifiable, which is a different
            // finding from a signature that failed. Kept apart so the page can
            // stop short of blaming the document.
            keyMissing = !pub;
            if (pub) {
                signatureValid = await crypto.subtle.verify(
                    { name: 'Ed25519' }, pub.publicKey,
                    base64UrlDecode(row.signature!) as unknown as ArrayBuffer,
                    new TextEncoder().encode(recomputed),
                );
            }
        }

        let chainValid: boolean;
        if (row.versionNumber > 1) {
            // Walk the chain within this REPORT. Reading by inspection would
            // pick up the other report's version and report a valid chain as
            // broken (or worse, a broken one as valid) the moment an order
            // delivers more than one document.
            const prev = await db.select().from(reportVersions).where(and(
                eq(reportVersions.tenantId, row.tenantId),
                row.reportId
                    ? eq(reportVersions.reportId, row.reportId)
                    : eq(reportVersions.inspectionId, row.inspectionId),
                eq(reportVersions.versionNumber, row.versionNumber - 1),
            )).get();
            chainValid = !!prev && prev.contentHash === row.prevHash;
        } else {
            chainValid = row.prevHash == null;
        }

        return {
            inspectionId:  row.inspectionId,
            versionNumber: row.versionNumber,
            isAmendment:   row.isAmendment,
            // Public contract (app/routes/public/v.$token.tsx formatDate) is
            // unix SECONDS — independent of the column's own Date storage type.
            publishedAt:   Math.floor(row.publishedAt.getTime() / 1000),
            contentHash:   row.contentHash ?? null,
            keyFingerprint: row.keyFingerprint ?? null,
            legacy,
            hashValid,
            signatureValid,
            keyMissing,
            chainValid,
        };
    }

    /**
     * Layer-2 report page — surface the latest published version's verification
     * metadata without loading the full snapshot blob. Returns null when no
     * version row exists yet (draft) or when the row somehow has no token.
     */
    async getLatestPublished(tenantId: string, inspectionId: string): Promise<{
        versionNumber:     number;
        contentHash:       string | null;
        verificationToken: string | null;
        publishedAt:       number | null;
    } | null> {
        const db = this.getDrizzle();
        const row = await db.select({
            versionNumber:     reportVersions.versionNumber,
            contentHash:       reportVersions.contentHash,
            verificationToken: reportVersions.verificationToken,
            publishedAt:       reportVersions.publishedAt,
        }).from(reportVersions)
            .where(and(eq(reportVersions.tenantId, tenantId), eq(reportVersions.inspectionId, inspectionId)))
            .orderBy(desc(reportVersions.versionNumber))
            .limit(1)
            .get();
        if (!row || !row.verificationToken) return null;
        return {
            versionNumber:     row.versionNumber,
            contentHash:       row.contentHash ?? null,
            verificationToken: row.verificationToken,
            // Unix SECONDS — mirrors verifyByToken's public contract above.
            publishedAt:       row.publishedAt ? Math.floor(row.publishedAt.getTime() / 1000) : null,
        };
    }

    async list(tenantId: string, inspectionId: string) {
        const db = this.getDrizzle();
        const rows = await db.select({
            versionNumber: reportVersions.versionNumber,
            publishedAt:   reportVersions.publishedAt,
            publishedBy:   reportVersions.publishedBy,
            summary:       reportVersions.summary,
        }).from(reportVersions)
            .where(and(eq(reportVersions.tenantId, tenantId), eq(reportVersions.inspectionId, inspectionId)))
            .orderBy(desc(reportVersions.versionNumber))
            .all();
        return rows.map((row) => ({
            ...row,
            // Unix SECONDS — mirrors verifyByToken/getLatestPublished's public contract above.
            publishedAt: row.publishedAt ? Math.floor(row.publishedAt.getTime() / 1000) : null,
        }));
    }

    async get(tenantId: string, inspectionId: string, versionNumber: number): Promise<Snapshot | null> {
        const db = this.getDrizzle();
        const row = await db.select().from(reportVersions)
            .where(and(
                eq(reportVersions.tenantId, tenantId),
                eq(reportVersions.inspectionId, inspectionId),
                eq(reportVersions.versionNumber, versionNumber),
            ))
            .get();
        if (!row) return null;
        return JSON.parse(row.snapshotJson) as Snapshot;
    }

    async diff(
        tenantId: string,
        inspectionId: string,
        fromVersion: number,
        toVersion: number,
    ): Promise<DiffPayload | null> {
        const [from, to] = await Promise.all([
            this.get(tenantId, inspectionId, fromVersion),
            this.get(tenantId, inspectionId, toVersion),
        ]);
        if (!from || !to) return null;
        return computeDiff(from, to);
    }
}

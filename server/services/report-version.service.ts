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
import { reportVersions, inspections, inspectionResults, inspectionUnits, users, inspectionInspectors, templates, tenantConfigs } from '../lib/db/schema';
import { computeDiff, SNAPSHOT_SCHEMA_VERSION, type Snapshot, type SnapshotInspector, type DiffPayload } from '../lib/version-diff';
import { CredentialService } from './credential.service';
import { resolveProfile } from '../lib/report-style/resolve';
import { SigningKeyService, sha256Hex, base64UrlEncode, base64UrlDecode } from './signing-key.service';

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

    async snapshotOnPublish(
        tenantId: string,
        inspectionId: string,
        publishedBy: string,
        summary?: string,
    ): Promise<SnapshotResult> {
        const db = this.getDrizzle();

        // Compute next version number.
        const prev = await db.select().from(reportVersions)
            .where(and(eq(reportVersions.tenantId, tenantId), eq(reportVersions.inspectionId, inspectionId)))
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
     * `inspection_inspectors` is the query face over `leadInspectorId` +
     * `helperInspectorIds`; when it holds nothing (older inspections that never
     * synced) the inspection's own `inspectorId` is the lead.
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
                name: u?.name || (u?.email?.split('@')[0] ?? null),
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

        let signatureValid = false;
        if (!legacy) {
            const signing = new SigningKeyService(this.db, this.encryptionSecret);
            const pub = await signing.getPublicKey(row.tenantId);
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
            const prev = await db.select().from(reportVersions).where(and(
                eq(reportVersions.tenantId, row.tenantId),
                eq(reportVersions.inspectionId, row.inspectionId),
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

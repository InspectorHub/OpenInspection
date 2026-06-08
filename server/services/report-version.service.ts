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
import { reportVersions, inspections, inspectionResults, inspectionUnits } from '../lib/db/schema';
import { computeDiff, type Snapshot, type DiffPayload } from '../lib/version-diff';
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
            inspection: ins as unknown as Record<string, unknown>,
            data,
            units,
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
            publishedAt:    Math.floor(Date.now() / 1000),
            publishedBy,
            createdAt:      new Date().toISOString(),
            contentHash,
            prevHash,
            signature,
            keyFingerprint: fingerprint,
            isAmendment:    nextVersion > 1,
            verificationToken,
        });

        return { versionNumber: nextVersion, ...(summary ? { summary } : {}) };
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
            publishedAt:   row.publishedAt,
            contentHash:   row.contentHash ?? null,
            keyFingerprint: row.keyFingerprint ?? null,
            legacy,
            hashValid,
            signatureValid,
            chainValid,
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
        return rows;
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

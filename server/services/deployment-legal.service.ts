/**
 * The deployment's own legal documents — the ones with no tenant behind them.
 *
 * `LegalVersionService` beside this file answers the same questions for a
 * TENANT's Privacy and Terms. The split is the counterparty, not the mechanism:
 * an agent account is global (`users.tenant_id IS NULL`) and spans every company
 * on the deployment that names it, so the party on the other side of the agent
 * terms is whoever operates the software. There is one such document, not one per
 * company, and there is no tenant to key it on.
 *
 * Keeping it here also removes a mode branch rather than adding one. The previous
 * read went through `profile.fixedTenantId`, which exists in standalone (the
 * single tenant IS the operator) and is null in SaaS — so agent signup refused
 * every SaaS request. This service answers both modes with one query.
 */

import { eq, and, desc } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { deploymentLegalVersions } from '../lib/db/schema';
import { sha256Hex } from './signing-key.service';

/** The only document so far. A union rather than a string so a typo cannot mint a doc. */
export type DeploymentLegalDoc = 'agent_terms';

export interface DeploymentLegalVersionRow {
    version: string;
    contentHash: string;
    bodySnapshot: string;
    publishedAt: Date;
}

export class DeploymentLegalService {
    constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

    /**
     * The version in force, or null when the deployment has published none.
     *
     * Null is a real answer and callers must treat it as one: no published text
     * means there is nothing an acceptance could refer to, so the honest response
     * is to refuse rather than to record an agreement to an absent document.
     */
    async latest(doc: DeploymentLegalDoc): Promise<DeploymentLegalVersionRow | null> {
        const rows = await this.db
            .select({
                version: deploymentLegalVersions.version,
                contentHash: deploymentLegalVersions.contentHash,
                bodySnapshot: deploymentLegalVersions.bodySnapshot,
                publishedAt: deploymentLegalVersions.publishedAt,
            })
            .from(deploymentLegalVersions)
            .where(eq(deploymentLegalVersions.doc, doc))
            .orderBy(desc(deploymentLegalVersions.publishedAt))
            .limit(1);
        return rows[0] ?? null;
    }

    /**
     * Publish `body` as `version`, or return the existing version when the text
     * is byte-identical to something already published.
     *
     * De-duplication is on the CONTENT HASH, not on the version string. The same
     * words published twice are one document that happens to have been submitted
     * twice; minting a second version would leave a reader diffing two rows to
     * discover they are the same. Conversely a changed body under an unchanged
     * version string is refused — a version people have accepted cannot come to
     * mean different words, which is the property the hash exists to defend.
     */
    async recordPublish(input: {
        doc: DeploymentLegalDoc;
        version: string;
        body: string;
    }): Promise<{ version: string; contentHash: string; created: boolean }> {
        const contentHash = await sha256Hex(input.body);

        const existingSameText = await this.db
            .select({
                version: deploymentLegalVersions.version,
                contentHash: deploymentLegalVersions.contentHash,
            })
            .from(deploymentLegalVersions)
            .where(and(
                eq(deploymentLegalVersions.doc, input.doc),
                eq(deploymentLegalVersions.contentHash, contentHash),
            ))
            .limit(1);
        if (existingSameText[0]) {
            return { ...existingSameText[0], created: false };
        }

        const clash = await this.db
            .select({ contentHash: deploymentLegalVersions.contentHash })
            .from(deploymentLegalVersions)
            .where(and(
                eq(deploymentLegalVersions.doc, input.doc),
                eq(deploymentLegalVersions.version, input.version),
            ))
            .limit(1);
        if (clash[0]) {
            throw new Error(
                `${input.doc} ${input.version} is already published with different text `
                + `(${clash[0].contentHash.slice(0, 12)}…). A version people have accepted cannot `
                + 'be edited — publish a new version instead.',
            );
        }

        await this.db.insert(deploymentLegalVersions).values({
            id: crypto.randomUUID(),
            doc: input.doc,
            version: input.version,
            bodySnapshot: input.body,
            contentHash,
            publishedAt: new Date(),
        });
        return { version: input.version, contentHash, created: true };
    }
}

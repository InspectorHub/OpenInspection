import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { repairRequests, repairRequestItems } from '../lib/db/schema';
import { Errors } from '../lib/errors';

export type Creator = { kind: 'client' | 'agent' | 'inspector'; ref: string };

type ItemInput = {
    findingKey: string;
    sectionTitle: string;
    itemLabel: string;
    commentSnapshot?: string | null;
    requestedCreditCents?: number | null;
    note?: string | null;
};

export class RepairRequestService {
    constructor(
        private db: D1Database,
        private genId: () => string = () => crypto.randomUUID(),
        private now: () => number = () => Date.now(),
    ) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private d() { return drizzle(this.db as any); }

    async create(tenantId: string, inspectionId: string, creator: Creator) {
        const ts = this.now();
        const row = {
            id: this.genId(),
            tenantId,
            inspectionId,
            createdByKind: creator.kind,
            createdByRef: creator.ref,
            customIntro: null,
            shareToken: this.genId(),
            createdAt: new Date(ts),
            updatedAt: new Date(ts),
        };
        await this.d().insert(repairRequests).values(row);
        return row;
    }

    async listMine(tenantId: string, inspectionId: string, creator: Creator) {
        return this.d()
            .select()
            .from(repairRequests)
            .where(
                and(
                    eq(repairRequests.tenantId, tenantId),
                    eq(repairRequests.inspectionId, inspectionId),
                    eq(repairRequests.createdByKind, creator.kind),
                    eq(repairRequests.createdByRef, creator.ref),
                ),
            )
            .all();
    }

    /**
     * Like listMine but each returned RR row also includes its `items` array.
     * This is what the /source route needs so the builder page can rehydrate
     * initialSelected / initialDrafts / initialItemIds on reload without
     * re-adding items (which would inflate creditTotal).
     */
    async listMineWithItems(tenantId: string, inspectionId: string, creator: Creator) {
        const rows = await this.listMine(tenantId, inspectionId, creator);
        const results = await Promise.all(
            rows.map(async (rr) => {
                const items = await this.d()
                    .select()
                    .from(repairRequestItems)
                    .where(eq(repairRequestItems.repairRequestId, rr.id))
                    .all();
                return { ...rr, items };
            }),
        );
        return results;
    }

    /**
     * Get a single repair request with its items, scoped to (tenantId, inspectionId).
     * Returns null if the RR is not found OR belongs to a different inspection.
     */
    async get(tenantId: string, inspectionId: string, id: string) {
        const request = await this.d()
            .select()
            .from(repairRequests)
            .where(
                and(
                    eq(repairRequests.tenantId, tenantId),
                    eq(repairRequests.inspectionId, inspectionId),
                    eq(repairRequests.id, id),
                ),
            )
            .get();
        if (!request) return null;
        const items = await this.d()
            .select()
            .from(repairRequestItems)
            .where(eq(repairRequestItems.repairRequestId, id))
            .all();
        return { request, items };
    }

    async getByShareToken(shareToken: string) {
        const request = await this.d()
            .select()
            .from(repairRequests)
            .where(eq(repairRequests.shareToken, shareToken))
            .get();
        if (!request) return null;
        const items = await this.d()
            .select()
            .from(repairRequestItems)
            .where(eq(repairRequestItems.repairRequestId, request.id))
            .all();
        return { request, items };
    }

    /**
     * Asserts the caller is the creator of the given repair request AND that the
     * RR belongs to the given (tenantId, inspectionId) pair. Throws NotFound or
     * Forbidden on failure.
     */
    async assertCanEdit(tenantId: string, inspectionId: string, id: string, creator: Creator) {
        const rr = await this.d()
            .select()
            .from(repairRequests)
            .where(
                and(
                    eq(repairRequests.tenantId, tenantId),
                    eq(repairRequests.inspectionId, inspectionId),
                    eq(repairRequests.id, id),
                ),
            )
            .get();
        if (!rr) throw Errors.NotFound('Repair request not found');
        if (rr.createdByKind !== creator.kind || rr.createdByRef !== creator.ref) {
            throw Errors.Forbidden('Not the creator of this repair request');
        }
        return rr;
    }

    /**
     * Idempotent addItem: if an item with the same (repairRequestId, findingKey)
     * already exists, UPDATE its snapshot/credit/note instead of inserting a
     * duplicate. This prevents silent credit double-counting on reload/re-toggle.
     */
    async addItem(tenantId: string, repairRequestId: string, input: ItemInput) {
        // Check for an existing row with the same findingKey to avoid duplicates.
        const existing = await this.d()
            .select()
            .from(repairRequestItems)
            .where(
                and(
                    eq(repairRequestItems.tenantId, tenantId),
                    eq(repairRequestItems.repairRequestId, repairRequestId),
                    eq(repairRequestItems.findingKey, input.findingKey),
                ),
            )
            .get();

        if (existing) {
            // Update snapshot/credit/note to match the latest input.
            const patch = {
                sectionTitle:         input.sectionTitle,
                itemLabel:            input.itemLabel,
                commentSnapshot:      input.commentSnapshot ?? null,
                requestedCreditCents: input.requestedCreditCents ?? null,
                note:                 input.note ?? null,
            };
            await this.d()
                .update(repairRequestItems)
                .set(patch)
                .where(
                    and(
                        eq(repairRequestItems.tenantId, tenantId),
                        eq(repairRequestItems.id, existing.id),
                    ),
                );
            await this.touch(tenantId, repairRequestId);
            return { ...existing, ...patch };
        }

        const item = {
            id: this.genId(),
            tenantId,
            repairRequestId,
            findingKey: input.findingKey,
            sectionTitle: input.sectionTitle,
            itemLabel: input.itemLabel,
            commentSnapshot: input.commentSnapshot ?? null,
            requestedCreditCents: input.requestedCreditCents ?? null,
            note: input.note ?? null,
            sortOrder: 0,
        };
        await this.d().insert(repairRequestItems).values(item);
        await this.touch(tenantId, repairRequestId);
        return item;
    }

    /**
     * Update an item, scoped to (tenantId, inspectionId) via the parent RR guard.
     * The `inspectionId` parameter is threaded through so cross-inspection writes
     * from unrelated URL params are rejected (the WHERE on repairRequests filters
     * them out, leaving no item rows to mutate).
     */
    async updateItem(
        tenantId: string,
        inspectionId: string,
        repairRequestId: string,
        itemId: string,
        patch: Partial<Pick<ItemInput, 'requestedCreditCents' | 'note'>> & { sortOrder?: number },
    ) {
        // Guard: confirm the RR belongs to this (tenant, inspection) before mutating.
        const rr = await this.d()
            .select({ id: repairRequests.id })
            .from(repairRequests)
            .where(
                and(
                    eq(repairRequests.tenantId, tenantId),
                    eq(repairRequests.inspectionId, inspectionId),
                    eq(repairRequests.id, repairRequestId),
                ),
            )
            .get();
        if (!rr) return; // Wrong inspection — silent no-op (caller's assertCanEdit already covers auth)

        await this.d()
            .update(repairRequestItems)
            .set(patch)
            .where(
                and(
                    eq(repairRequestItems.tenantId, tenantId),
                    eq(repairRequestItems.id, itemId),
                    eq(repairRequestItems.repairRequestId, repairRequestId),
                ),
            );
        await this.touch(tenantId, repairRequestId);
    }

    /**
     * Remove an item, scoped to (tenantId, inspectionId) via the parent RR guard.
     */
    async removeItem(tenantId: string, inspectionId: string, repairRequestId: string, itemId: string) {
        // Guard: confirm the RR belongs to this (tenant, inspection) before mutating.
        const rr = await this.d()
            .select({ id: repairRequests.id })
            .from(repairRequests)
            .where(
                and(
                    eq(repairRequests.tenantId, tenantId),
                    eq(repairRequests.inspectionId, inspectionId),
                    eq(repairRequests.id, repairRequestId),
                ),
            )
            .get();
        if (!rr) return; // Wrong inspection — silent no-op

        await this.d()
            .delete(repairRequestItems)
            .where(
                and(
                    eq(repairRequestItems.tenantId, tenantId),
                    eq(repairRequestItems.id, itemId),
                    eq(repairRequestItems.repairRequestId, repairRequestId),
                ),
            );
        await this.touch(tenantId, repairRequestId);
    }

    /**
     * Set or clear the custom intro, scoped to (tenantId, inspectionId).
     */
    async setIntro(tenantId: string, inspectionId: string, id: string, customIntro: string | null) {
        await this.d()
            .update(repairRequests)
            .set({ customIntro, updatedAt: new Date(this.now()) })
            .where(
                and(
                    eq(repairRequests.tenantId, tenantId),
                    eq(repairRequests.inspectionId, inspectionId),
                    eq(repairRequests.id, id),
                ),
            );
    }

    /**
     * Sum the credit total for a repair request, scoped to (tenantId, inspectionId).
     * Returns 0 if the RR does not belong to the given inspection.
     */
    async creditTotal(tenantId: string, inspectionId: string, id: string) {
        // Guard: confirm the RR belongs to this (tenant, inspection).
        const rr = await this.d()
            .select({ id: repairRequests.id })
            .from(repairRequests)
            .where(
                and(
                    eq(repairRequests.tenantId, tenantId),
                    eq(repairRequests.inspectionId, inspectionId),
                    eq(repairRequests.id, id),
                ),
            )
            .get();
        if (!rr) return 0;

        const items = await this.d()
            .select()
            .from(repairRequestItems)
            .where(
                and(
                    eq(repairRequestItems.tenantId, tenantId),
                    eq(repairRequestItems.repairRequestId, id),
                ),
            )
            .all();
        return items.reduce((sum, it) => sum + (it.requestedCreditCents ?? 0), 0);
    }

    private async touch(tenantId: string, id: string) {
        await this.d()
            .update(repairRequests)
            .set({ updatedAt: new Date(this.now()) })
            .where(and(eq(repairRequests.tenantId, tenantId), eq(repairRequests.id, id)));
    }
}

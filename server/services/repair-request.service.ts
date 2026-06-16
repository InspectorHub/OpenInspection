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

    async get(tenantId: string, id: string) {
        const request = await this.d()
            .select()
            .from(repairRequests)
            .where(and(eq(repairRequests.tenantId, tenantId), eq(repairRequests.id, id)))
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

    async assertCanEdit(tenantId: string, id: string, creator: Creator) {
        const rr = await this.d()
            .select()
            .from(repairRequests)
            .where(and(eq(repairRequests.tenantId, tenantId), eq(repairRequests.id, id)))
            .get();
        if (!rr) throw Errors.NotFound('Repair request not found');
        if (rr.createdByKind !== creator.kind || rr.createdByRef !== creator.ref) {
            throw Errors.Forbidden('Not the creator of this repair request');
        }
        return rr;
    }

    async addItem(tenantId: string, repairRequestId: string, input: ItemInput) {
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

    async updateItem(
        tenantId: string,
        repairRequestId: string,
        itemId: string,
        patch: Partial<Pick<ItemInput, 'requestedCreditCents' | 'note'>> & { sortOrder?: number },
    ) {
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

    async removeItem(tenantId: string, repairRequestId: string, itemId: string) {
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

    async setIntro(tenantId: string, id: string, customIntro: string | null) {
        await this.d()
            .update(repairRequests)
            .set({ customIntro, updatedAt: new Date(this.now()) })
            .where(and(eq(repairRequests.tenantId, tenantId), eq(repairRequests.id, id)));
    }

    async creditTotal(tenantId: string, id: string) {
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

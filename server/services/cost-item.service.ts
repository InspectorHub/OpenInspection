/**
 * Commercial PCA Phase C — CRUD for cost_items, tenant + inspection scoped.
 * Returns the render-shaped CostItem (cents preserved). No FK; tenant filter
 * is applied on every query (fail-closed multi-tenant rule).
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, asc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '../lib/db/schema';
import { costItems } from '../lib/db/schema/inspection/cost-items';
import type { CostItem } from '../lib/pca-costs';
import { logger } from '../lib/logger';

type CreateInput = {
  inspectionId: string;
  buildingId?: string | null;
  instanceIndex?: number | null;
  unitId?: string | null;
  findingKey?: string | null;
  system: string;
  component: string;
  location?: string;
  action: CostItem['action'];
  costMethod: CostItem['costMethod'];
  quantity?: number | null;
  uom?: string | null;
  unitCostCents?: number | null;
  lumpSumCents?: number | null;
  eul?: number | null;
  effAge?: number | null;
  rul?: number | null;
  suggestedRemedy?: string;
  bucket: CostItem['bucket'];
  sectionRef?: string | null;
  photoRef?: string | null;
  sortOrder?: number;
};

function toRenderItem(row: typeof costItems.$inferSelect): CostItem {
  return {
    id: row.id, system: row.system, component: row.component, location: row.location,
    action: row.action, costMethod: row.costMethod, quantity: row.quantity, uom: row.uom,
    unitCostCents: row.unitCostCents, lumpSumCents: row.lumpSumCents,
    eul: row.eul, effAge: row.effAge, rul: row.rul, suggestedRemedy: row.suggestedRemedy,
    bucket: row.bucket, sectionRef: row.sectionRef, photoRef: row.photoRef, sortOrder: row.sortOrder,
  };
}

export class CostItemService {
  private db: ReturnType<typeof drizzle<typeof schema>>;
  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  async listByInspection(inspectionId: string, tenantId: string): Promise<CostItem[]> {
    const rows = await this.db.select().from(costItems)
      .where(and(eq(costItems.tenantId, tenantId), eq(costItems.inspectionId, inspectionId)))
      .orderBy(asc(costItems.sortOrder))
      .all();
    return rows.map(toRenderItem);
  }

  async create(tenantId: string, input: CreateInput): Promise<string> {
    const id = randomUUID();
    await this.db.insert(costItems).values({
      id, tenantId, inspectionId: input.inspectionId,
      buildingId: input.buildingId ?? null, instanceIndex: input.instanceIndex ?? null,
      unitId: input.unitId ?? null, findingKey: input.findingKey ?? null,
      system: input.system, component: input.component, location: input.location ?? '',
      action: input.action, costMethod: input.costMethod,
      quantity: input.quantity ?? null, uom: input.uom ?? null,
      unitCostCents: input.unitCostCents ?? null, lumpSumCents: input.lumpSumCents ?? null,
      eul: input.eul ?? null, effAge: input.effAge ?? null, rul: input.rul ?? null,
      suggestedRemedy: input.suggestedRemedy ?? '', bucket: input.bucket,
      sectionRef: input.sectionRef ?? null, photoRef: input.photoRef ?? null,
      sortOrder: input.sortOrder ?? 0,
    });
    return id;
  }

  async update(id: string, tenantId: string, patch: Partial<CreateInput>): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { inspectionId: _ignore, ...rest } = patch;
    await this.db.update(costItems).set(rest)
      .where(and(eq(costItems.id, id), eq(costItems.tenantId, tenantId)));
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await this.db.delete(costItems)
      .where(and(eq(costItems.id, id), eq(costItems.tenantId, tenantId)));
    logger.info('cost item removed', { id });
  }
}

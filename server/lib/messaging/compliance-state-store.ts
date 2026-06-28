// server/lib/messaging/compliance-state-store.ts
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { messagingCompliance } from '../db/schema';
import type { ComplianceProviderId } from './compliance-provider';

export type ComplianceRow = typeof messagingCompliance.$inferSelect;

export interface ComplianceStateStore {
  load(tenantId: string): Promise<ComplianceRow | undefined>;
  init(tenantId: string, providerId: ComplianceProviderId): Promise<ComplianceRow>;
  persist(tenantId: string, patch: Partial<typeof messagingCompliance.$inferInsert>): Promise<ComplianceRow>;
}

export class D1ComplianceStateStore implements ComplianceStateStore {
  constructor(private db: D1Database) {}
  private d() { return drizzle(this.db); }

  async load(tenantId: string): Promise<ComplianceRow | undefined> {
    return this.d().select().from(messagingCompliance)
      .where(eq(messagingCompliance.tenantId, tenantId)).get();
  }

  async init(tenantId: string, providerId: ComplianceProviderId): Promise<ComplianceRow> {
    const now = new Date();
    await this.d().insert(messagingCompliance).values({
      tenantId, provider: providerId, mode: 'managed_dedicated',
      complianceStatus: 'not_started', createdAt: now, updatedAt: now,
    }).onConflictDoNothing();
    const row = await this.load(tenantId);
    if (!row) throw new Error('Failed to initialize compliance row');
    return row;
  }

  async persist(tenantId: string, patch: Partial<typeof messagingCompliance.$inferInsert>): Promise<ComplianceRow> {
    const now = new Date();
    await this.d().update(messagingCompliance).set({ ...patch, updatedAt: now })
      .where(eq(messagingCompliance.tenantId, tenantId));
    const row = await this.load(tenantId);
    if (!row) throw new Error('Compliance row disappeared during provisioning');
    return row;
  }
}

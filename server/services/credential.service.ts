import { drizzle } from 'drizzle-orm/d1';
import { and, eq, asc } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { inspectorCredentials } from '../lib/db/schema';
import { r2Keys } from '../lib/r2-keys';
import { Errors } from '../lib/errors';

export type InspectorCredential = InferSelectModel<typeof inspectorCredentials>;

// Inspector Credentials & Association Badges (Spec B). Self-asserted per-inspector
// credentials with an optional uploaded badge image (one R2 object per credential;
// replace purges the old). Every query is fail-closed on (tenantId, userId).
export class CredentialService {
  constructor(private db: D1Database, private r2?: R2Bucket) {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getDrizzle() { return drizzle(this.db as any); }

  async listByUser(tenantId: string, userId: string): Promise<InspectorCredential[]> {
    return this.getDrizzle().select().from(inspectorCredentials)
      .where(and(eq(inspectorCredentials.tenantId, tenantId), eq(inspectorCredentials.userId, userId)))
      .orderBy(asc(inspectorCredentials.sortOrder), asc(inspectorCredentials.createdAt)).all();
  }

  async create(
    tenantId: string,
    userId: string,
    input: { label?: string; memberNumber?: string | null; sortOrder?: number },
  ): Promise<InspectorCredential> {
    const now = new Date();
    const row = {
      id: crypto.randomUUID(), tenantId, userId,
      label: input.label ?? '', memberNumber: input.memberNumber ?? null,
      imageR2Key: null, sortOrder: input.sortOrder ?? 0, active: true,
      createdAt: now, updatedAt: now,
    };
    await this.getDrizzle().insert(inspectorCredentials).values(row);
    return row as InspectorCredential;
  }

  async update(
    id: string, tenantId: string, userId: string,
    patch: { label?: string; memberNumber?: string | null; sortOrder?: number },
  ): Promise<InspectorCredential> {
    const db = this.getDrizzle();
    const updates: Partial<InspectorCredential> = { updatedAt: new Date() };
    if (patch.label !== undefined) updates.label = patch.label;
    if (patch.memberNumber !== undefined) updates.memberNumber = patch.memberNumber;
    if (patch.sortOrder !== undefined) updates.sortOrder = patch.sortOrder;
    await db.update(inspectorCredentials).set(updates)
      .where(and(eq(inspectorCredentials.id, id), eq(inspectorCredentials.tenantId, tenantId), eq(inspectorCredentials.userId, userId)));
    const row = await db.select().from(inspectorCredentials)
      .where(and(eq(inspectorCredentials.id, id), eq(inspectorCredentials.tenantId, tenantId), eq(inspectorCredentials.userId, userId))).get();
    if (!row) throw Errors.NotFound('Credential not found');
    return row;
  }

  async delete(id: string, tenantId: string, userId: string): Promise<void> {
    const db = this.getDrizzle();
    const row = await db.select().from(inspectorCredentials)
      .where(and(eq(inspectorCredentials.id, id), eq(inspectorCredentials.tenantId, tenantId), eq(inspectorCredentials.userId, userId))).get();
    if (row?.imageR2Key && this.r2) await this.r2.delete(row.imageR2Key); // best-effort purge
    await db.delete(inspectorCredentials)
      .where(and(eq(inspectorCredentials.id, id), eq(inspectorCredentials.tenantId, tenantId), eq(inspectorCredentials.userId, userId)));
  }

  async uploadImage(tenantId: string, userId: string, credentialId: string, file: File): Promise<string> {
    if (!this.r2) throw Errors.BadRequest('Upload not available');
    const db = this.getDrizzle();
    const row = await db.select().from(inspectorCredentials)
      .where(and(eq(inspectorCredentials.id, credentialId), eq(inspectorCredentials.tenantId, tenantId), eq(inspectorCredentials.userId, userId))).get();
    if (!row) throw Errors.NotFound('Credential not found');
    if (row.imageR2Key) await this.r2.delete(row.imageR2Key); // replace = purge old
    const ext = file.type.split('/')[1] === 'svg+xml' ? 'svg' : file.type.split('/')[1];
    const key = r2Keys.credentialImage(tenantId, credentialId, crypto.randomUUID(), ext);
    await this.r2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
    await db.update(inspectorCredentials).set({ imageR2Key: key, updatedAt: new Date() })
      .where(and(eq(inspectorCredentials.id, credentialId), eq(inspectorCredentials.tenantId, tenantId)));
    return `/api/public/brand-asset?key=${encodeURIComponent(key)}`;
  }
}

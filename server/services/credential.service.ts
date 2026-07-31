import { drizzle } from 'drizzle-orm/d1';
import { and, eq, asc } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { inspectorCredentials } from '../lib/db/schema';
import { r2Keys } from '../lib/r2-keys';
import { Errors } from '../lib/errors';

export type InspectorCredential = InferSelectModel<typeof inspectorCredentials>;

/**
 * A credential as every RENDERER wants it (Spec B): the booking footer, the
 * email signature, the report cover strip and the report signature block.
 *
 * `imageUrl` is the public brand-asset path, ROOT-RELATIVE. Callers that embed
 * it in outbound HTML email must absolutise against the deployment host —
 * `inspectorSignature()` does — because a relative path in an email resolves
 * against the recipient's mail client, which is nowhere.
 */
/**
 * The LICENCE among a set of credentials, or null.
 *
 * A free function over the list rather than a method that queries, because two
 * callers need the same answer from two different SOURCES: the live report reads
 * current rows, and a pinned published version reads the ones its snapshot
 * froze. When the rule lived inside the DB method, the pinned path could not
 * reach it — so it called the live one, and a report ended up showing a frozen
 * badge strip beside a licence line resolved from today. Same document, two
 * numbers, for an inspector who had renewed.
 *
 * "First entry carrying a member number, in the inspector's own order" works
 * because the backfill seeds the licence at `sort_order = -1`; that sort order
 * was chosen for exactly this.
 */
export function primaryLicenseOf(credentials: RenderableCredential[]): string | null {
  return credentials.find((c) => (c.memberNumber ?? '').trim())?.memberNumber?.trim() || null;
}

export interface RenderableCredential {
  label: string;
  memberNumber: string | null;
  imageUrl: string | null;
}

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

  /**
   * The inspector's ACTIVE credentials, shaped for rendering.
   *
   * One function rather than a mapping copied per surface. There were three
   * copies of these six lines when this was written — booking's footer, the
   * Profile preview, and about to be the send path and the report payload — and
   * three copies is exactly how the URL form comes to differ between the email
   * a client receives and the page they land on.
   *
   * Filters to `active`, drops rows that are neither a badge nor a label
   * (a credential row is created blank and filled in, so an abandoned one would
   * otherwise render as an empty chip), and orders by the inspector's own
   * `sortOrder`.
   */
  async listRenderable(tenantId: string, userId: string): Promise<RenderableCredential[]> {
    const rows = await this.listByUser(tenantId, userId);
    return rows
      .filter((cr) => cr.active)
      .filter((cr) => cr.imageR2Key || (cr.label ?? '').trim())
      .map((cr) => ({
        label: cr.label,
        memberNumber: cr.memberNumber,
        imageUrl: cr.imageR2Key
          ? `/api/public/brand-asset?key=${encodeURIComponent(cr.imageR2Key)}`
          : null,
      }));
  }

  /**
   * The inspector's LICENCE NUMBER, for the surfaces that render one string.
   *
   * The PDF footer prints `· Lic. <n>` and the report signature block carries a
   * single licence — neither can show a list. `users.license_number` used to
   * answer this; it is frozen, and the licence now lives as a credential row
   * seeded at `sort_order = -1` by the backfill, which is exactly why that sort
   * order was chosen rather than 0. So "first active credential carrying a
   * member number, in the inspector's own order" IS the licence.
   *
   * Null when they have none, and the callers omit the line rather than
   * printing an empty one.
   */
  async primaryLicenseNumber(tenantId: string, userId: string): Promise<string | null> {
    return primaryLicenseOf(await this.listRenderable(tenantId, userId));
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

/**
 * Reading an inspection photo with a native Bearer token.
 *
 * `GET /api/inspections/{id}/photo?key=` is the route a native client uses to download photos it
 * already has keys for. These specs drive the REAL app with an OAuth-provider token (not a cookie)
 * and an in-memory bucket that serves real objects, so a "404" cannot come from an empty bucket.
 * Every refusal is paired with a positive control on the same harness.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { NATIVE_SCOPE, type NativeProps } from '../../../server/lib/auth/native-token';
import { createHarness, INSPECTOR_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

const OTHER_INSPECTOR_ID = '22222222-0000-4000-8000-000000000013';
const OTHER_TENANT_ID = '11111111-0000-4000-8000-000000000012';
const OTHER_TENANT_INSPECTOR_ID = '22222222-0000-4000-8000-000000000014';
const MINE = 'insp-photo-mine';
const MINE_TOO = 'insp-photo-mine-too';
const NOT_MINE = 'insp-photo-not-mine';
const OTHER_TENANT_INSPECTION = 'insp-photo-other-tenant';

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const THUMB = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
const keyOf = (tenantId: string, inspectionId: string) => `${tenantId}/inspections/${inspectionId}/photos/p1.jpg`;

const props: NativeProps = { kind: 'native', userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'inspector', lastUsedAt: 0, grantedAt: 0 };
const provider = {
  unwrapToken: async (t: string) => (t === 'insp:g:s'
    ? { scope: [NATIVE_SCOPE], grant: { clientId: 'c', scope: [NATIVE_SCOPE], props } }
    : null),
};

/** A bucket whose `get` serves what was put, with the metadata the route reads. */
function readableBucket(objects: Map<string, Uint8Array>) {
  return {
    get: async (key: string) => {
      const bytes = objects.get(key);
      if (!bytes) return null;
      return {
        // A copy: it is typed as backed by a plain ArrayBuffer, which Blob accepts.
        body: new Blob([new Uint8Array(bytes)]).stream(),
        httpMetadata: { contentType: 'image/jpeg' },
        customMetadata: { originalName: 'roof.jpg' },
        httpEtag: '"etag-1"',
      };
    },
  } as unknown as R2Bucket;
}

/** An Images binding that records the width it was asked for and answers a webp. */
function imagesStub(widths: number[]) {
  return {
    input: () => ({
      transform: (o: { width: number }) => {
        widths.push(o.width);
        return { output: async () => ({ response: () => new Response(THUMB, { headers: { 'Content-Type': 'image/webp' } }) }) };
      },
    }),
  };
}

describe('GET /api/inspections/{id}/photo with a native token (real app)', () => {
  let h: Harness | undefined;
  afterEach(() => { h?.close(); h = undefined; });

  async function setup() {
    const hh = await createHarness('standalone');
    h = hh;
    const now = new Date();
    await hh.db.insert(schema.users).values({
      id: OTHER_INSPECTOR_ID, tenantId: TENANT_ID, email: 'ines@harbor-light.test', passwordHash: 'h',
      role: 'inspector', name: 'Ines Inspector', createdAt: now,
    });
    // This inspector sees only what is assigned to them.
    await hh.db.update(schema.users).set({ permissionOverrides: { viewAllInspections: false } }).where(eq(schema.users.id, INSPECTOR_ID));
    await hh.db.insert(schema.tenants).values({
      id: OTHER_TENANT_ID, slug: 'other-photo', status: 'active', tier: 'free', maxUsers: 5,
      deploymentMode: 'shared', createdAt: now,
    });
    await hh.db.insert(schema.users).values({
      id: OTHER_TENANT_INSPECTOR_ID, tenantId: OTHER_TENANT_ID, email: 'oscar@other.test', passwordHash: 'h',
      role: 'inspector', name: 'Oscar', createdAt: now,
    });
    for (const [id, tenantId, inspectorId] of [
      [MINE, TENANT_ID, INSPECTOR_ID], [MINE_TOO, TENANT_ID, INSPECTOR_ID],
      [NOT_MINE, TENANT_ID, OTHER_INSPECTOR_ID], [OTHER_TENANT_INSPECTION, OTHER_TENANT_ID, OTHER_TENANT_INSPECTOR_ID],
    ] as const) {
      await hh.db.insert(schema.inspections).values({
        id, tenantId, inspectorId, propertyAddress: '1 Main', date: '2026-06-01',
        status: 'confirmed', paymentStatus: 'paid', price: 0, createdAt: now,
      });
      await hh.db.insert(schema.inspectionInspectors).values({ inspectionId: id, userId: inspectorId, tenantId, role: 'lead', createdAt: now });
    }
    const objects = new Map<string, Uint8Array>([
      [keyOf(TENANT_ID, MINE), BYTES], [keyOf(TENANT_ID, MINE_TOO), BYTES], [keyOf(TENANT_ID, NOT_MINE), BYTES],
      [keyOf(OTHER_TENANT_ID, OTHER_TENANT_INSPECTION), BYTES],
    ]);
    const widths: number[] = [];
    async function get(id: string, key: string, opts: { query?: string; token?: string | null; images?: boolean } = {}): Promise<Response> {
      const env = {
        ...hh.env, PHOTOS: readableBucket(objects), NATIVE_CLIENT_ENABLED: 'true', OAUTH_PROVIDER: provider,
        ...(opts.images ? { IMAGES: imagesStub(widths) } : {}),
      } as unknown as typeof hh.env;
      const token = opts.token === undefined ? 'insp:g:s' : opts.token;
      const headers = new Headers();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const exec = makeExecutionContext({ label: 'photo-read' });
      const res = await app.request(`/api/inspections/${id}/photo?key=${encodeURIComponent(key)}${opts.query ?? ''}`, { headers }, env, exec.ctx);
      await exec.settle();
      return res;
    }
    return { get, widths };
  }

  const bytesOf = async (res: Response) => new Uint8Array(await res.arrayBuffer());

  it('serves the original bytes of an assigned inspection with the documented cache header', async () => {
    const t = await setup();
    const res = await t.get(MINE, keyOf(TENANT_ID, MINE));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(Array.from(await bytesOf(res))).toEqual(Array.from(BYTES));
  });

  it('refuses a request with no token, and a token the provider does not know', async () => {
    const t = await setup();
    expect((await t.get(MINE, keyOf(TENANT_ID, MINE), { token: null })).status).toBe(401);
    expect((await t.get(MINE, keyOf(TENANT_ID, MINE), { token: 'nope:g:s' })).status).toBe(401);
    // Control: the known token reads the same photo.
    expect((await t.get(MINE, keyOf(TENANT_ID, MINE))).status).toBe(200);
  });

  it("answers 404 for another company's key, even though the object exists", async () => {
    const t = await setup();
    const foreign = keyOf(OTHER_TENANT_ID, OTHER_TENANT_INSPECTION);
    expect((await t.get(MINE, foreign)).status).toBe(404);
    expect((await t.get(OTHER_TENANT_INSPECTION, foreign)).status).toBe(404);
    // Control: the caller's own key on the same path is served.
    expect((await t.get(MINE, keyOf(TENANT_ID, MINE))).status).toBe(200);
  });

  it("answers 404 when the key belongs to a different inspection than the path's", async () => {
    const t = await setup();
    // Both inspections are the caller's own and both objects exist.
    expect((await t.get(MINE, keyOf(TENANT_ID, MINE_TOO))).status).toBe(404);
    // Control: each is served on its own path.
    expect((await t.get(MINE_TOO, keyOf(TENANT_ID, MINE_TOO))).status).toBe(200);
  });

  it('answers 404 for a key prefix that only starts like the caller\'s', async () => {
    const t = await setup();
    expect((await t.get(MINE, `${TENANT_ID}/inspections/${MINE}x/photos/p1.jpg`)).status).toBe(404);
    expect((await t.get(MINE, `${TENANT_ID}/${MINE}/photos/p1.jpg`)).status).toBe(404);
  });

  it('answers 404 for an inspection that is not assigned to a restricted member, and serves an assigned one', async () => {
    const t = await setup();
    expect((await t.get(NOT_MINE, keyOf(TENANT_ID, NOT_MINE))).status).toBe(404);
    expect((await t.get(MINE, keyOf(TENANT_ID, MINE))).status).toBe(200);
  });

  it('answers 404 for a key that has no object', async () => {
    const t = await setup();
    expect((await t.get(MINE, `${TENANT_ID}/inspections/${MINE}/photos/missing.jpg`)).status).toBe(404);
  });

  describe('?w= without an image service', () => {
    it('serves the ORIGINAL bytes and type, for any width, including a value that is not a number', async () => {
      const t = await setup();
      for (const w of ['480', '5000', '0', 'abc']) {
        const res = await t.get(MINE, keyOf(TENANT_ID, MINE), { query: `&w=${w}` });
        expect(res.status, w).toBe(200);
        expect(res.headers.get('Content-Type'), w).toBe('image/jpeg');
        expect(Array.from(await bytesOf(res)), w).toEqual(Array.from(BYTES));
      }
      expect(t.widths).toEqual([]);
    });

    it('control: with an image service the same request is a webp at the requested width', async () => {
      const t = await setup();
      const res = await t.get(MINE, keyOf(TENANT_ID, MINE), { query: '&w=480', images: true });
      expect(res.headers.get('Content-Type')).toBe('image/webp');
      expect(Array.from(await bytesOf(res))).toEqual(Array.from(THUMB));
      expect(t.widths).toEqual([480]);
    });

    it('control: with an image service the width is clamped to 16..2000, and no width means the original', async () => {
      const t = await setup();
      await t.get(MINE, keyOf(TENANT_ID, MINE), { query: '&w=5000', images: true });
      await t.get(MINE, keyOf(TENANT_ID, MINE), { query: '&w=abc', images: true });
      await t.get(MINE, keyOf(TENANT_ID, MINE), { query: '&w=1', images: true });
      expect(t.widths).toEqual([2000, 16, 16]);
      const plain = await t.get(MINE, keyOf(TENANT_ID, MINE), { images: true });
      expect(plain.headers.get('Content-Type')).toBe('image/jpeg');
      expect(t.widths).toHaveLength(3);
    });
  });
});

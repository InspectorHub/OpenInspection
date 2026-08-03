import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { HonoConfig } from '../types/hono';
import { sinkKey } from '../lib/email/providers/recording';
import { calendarConnections } from '../lib/db/schema';
import { getDrizzle } from '../lib/route-helpers';

/**
 * TEST-ONLY routes, fail-closed behind `E2E_EMAIL_SINK`. In every real deploy
 * the flag is unset, so each handler returns 404 and reveals nothing. Exists so
 * E2E can read back the password-reset link that is emailed (never returned by
 * any API) — captured by RecordingEmailProvider. Mounted at `/api/__test__`.
 */
const testHooks = new Hono<HonoConfig>();

testHooks.get('/last-email', async (c) => {
  // Fail closed: the route only exists when the sink is explicitly enabled.
  if (c.env.E2E_EMAIL_SINK !== '1') return c.json({ error: 'Not found' }, 404);

  const to = c.req.query('to');
  if (!to) return c.json({ error: 'Missing "to" query param' }, 400);

  const raw = await c.env.TENANT_CACHE.get(sinkKey(to));
  if (!raw) return c.json({ error: 'No email recorded for that recipient' }, 404);

  return c.json({ data: JSON.parse(raw) }, 200);
});

/**
 * Seed one calendar connection, replacing whatever that user had.
 *
 * The capability-gating E2E needs a connection with a CHOSEN capability, which
 * the real OAuth flow cannot produce on demand. It used to write the row with
 * `wrangler d1 execute --local`, and that is why the whole Playwright suite ran
 * with `workers: 1`: the CLI takes an exclusive lock on the SQLite file while
 * the wrangler-dev worker is serving every other spec from it, so any real
 * concurrency turned into ECONNRESET.
 *
 * Writing through the worker removes the lock, and with it the reason the suite
 * could not run in parallel.
 *
 * The sealed blobs are produced by the TEST (it holds JWT_SECRET) and posted
 * here; this handler does no crypto, so nothing about the credential format
 * lives in two places.
 */
testHooks.post('/calendar-connection', async (c) => {
  // Fail closed, exactly like /last-email: absent flag, no route.
  if (c.env.E2E_EMAIL_SINK !== '1') return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json<{
    id: string;
    tenantId: string;
    userId: string;
    capability: 'availability_read' | 'events_read_write';
    credentialsEnc: string;
    credentialsDekEnc: string;
  }>();

  const db = getDrizzle(c);
  const now = new Date();

  // Replace, not upsert — the spec re-seeds the same user with a different
  // capability between cases and must not inherit the previous row.
  await db.delete(calendarConnections)
    .where(eq(calendarConnections.userId, body.userId));

  await db.insert(calendarConnections).values({
    id: body.id,
    tenantId: body.tenantId,
    userId: body.userId,
    provider: 'google',
    authType: 'oauth',
    credentialsEnc: body.credentialsEnc,
    credentialsDekEnc: body.credentialsDekEnc,
    capabilities: body.capability,
    calendarId: 'primary',
    connectedAt: now,
    updatedAt: now,
  });

  return c.json({ data: { id: body.id } }, 200);
});

export default testHooks;

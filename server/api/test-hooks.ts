import { Hono } from 'hono';
import type { HonoConfig } from '../types/hono';
import { sinkKey } from '../lib/email/providers/recording';

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

export default testHooks;

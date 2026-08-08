// server/lib/render-token.ts
/**
 * Headless-render access token. Short-TTL, single-inspection-scoped,
 * HMAC-SHA-256 over a base64url JSON body.
 *
 * Minted ONLY server-side by trusted flows (publish archive, report email,
 * authed/token download) and appended to the report URL the Cloudflare
 * Browser Rendering headless browser fetches (`/report-view/:slug/:id?render=`).
 * The public report data + photo routes accept it as an auth path that resolves
 * tenantId from the inspection row. Secret is JWT_SECRET (KDF input convention;
 * NOT the JWT keyring). Fail-closed: any defect returns null.
 */
import { timingSafeEqual } from './password';

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): string {
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
}

async function hmacB64(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(msg));
  return base64Url(new Uint8Array(sig));
}

// inspectionId, exp epoch ms, and — when the caller is rendering a SPECIFIC
// published version — that version number. `v` rides inside the HMAC body
// rather than as a query param precisely because it changes what the page
// renders: a client who could append `&v=1` to a report link could ask the
// renderer for a version they were never sent.
interface RenderPayload { i: string; e: number; v?: number; }

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export async function signRenderToken(
  inspectionId: string, secret: string, ttlMs: number = DEFAULT_TTL_MS,
  versionNumber?: number,
): Promise<string> {
  const payload: RenderPayload = {
    i: inspectionId,
    e: Date.now() + ttlMs,
    ...(typeof versionNumber === 'number' ? { v: versionNumber } : {}),
  };
  const body64 = base64Url(encoder.encode(JSON.stringify(payload)));
  const sig = await hmacB64(secret, body64);
  return `${body64}.${sig}`;
}

export async function verifyRenderToken(
  token: string, secret: string,
): Promise<{ inspectionId: string; versionNumber?: number } | null> {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body64, providedSig] = parts;
  if (!body64 || !providedSig) return null;
  let expectedSig: string;
  try { expectedSig = await hmacB64(secret, body64); } catch { return null; }
  if (!timingSafeEqual(providedSig, expectedSig)) return null;
  let payload: RenderPayload;
  try { payload = JSON.parse(base64UrlDecode(body64)) as RenderPayload; } catch { return null; }
  if (!payload || typeof payload.i !== 'string' || typeof payload.e !== 'number') return null;
  if (payload.e < Date.now()) return null;
  return {
    inspectionId: payload.i,
    ...(typeof payload.v === 'number' ? { versionNumber: payload.v } : {}),
  };
}

/**
 * Render-token access path for headless PDF generation. The Cloudflare Browser
 * Rendering headless browser cannot carry a session cookie or portal token, so
 * trusted server flows mint a short-TTL render token (above) and pass it as
 * `?render=`. Returns the token's inspectionId only when it is valid AND
 * matches the requested inspection; null otherwise (caller falls through to the
 * other auth paths / 404).
 *
 * Lives here rather than in `server/api/public-report.ts` (which re-exports it
 * for existing importers) because that file is at its size cap and this is
 * render-token logic, not routing.
 */
export async function resolveRenderAccess(
  render: string | undefined, requestedId: string, secret: string,
): Promise<{ inspectionId: string; versionNumber?: number } | null> {
  if (!render) return null;
  const v = await verifyRenderToken(render, secret);
  if (!v || v.inspectionId !== requestedId) return null;
  return v;
}

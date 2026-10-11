/**
 * Hands a solved Turnstile token to the next server round trip.
 *
 * A cookie rather than a form field because every route action would otherwise
 * have to forward it by hand; the worker entry (`workers/human-token.ts`) turns
 * it into the header the API reads. One-time by construction: Cloudflare
 * rejects a token it has already redeemed, so a stale cookie is harmless and
 * the 60-second life only keeps it from lingering.
 */
export const HUMAN_TOKEN_COOKIE = "oi-human-token";

export function setHumanToken(token: string): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${HUMAN_TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=60; SameSite=Strict${secure}`;
}

export function clearHumanToken(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${HUMAN_TOKEN_COOKIE}=; Path=/; Max-Age=0; SameSite=Strict`;
}

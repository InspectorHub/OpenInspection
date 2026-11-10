/**
 * Whether the company's own Stripe account can take a card, as the booking
 * settings need to know it.
 *
 * Read from the integrations overview rather than re-derived: that card is the
 * one place that already decides "all three keys present", so a second reading
 * here could only drift from it. Anything the overview did not say reads as
 * `unknown`, never as connected.
 */
export type StripeStatus = "connected" | "attention" | "not_connected" | "unknown";

export function stripeStatusFrom(body: unknown): StripeStatus {
  const cards = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(cards)) return "unknown";
  const card = cards.find((c): c is { id: string; status?: unknown } =>
    typeof c === "object" && c !== null && (c as { id?: unknown }).id === "stripe");
  if (!card) return "unknown";
  return card.status === "connected" || card.status === "attention" || card.status === "not_connected"
    ? card.status
    : "unknown";
}

/**
 * The same reading, from the overview request itself. A 200 whose body is not
 * JSON (a proxy error page, a truncated stream) reads as `unknown` rather than
 * throwing out of the loader and taking the whole booking page with it.
 */
export async function stripeStatusFromResponse(
  res: { ok: boolean; json: () => Promise<unknown> } | null,
): Promise<StripeStatus> {
  if (!res?.ok) return "unknown";
  try {
    return stripeStatusFrom(await res.json());
  } catch {
    return "unknown";
  }
}

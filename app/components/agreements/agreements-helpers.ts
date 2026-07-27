/**
 * Shared status presentation for agreement envelopes.
 *
 * IA-65 — the `RequestRow` / `InspectionOption` shapes that used to live here
 * described the Library page's signing table and its inspection picker. Both
 * are gone: signing requests render on the inspection they belong to, so their
 * row type comes straight from the hub payload and there is no inspection to
 * pick. Only the status mapping is genuinely shared.
 */
export type StatusTone = "sat" | "gen" | "neutral";

export function pillToneFor(status: string): StatusTone {
  if (status === "signed") return "sat";
  if (status === "declined" || status === "expired") return "neutral";
  return "gen";
}

export function pillLabelFor(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

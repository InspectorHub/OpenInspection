/**
 * A public repair-share email can be refused because the company is inside its
 * first-24-hours window. That refusal is not a failure to report: the page asks
 * the sender to pass the human check and sends again. This reads the refusal
 * off the API response and returns the site key to show the check with.
 */
export async function humanCheckSiteKey(res: { status: number; json(): Promise<unknown> }): Promise<string | null> {
  if (res.status !== 403) return null;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; details?: { turnstileSiteKey?: string | null } };
    };
    return body.error?.code === "OUTBOUND_COOLING_WINDOW" ? (body.error.details?.turnstileSiteKey ?? null) : null;
  } catch {
    return null;
  }
}

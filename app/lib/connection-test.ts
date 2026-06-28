/**
 * Shared types + loader helper for the persisted "Test connection" history.
 *
 * The server exposes `GET /api/integrations/test-results`; every settings route
 * loader (communication / integrations / advanced) parses it through
 * `parseTestResults` and hands the array to <ConnectionTestStatus>. Keeping the
 * shape + parser here means no route re-implements the fetch plumbing.
 */
export interface ConnectionTestResult {
  target: "sms" | "email" | "stripe" | "gemini";
  provider: string | null;
  ok: boolean;
  detail: string | null;
  testedByUserId: string | null;
  testedAt: number; // epoch ms
}

const TARGETS = new Set(["sms", "email", "stripe", "gemini"]);

/**
 * Tolerant parse of the test-results response. Never throws — a failed fetch,
 * non-OK status, or malformed body all collapse to an empty list so the panels
 * simply show "Not tested yet".
 */
export async function parseTestResults(
  res: { ok: boolean; json: () => Promise<unknown> } | null,
): Promise<ConnectionTestResult[]> {
  if (!res?.ok) return [];
  const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
  const rows = Array.isArray(body?.data) ? body!.data : [];
  return rows
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .filter((r) => TARGETS.has(String(r.target)))
    .map((r) => ({
      target: r.target as ConnectionTestResult["target"],
      provider: typeof r.provider === "string" ? r.provider : null,
      ok: Boolean(r.ok),
      detail: typeof r.detail === "string" ? r.detail : null,
      testedByUserId: typeof r.testedByUserId === "string" ? r.testedByUserId : null,
      testedAt: typeof r.testedAt === "number" ? r.testedAt : 0,
    }));
}

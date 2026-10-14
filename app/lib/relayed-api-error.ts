import { z } from "zod";

/**
 * The two shapes an API refusal carries its sentence in: `{ error: "text" }`
 * and the envelope `{ error: { message: "text" } }`. Anything else, or a body
 * that is not JSON at all, parses to nothing and the status line is used.
 */
const ErrorBodySchema = z.object({
  error: z.union([
    z.string(),
    z.object({ message: z.string().optional() }),
  ]).optional(),
});

/**
 * The sentence an API refusal wants shown, or `HTTP <status>` when it has none.
 *
 * Relayed rather than collapsed into a bare failure so a refusal worth reading
 * ("Cannot remove the last owner") reaches the person who pressed the button.
 */
export async function relayedApiError(res: { status: number; json(): Promise<unknown> }): Promise<string> {
  const parsed = ErrorBodySchema.safeParse(await res.json().catch(() => null));
  const error = parsed.success ? parsed.data.error : undefined;
  const message = typeof error === "string" ? error : error?.message;
  return message ?? `HTTP ${res.status}`;
}

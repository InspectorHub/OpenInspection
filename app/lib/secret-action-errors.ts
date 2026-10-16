/**
 * Readers for the error a "paste keys" action sends back, shared by every
 * settings page that has one.
 *
 * `fieldError(name)` is the message for one input (the server named the field);
 * `formError(intent)` is the message for a whole form (no field, or a generic
 * failure). Both read only a failed result: a success never produces an error.
 */
export function secretErrorReaders(actionData: object | null | undefined) {
  const r = (actionData ?? {}) as { intent?: unknown; ok?: unknown; error?: unknown; field?: unknown };
  const failed = r.ok === false && typeof r.error === "string";
  return {
    fieldError: (name: string): string | undefined =>
      failed && r.field === name ? (r.error as string) : undefined,
    formError: (intent: string): string | null =>
      failed && r.intent === intent ? (r.error as string) : null,
  };
}

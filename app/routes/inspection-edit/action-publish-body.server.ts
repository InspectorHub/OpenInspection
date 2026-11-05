/**
 * The JSON body of the publish request, read from the editor's form.
 *
 * - `summary`, the revision reason: blank or absent sends nothing, so the stored reason stays NULL rather than becoming an
 *   empty string that the amendment trail would render as a reason someone wrote.
 * - `notifyClient`, the republish choice: only an explicit "true" asks the server to notify; absent or anything else
 *   sends nothing, and the server's default is no.
 */
export function publishBody(formData: FormData): { summary?: string; notifyClient?: true } {
  const summary = String(formData.get("summary") ?? "").trim();
  return {
    ...(summary ? { summary } : {}),
    ...(formData.get("notifyClient") === "true" ? { notifyClient: true as const } : {}),
  };
}

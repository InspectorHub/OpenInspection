/**
 * The JSON body of the publish request, read from the editor's form.
 *
 * - `summary`, the revision reason: blank or absent sends nothing, so the stored reason stays NULL rather than becoming an
 *   empty string that the amendment trail would render as a reason someone wrote.
 * - `notifyClient`, the republish choice: only an explicit "true" asks the server to notify; absent or anything else
 *   sends nothing, and the server's default is no.
 * - `translateTo`, the courtesy-translation opt-in (#23, #506): a locale, or absent for none. Same power the hub
 *   modal has; the server produces the translation in the background and a failure to produce one never fails the publish.
 */
export function publishBody(formData: FormData): { summary?: string; notifyClient?: true; translateTo?: string } {
  const summary = String(formData.get("summary") ?? "").trim();
  const translateTo = String(formData.get("translateTo") ?? "").trim();
  return {
    ...(summary ? { summary } : {}),
    ...(formData.get("notifyClient") === "true" ? { notifyClient: true as const } : {}),
    ...(translateTo ? { translateTo } : {}),
  };
}

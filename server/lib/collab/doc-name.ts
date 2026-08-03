/**
 * The name a collaborative document's Durable Object is derived from.
 *
 * Keyed on the REPORT, never the inspection. This used to be
 * `${tenantId}:${inspectionId}`, which meant two inspectors working the standard
 * report and the sewer report of one order landed in the SAME Durable Object and
 * shared one Y.Doc. Nothing threw. The CRDT merged content belonging to two
 * different documents, and the corruption surfaced when a client opened a report
 * containing someone else's findings.
 *
 * Extracted into its own function so the derivation can be asserted directly:
 * two report ids are trivially unequal, so a test comparing only the OUTPUTS
 * would also pass against an implementation that still keyed on the inspection.
 * What has to be true is that the inspection id is not an input at all.
 */
export function collabDocName(tenantId: string, reportId: string): string {
    return `${tenantId}:${reportId}`;
}

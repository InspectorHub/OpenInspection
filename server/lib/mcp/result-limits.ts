/**
 * Transport limits of the MCP tool-call surface.
 *
 * Extracted from the Durable Object so route handlers and their specs can name
 * the same number the DO slices at. It matters to more than the DO: a response
 * body longer than this is CUT, so any field a caller must not miss has to be
 * serialised early. `PUT /api/admin/agreements/{id}` echoes the whole agreement
 * and puts its `effects` block before `data` for that reason (#84).
 */

/**
 * Tool results larger than this are truncated so a single call cannot blow the
 * model's context window. `readTruncated` appends a marker saying so.
 */
export const MCP_MAX_RESULT_BYTES = 48 * 1024;

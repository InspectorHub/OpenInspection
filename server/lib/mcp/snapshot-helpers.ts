/**
 * Shared reduction helper for the OpenAPI snapshot generator and drift gate.
 *
 * Converts the raw OpenAPI document produced by app.getOpenAPIDocument() into the
 * compact SnapshotEntry[] array committed at server/lib/mcp/openapi-snapshot.json.
 * Both the generator (scripts/snapshot-openapi.mjs → tests/unit/mcp/generate-snapshot.spec.ts)
 * and the drift gate (tests/unit/mcp/snapshot-drift.spec.ts) import this module so the
 * reduction logic is defined exactly once.
 */

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

interface RawParameter {
    name: string;
    in: string;
    required?: boolean;
    description?: string;
    schema?: Record<string, unknown>;
}

interface RawOperation {
    operationId?: string;
    summary?: string;
    description?: string;
    tags?: string[];
    parameters?: RawParameter[];
    requestBody?: { content?: Record<string, { schema?: Record<string, unknown> }> };
    'x-scopes'?: unknown;
    'x-tier'?: unknown;
}

interface ParameterEntry {
    /** Parameter name as declared in the OpenAPI path/query string. */
    name: string;
    /** Location of the parameter: "path" or "query". */
    in: string;
    /** Whether the parameter is required (defaults to false for query params). */
    required: boolean;
    /** Human-readable description of the parameter. */
    description: string;
    /** JSON Schema for the parameter value. */
    schema: Record<string, unknown> | null;
}

interface InputSchema {
    /** Path and query parameters for the operation. */
    parameters: ParameterEntry[];
    /** JSON Schema for the request body (application/json), or null if absent. */
    body: Record<string, unknown> | null;
}

export interface SnapshotEntry {
    /** Stable, globally-unique identifier for the operation (used as the MCP tool name). */
    operationId: string;
    /** HTTP method in upper case: GET, POST, PUT, PATCH, DELETE. */
    method: string;
    /** OpenAPI path template, e.g. /api/inspections/{id}. */
    pathTemplate: string;
    /** OAuth scope kinds required by the operation (read | write | admin | agent). */
    scopes: string[];
    /** Primary route tag — the first entry in the operation's tags array. */
    tag: string;
    /** MCP exposure tier: "primary" | "extended" | "excluded". */
    tier: string;
    /** Combined request schema (path + query params and JSON body). */
    inputSchema: InputSchema;
    /** Short operation summary (4-12 words). */
    summary: string;
    /** Full operation description (≥ 50 chars). */
    description: string;
}

/**
 * Reduce a full OpenAPI document to the compact snapshot array.
 *
 * Rules applied:
 * - Only HTTP method keys (get/post/put/patch/delete) are processed.
 * - Operations without `operationId` are skipped (page routes, etc.).
 * - Operations without `x-scopes` + `x-tier` are skipped (not MCP-annotated).
 * - Duplicate `operationId` entries are deduplicated (root-mounted auth routes
 *   appear at both `/login` and `/api/auth/login`; only the first is kept).
 * - The resulting array is sorted by `operationId` for stable diffs.
 */
export function reduceOpenApiDoc(doc: {
    paths?: Record<string, Record<string, unknown>>;
}): SnapshotEntry[] {
    const seenOpIds = new Set<string>();
    const entries: SnapshotEntry[] = [];

    for (const [pathTemplate, methods] of Object.entries(doc.paths ?? {})) {
        for (const [method, rawOp] of Object.entries(methods)) {
            if (!HTTP_METHODS.has(method)) continue;
            const op = rawOp as RawOperation;

            const operationId = op.operationId;
            if (!operationId) continue;

            // Only include operations with full MCP metadata (x-scopes + x-tier).
            if (!Array.isArray(op['x-scopes']) || typeof op['x-tier'] !== 'string') continue;

            // Deduplicate: root-mounted auth routes share the same operationId as /api/auth/*.
            if (seenOpIds.has(operationId)) continue;
            seenOpIds.add(operationId);

            const parameters: ParameterEntry[] = (op.parameters ?? []).map((p) => ({
                name: p.name,
                in: p.in,
                required: p.required ?? false,
                description: p.description ?? '',
                schema: (p.schema as Record<string, unknown> | undefined) ?? null,
            }));

            const bodySchema =
                (op.requestBody?.content?.['application/json']?.schema as
                    | Record<string, unknown>
                    | undefined) ?? null;

            entries.push({
                operationId,
                method: method.toUpperCase(),
                pathTemplate,
                scopes: op['x-scopes'] as string[],
                tag: (op.tags ?? [])[0] ?? '',
                tier: op['x-tier'] as string,
                inputSchema: { parameters, body: bodySchema },
                summary: op.summary ?? '',
                description: op.description ?? '',
            });
        }
    }

    return entries.sort((a, b) => a.operationId.localeCompare(b.operationId));
}

import { selectTools, type SnapshotEntry, type SelectToolsOptions } from './tools';

/**
 * MCP Resources (Phase E) are read-only views over the API: every GRANTED `GET`
 * operation with zero or one path parameter is surfaced as a resource so an MCP
 * client can pull data into context declaratively (vs. invoking a tool).
 *
 * - 0 path params  → a static collection resource (e.g. openinspection:///api/inspections)
 * - 1 path param   → a resource template          (e.g. openinspection:///api/inspections/{id})
 *
 * Selection reuses `selectTools` so scope/tier/excluded gating is identical to
 * tools; we then keep only GETs and drop anything with 2+ path params (no clean
 * single-variable URI template). Reads execute through the same identity bridge.
 */

export const RESOURCE_URI_SCHEME = 'openinspection://';

export interface ResourceDescriptor {
    entry: SnapshotEntry;
    /** Stable resource name (operationId, snake-cased; no tool prefix). */
    name: string;
    /** RFC 6570 URI (a template when `pathParam` is set). */
    uri: string;
    /** The single path-parameter name, or null for a collection resource. */
    pathParam: string | null;
}

const PATH_PARAM_RE = /\{([^}]+)\}/g;

function pathParamsOf(pathTemplate: string): string[] {
    return [...pathTemplate.matchAll(PATH_PARAM_RE)].map((m) => m[1]);
}

/** operationId → snake-case resource name (no `openinspection_` tool prefix). */
export function resourceNameFromOperationId(op: string): string {
    return op.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * The granted GET operations exposable as resources, as URI descriptors.
 * Operations with 2+ path params are skipped (logged by the caller if needed).
 */
export function selectResources(
    snapshot: SnapshotEntry[],
    grantedScopes: string[],
    opts: SelectToolsOptions = {},
): ResourceDescriptor[] {
    const gets = selectTools(snapshot, grantedScopes, opts).filter(
        (e) => e.method.toLowerCase() === 'get',
    );
    const out: ResourceDescriptor[] = [];
    for (const entry of gets) {
        const params = pathParamsOf(entry.pathTemplate);
        if (params.length > 1) continue; // no clean single-variable template
        out.push({
            entry,
            name: resourceNameFromOperationId(entry.operationId),
            uri: `${RESOURCE_URI_SCHEME}${entry.pathTemplate}`,
            pathParam: params[0] ?? null,
        });
    }
    return out;
}

/** Build the in-process GET request for a resource read. Resources address the
 * default view (no query params); the single path param is substituted. */
export function buildResourceRequest(
    entry: SnapshotEntry,
    vars: Record<string, string>,
): Request {
    let pathname = entry.pathTemplate;
    for (const [name, value] of Object.entries(vars)) {
        pathname = pathname.replace(`{${name}}`, encodeURIComponent(String(value)));
    }
    // Host is irrelevant — the in-process API routes purely on pathname.
    return new Request(new URL(pathname, 'https://mcp.internal').toString(), { method: 'GET' });
}

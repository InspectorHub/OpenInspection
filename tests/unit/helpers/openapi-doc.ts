/**
 * Bridge between `OpenAPIHono#getOpenAPIDocument()` and the plain
 * index-signature shape `reduceOpenApiDoc` (server/lib/mcp/snapshot-helpers.ts)
 * declares.
 *
 * `PathsObject` already indexes by string, but its VALUES are `PathItemObject`
 * — a closed interface with named members and no index signature, which
 * TypeScript will not treat as `Record<string, unknown>`. Rebuilding each item
 * through `Object.fromEntries(Object.entries(...))` produces a genuinely
 * index-signed object, so the conversion is done by construction rather than
 * asserted past the compiler.
 */
export function plainPaths(doc: {
    paths?: Record<string, object> | undefined;
}): Record<string, Record<string, unknown>> {
    return Object.fromEntries(
        Object.entries(doc.paths ?? {}).map(([path, item]) => [
            path,
            Object.fromEntries(Object.entries(item)),
        ]),
    );
}

/**
 * The one place the OpenAPI document is produced for consumers.
 *
 * `app.getOpenAPIDocument()` returns what the zod schemas declare; this wraps it
 * so schema-derived facts (length, range, enum, default, format) are appended to
 * the hand-written input descriptions before anything reads them: `/doc`, the
 * MCP tool schemas, the committed snapshot and the native contract all go
 * through here, which is what keeps them saying the same thing.
 */
import { enrichDescriptions } from './enrich-descriptions';

export function buildOpenApiDocument<C, D extends object>(
    app: { getOpenAPIDocument(config: C): D },
    config: C,
): D {
    return enrichDescriptions(app.getOpenAPIDocument(config));
}

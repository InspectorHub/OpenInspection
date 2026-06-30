// Remote MCP server Durable Object. Tool registration (Phase C / Task C4):
// at session start the granted OpenAPI operations (scope- and tier-filtered) are
// registered as MCP tools; each tool handler reconstructs the HTTP request and
// executes it in-process as the authenticated user via the identity bridge.
import { McpAgent } from 'agents/mcp';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import snapshot from '../lib/mcp/openapi-snapshot.json';
import { selectTools, toolNameFromOperationId, type SnapshotEntry } from '../lib/mcp/tools';
import { selectResources, buildResourceRequest } from '../lib/mcp/resources';
import { buildToolInput, toZodInputSchema, type ToolInput } from '../lib/mcp/resolve-schema';
import { registerGrantedPrompts } from '../lib/mcp/prompts';
import { callApiAsUser } from '../lib/mcp/identity-bridge';
import { extendedToolsEnabled } from '../lib/mcp/flag';
import type { AppEnv } from '../types/hono';

// `Env` is the global interface from worker-configuration.d.ts (extends Cloudflare.Env),
// which satisfies McpAgent's `Env extends Cloudflare.Env` constraint.
// AppEnv is the hand-maintained subset used by Hono routes and other DOs; it does not
// declare every wrangler `vars` entry so cannot be used as the McpAgent Env generic.

/**
 * OAuth grant props encrypted into every access token and passed to this DO
 * as `this.props` on each authenticated request. Later tasks (A3, C4) read
 * these for tenant scoping and tool authorization — do not rename fields.
 */
export interface McpProps extends Record<string, unknown> {
    userId:     string;
    tenantId:   string;
    tenantSlug: string;
    role:       string;
    /** e.g. ['read:inspections', 'write:bookings'] */
    scopes:     string[];
}

/** Tool results larger than this are truncated so a single call cannot blow the
 * model's context window. The marker tells the model the payload was clipped. */
const MAX_RESULT_BYTES = 48 * 1024;

/** OpenAPI document config — MUST match the snapshot generator / route-metadata
 * spec so the `components.schemas` resolved here line up with the snapshot. */
const OPENAPI_DOC_CONFIG = {
    openapi: '3.0.0',
    info: { version: '1.0.0', title: 'OpenInspection Core API' },
} as const;

/** A minimal ExecutionContext for the in-process API dispatch. The DO outlives
 * any single tool call, so deferring `waitUntil` work to a no-op is safe. */
function makeExecutionContext(): ExecutionContext {
    return {
        waitUntil() {},
        passThroughOnException() {},
        props: undefined,
    } as unknown as ExecutionContext;
}

/** Lazily resolve `components.schemas` from the live OpenAPI document. Imported
 * dynamically so the DO's top-level graph stays small (same rationale as
 * workers/app.ts and identity-bridge.callApiAsUser). */
async function getComponentSchemas(): Promise<Record<string, unknown>> {
    const { app } = await import('../index');
    const doc = app.getOpenAPIDocument(OPENAPI_DOC_CONFIG) as {
        components?: { schemas?: Record<string, unknown> };
    };
    return doc.components?.schemas ?? {};
}

/** Read a Response body as text, truncating oversized payloads. */
async function readTruncated(res: Response): Promise<string> {
    const text = await res.text();
    if (text.length <= MAX_RESULT_BYTES) return text;
    const omitted = text.length - MAX_RESULT_BYTES;
    return `${text.slice(0, MAX_RESULT_BYTES)}\n…[truncated ${omitted} chars]`;
}

/** Reconstruct the HTTP request for an operation from the tool arguments. */
function buildRequest(entry: SnapshotEntry, input: ToolInput, args: Record<string, unknown>): Request {
    let pathname = entry.pathTemplate;
    for (const name of input.pathParams) {
        const value = args[name];
        if (value !== undefined && value !== null) {
            pathname = pathname.replace(`{${name}}`, encodeURIComponent(String(value)));
        }
    }

    // Host is irrelevant — the in-process API routes purely on pathname.
    const url = new URL(pathname, 'https://mcp.internal');
    for (const name of input.queryParams) {
        const value = args[name];
        if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
    }

    const method = entry.method.toUpperCase();
    const headers = new Headers();
    const init: RequestInit = { method, headers };

    const writesBody = method !== 'GET' && method !== 'DELETE' && input.bodyParams.length > 0;
    if (writesBody) {
        headers.set('Content-Type', 'application/json');
        if (input.bodyParams.length === 1 && input.bodyParams[0] === 'body') {
            // Non-object body nested under a single `body` argument.
            init.body = JSON.stringify(args['body'] ?? null);
        } else {
            const payload: Record<string, unknown> = {};
            for (const name of input.bodyParams) {
                if (args[name] !== undefined) payload[name] = args[name];
            }
            init.body = JSON.stringify(payload);
        }
    }

    return new Request(url.toString(), init);
}

/**
 * Register every granted operation as an MCP tool on `server`.
 *
 * Extracted from `init()` so it can be driven directly in tests (against a bare
 * `McpServer`) without standing up the full DO transport. The selection is the
 * authoritative scope/tier/tag filter from Task C2; each handler re-checks the
 * scope as defense-in-depth before dispatching.
 */
export async function registerGrantedTools(
    server: McpServer,
    env: AppEnv,
    props: McpProps,
    makeCtx: () => ExecutionContext = makeExecutionContext,
): Promise<void> {
    const all = snapshot as SnapshotEntry[];
    const includeExtended = extendedToolsEnabled(env as unknown as { MCP_EXTENDED_TOOLS?: string });
    const granted = selectTools(all, props.scopes, { includeExtended });

    // Only pay the OpenAPI-document cost when a granted operation actually
    // references a named component schema (`$ref`); read-only param-only tools
    // resolve to self-contained schemas with no component lookups.
    const needsComponents = granted.some((e) => JSON.stringify(e.inputSchema ?? {}).includes('"$ref"'));
    const components = needsComponents ? await getComponentSchemas() : {};

    for (const entry of granted) {
        const name = toolNameFromOperationId(entry.operationId);
        const description = `${entry.summary ?? ''}. ${entry.description ?? ''}`.trim();
        const input = buildToolInput(entry.inputSchema as never, components);
        const inputSchema = toZodInputSchema(input.jsonSchema, entry.operationId);

        server.registerTool(name, { description, inputSchema }, async (rawArgs: unknown) => {
            const args = (rawArgs ?? {}) as Record<string, unknown>;
            // Defense-in-depth: re-assert the scope grant at call time. The
            // authoritative tenant scoping happens downstream via
            // props.tenantId → internal JWT → in-process API tenant filtering.
            if (selectTools([entry], props.scopes, { includeExtended }).length === 0) {
                return {
                    isError: true,
                    content: [{ type: 'text' as const, text: JSON.stringify({ error: 'forbidden', operationId: entry.operationId }) }],
                };
            }

            const request = buildRequest(entry, input, args);
            const res = await callApiAsUser(env, props, request, makeCtx());
            const text = await readTruncated(res);
            return {
                isError: !res.ok,
                content: [{ type: 'text' as const, text }],
            };
        });
    }
}

/**
 * Register every granted read-only (GET) operation as an MCP resource (Phase E).
 * Collection operations (no path param) become static resources; get-by-id
 * operations become resource templates. Reads run through the same identity
 * bridge as tools, so tenant scoping + RBAC are unchanged. Extracted from
 * `init()` for direct testing against a bare `McpServer`.
 */
export async function registerGrantedResources(
    server: McpServer,
    env: AppEnv,
    props: McpProps,
    makeCtx: () => ExecutionContext = makeExecutionContext,
): Promise<void> {
    const includeExtended = extendedToolsEnabled(env as unknown as { MCP_EXTENDED_TOOLS?: string });
    const resources = selectResources(snapshot as SnapshotEntry[], props.scopes, { includeExtended });

    const read = async (entry: SnapshotEntry, vars: Record<string, string>, uri: URL) => {
        // Defense-in-depth: re-assert the read grant before dispatching.
        if (selectTools([entry], props.scopes, { includeExtended }).length === 0) {
            throw new Error(`forbidden: ${entry.operationId}`);
        }
        const res = await callApiAsUser(env, props, buildResourceRequest(entry, vars), makeCtx());
        const text = await readTruncated(res);
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text }] };
    };

    for (const r of resources) {
        const config = {
            title: (r.entry.summary || r.name).trim(),
            description: `${r.entry.summary ?? ''}. ${r.entry.description ?? ''}`.trim(),
            mimeType: 'application/json',
        };
        if (r.pathParam === null) {
            server.registerResource(r.name, r.uri, config, (uri) => read(r.entry, {}, uri));
        } else {
            const param = r.pathParam;
            const template = new ResourceTemplate(r.uri, { list: undefined });
            server.registerResource(r.name, template, config, (uri, variables) => {
                const raw = variables[param];
                const value = Array.isArray(raw) ? raw[0] : raw;
                return read(r.entry, { [param]: String(value ?? '') }, uri);
            });
        }
    }
}

export class InspectorMcp extends McpAgent<Env, unknown, McpProps> {
    server = new McpServer({ name: 'OpenInspection', version: '1.0.0' });

    async init(): Promise<void> {
        // `this.props` is populated from the OAuth grant before init() runs.
        // Guard defensively: with no grant there is nothing to expose.
        if (!this.props) return;
        const env = this.env as unknown as AppEnv;
        await registerGrantedTools(this.server, env, this.props);
        await registerGrantedResources(this.server, env, this.props);
        registerGrantedPrompts(this.server, this.props);
    }
}

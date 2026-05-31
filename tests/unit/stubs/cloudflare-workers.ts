/**
 * Stub for the `cloudflare:workers` runtime module so that tests running in
 * plain Node can import src/index.ts (which transitively re-exports durable
 * objects and workflows). The stub provides minimal class bases — tests do
 * not instantiate workflows/DOs, they only need the imports to resolve.
 */

export class WorkflowEntrypoint<TEnv = unknown, TParams = unknown> {
    constructor(public ctx?: unknown, public env?: TEnv) {}
    async run(_event: unknown, _step: unknown): Promise<TParams | void> {
        return undefined;
    }
}

export class WorkflowStep {}
export class WorkflowEvent<T = unknown> {
    payload!: T;
}

export class DurableObject<TEnv = unknown> {
    constructor(public ctx?: unknown, public env?: TEnv) {}
}

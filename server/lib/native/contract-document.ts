/**
 * Builds the committed native contract document from the live OpenAPI document.
 *
 * The generator (tests/unit/native/generate-contract.spec.ts) and the drift gate
 * (tests/unit/native/contract-drift.spec.ts) both call `buildNativeContract`, so
 * the reduction is defined exactly once. The result keeps only the registered
 * (path, method) operations and the `components` they reach through `$ref`.
 *
 * Nothing here reads a secret or an environment: the document describes paths,
 * methods and schemas only, because `contracts/` is published with the source.
 */
import { NATIVE_CONTRACT, type NativeContractEntry } from './contract-registry';

export interface NativeContractBuild {
    contract: Record<string, unknown>;
    /** Registry entries the live document does not declare. */
    missing: NativeContractEntry[];
    /** `$ref` targets that point at a component the live document lacks. */
    unresolvedRefs: string[];
}

interface OpenApiLike {
    paths?: object | undefined;
    components?: object | undefined;
}

/**
 * Operation keys that steer MCP exposure, not the wire contract. Keeping them out
 * means re-tiering an MCP tool does not churn the file oasdiff compares.
 */
const MCP_ONLY_KEYS: ReadonlySet<string> = new Set(['x-scopes', 'x-tier']);

const COMPONENT_REF = /^#\/components\/([^/]+)\/(.+)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Rebuilds an object as a genuinely index-signed record, by construction rather than assertion. */
function toRecord(value: object | undefined): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value ?? {}));
}

function sortedRecord(entries: Iterable<[string, unknown]>): Record<string, unknown> {
    return Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function collectRefs(node: unknown, into: Set<string>): void {
    if (Array.isArray(node)) {
        for (const child of node) collectRefs(child, into);
        return;
    }
    if (!isRecord(node)) return;
    for (const [key, child] of Object.entries(node)) {
        if (key === '$ref' && typeof child === 'string') into.add(child);
        else collectRefs(child, into);
    }
}

export function buildNativeContract(
    doc: OpenApiLike,
    entries: readonly NativeContractEntry[] = NATIVE_CONTRACT,
): NativeContractBuild {
    const livePaths = toRecord(doc.paths);
    const liveComponents = toRecord(doc.components);

    const missing: NativeContractEntry[] = [];
    const keptPaths = new Map<string, Record<string, unknown>>();
    for (const entry of entries) {
        const item = livePaths[entry.path];
        const operation = isRecord(item) ? item[entry.method] : undefined;
        if (operation === undefined) {
            missing.push(entry);
            continue;
        }
        const kept = keptPaths.get(entry.path) ?? {};
        kept[entry.method] = isRecord(operation)
            ? Object.fromEntries(Object.entries(operation).filter(([key]) => !MCP_ONLY_KEYS.has(key)))
            : operation;
        keptPaths.set(entry.path, kept);
    }

    const refs = new Set<string>();
    for (const kept of keptPaths.values()) collectRefs(kept, refs);

    const keptComponents = new Map<string, Map<string, unknown>>();
    const unresolved = new Set<string>();
    const queue = [...refs];
    const seen = new Set<string>();
    for (let ref = queue.pop(); ref !== undefined; ref = queue.pop()) {
        if (seen.has(ref)) continue;
        seen.add(ref);
        const match = COMPONENT_REF.exec(ref);
        const group = match?.[1];
        const name = match?.[2];
        const bucket = group === undefined ? undefined : liveComponents[group];
        const target = name !== undefined && isRecord(bucket) ? bucket[name] : undefined;
        if (group === undefined || name === undefined || target === undefined) {
            unresolved.add(ref);
            continue;
        }
        const members = keptComponents.get(group) ?? new Map<string, unknown>();
        members.set(name, target);
        keptComponents.set(group, members);
        const nested = new Set<string>();
        collectRefs(target, nested);
        for (const next of nested) queue.push(next);
    }

    const components = sortedRecord(
        [...keptComponents].map(([group, members]): [string, unknown] => [group, sortedRecord(members)]),
    );

    const paths = sortedRecord(
        [...keptPaths].map(([path, methods]): [string, unknown] => [path, sortedRecord(Object.entries(methods))]),
    );

    return {
        contract: {
            openapi: '3.0.0',
            info: { title: 'OpenInspection Native Contract', version: 'native-contract' },
            paths,
            components,
        },
        missing,
        unresolvedRefs: [...unresolved].sort(),
    };
}

/** The exact bytes written to `contracts/native-contract.openapi.json`. */
export function serializeNativeContract(contract: Record<string, unknown>): string {
    return JSON.stringify(contract, null, 2) + '\n';
}

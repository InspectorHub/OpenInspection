/**
 * The judgement behind `scripts/check-native-contract.mjs`, separated from its I/O
 * so tests can feed it a registry and a document directly.
 *
 * Input: the registry entries (`{ method, path }`), the number of non-OpenAPI
 * entries, and the parsed contract document. Output: the line the gate prints on
 * every run (both numbers, pass or fail) and the list of errors, empty when the
 * registry and the document agree.
 */

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

export function evaluateNativeContract({ registry, nonOpenApiCount, contract, contractPath }) {
    const documented = new Set();
    for (const [path, item] of Object.entries(contract.paths ?? {})) {
        for (const method of Object.keys(item)) {
            if (METHODS.has(method)) documented.add(`${method} ${path}`);
        }
    }

    const registered = registry.map((e) => `${e.method} ${e.path}`);
    const found = registered.filter((key) => documented.has(key));
    const missing = registered.filter((key) => !documented.has(key));
    const registeredSet = new Set(registered);
    const unregistered = [...documented].filter((key) => !registeredSet.has(key));

    const summary = `native-contract: ${registered.length} registry entries, ${found.length} found in OpenAPI, `
        + `${nonOpenApiCount} non-OpenAPI entries pinned by tests`;

    const errors = [];
    if (registered.length === 0) errors.push('the registry lists ZERO entries -- an empty list would pass every check below.');
    if (found.length === 0) errors.push(`${contractPath} documents none of the registry entries.`);
    if (missing.length) {
        errors.push(`${missing.length} registry entr${missing.length === 1 ? 'y is' : 'ies are'} not in ${contractPath}:\n${missing.map((m) => `    ${m}`).join('\n')}`);
    }
    if (unregistered.length) {
        errors.push(`${unregistered.length} operation(s) in ${contractPath} are not in the registry:\n${unregistered.map((m) => `    ${m}`).join('\n')}`);
    }
    if (registered.length !== new Set(registered).size) errors.push('the registry contains duplicate entries.');

    return { summary, errors };
}

#!/usr/bin/env node
/**
 * Native-contract gate: the registry and the committed contract must agree.
 *
 * `scripts/lib/native-contract-registry.ts` lists every endpoint the native app
 * calls; `contracts/native-contract.openapi.json` is the OpenAPI slice CI diffs
 * against the base branch with oasdiff. If the two drift apart the diff guards
 * the wrong set: a registry entry with no operation in the file is a promise
 * nothing checks, and an operation in the file with no registry entry is a
 * surface nobody decided to promise.
 *
 * This gate reads only those two files (no app boot, well under a second). It
 * cannot see the live API: that comparison is tests/unit/native/contract-drift.spec.ts,
 * which regenerates the document and fails when the committed file is stale.
 *
 * Registered at the PUSH rung, not PRECOMMIT: the registry changes when an
 * endpoint joins the app's surface, which is authored in batches, and a new
 * PRECOMMIT row is a cost every commit in the repo pays.
 *
 * Both numbers print on every run, pass or fail. Zero found, or fewer found than
 * registered, exits 1 and names each missing entry.
 *
 * The registry is erasable TypeScript, imported under Node's type stripping.
 *
 * console.* is intentional -- this is a build script, not server code.
 */
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluateNativeContract } from './lib/native-contract-check.mjs';
import * as defaultRegistry from './lib/native-contract-registry.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// `--registry <file>` and `--contract <file>` point the gate at other inputs. They
// exist so tests/unit/native/check-native-contract.spec.ts can run the real script
// against fixtures; the gate registry passes neither.
function flag(name) {
    const i = process.argv.indexOf(name);
    return i === -1 ? undefined : process.argv[i + 1];
}
const resolveInput = (value, fallback) => (value === undefined ? join(ROOT, fallback) : isAbsolute(value) ? value : resolve(value));
const REGISTRY = 'scripts/lib/native-contract-registry.ts';
const CONTRACT = 'contracts/native-contract.openapi.json';
const registryFile = resolveInput(flag('--registry'), REGISTRY);
const contractFile = resolveInput(flag('--contract'), CONTRACT);

// The default registry is imported statically so the module graph (knip, lint:unwired) sees the
// gate reach it; only the test-only --registry override is loaded through a computed path.
const { NATIVE_CONTRACT, NATIVE_NON_OPENAPI_CONTRACT } = flag('--registry') === undefined
    ? defaultRegistry
    : await import(pathToFileURL(registryFile).href);

let contract;
try {
    contract = JSON.parse(readFileSync(contractFile, 'utf8'));
} catch (err) {
    console.error(`native-contract: cannot read ${CONTRACT}: ${err instanceof Error ? err.message : String(err)}`);
    console.error('  fix: npm run native:contract');
    process.exit(1);
}

const { summary, errors } = evaluateNativeContract({
    registry: NATIVE_CONTRACT,
    nonOpenApiCount: NATIVE_NON_OPENAPI_CONTRACT.length,
    contract,
    contractPath: CONTRACT,
});
console.log(summary);

if (errors.length) {
    for (const e of errors) console.error(`  ✘ ${e}`);
    console.error('  fix: edit scripts/lib/native-contract-registry.ts, then npm run native:contract');
    process.exit(1);
}

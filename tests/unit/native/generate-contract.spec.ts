/**
 * Native contract generator -- writes contracts/native-contract.openapi.json.
 *
 * Invoked via `npm run native:contract` (which sets GENERATE_NATIVE_CONTRACT=true
 * and runs this file under vitest). The describe block is skipped during normal
 * `npm run test:unit` runs. Same mechanism as tests/unit/mcp/generate-snapshot.spec.ts:
 * server/index.ts imports `cloudflare:workers`, which only the vitest harness stubs.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../../../server/index';
import { buildNativeContract, serializeNativeContract } from '../../../server/lib/native/contract-document';
import { NATIVE_CONTRACT } from '../../../server/lib/native/contract-registry';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = resolve(__dirname, '../../../contracts/native-contract.openapi.json');

describe.runIf(process.env['GENERATE_NATIVE_CONTRACT'] === 'true')(
    'native contract generator',
    { timeout: 30_000 },
    () => {
        it('writes native-contract.openapi.json', () => {
            const doc = app.getOpenAPIDocument({
                openapi: '3.0.0',
                info: { version: 'native-contract', title: 'OpenInspection Native Contract' },
            });
            const { contract, missing, unresolvedRefs } = buildNativeContract(doc);
            expect(
                missing.map((m) => `${m.method} ${m.path}`),
                'every registry entry must be declared in the live OpenAPI document',
            ).toEqual([]);
            expect(unresolvedRefs, 'every $ref must resolve to a component').toEqual([]);
            mkdirSync(dirname(CONTRACT_PATH), { recursive: true });
            writeFileSync(CONTRACT_PATH, serializeNativeContract(contract), 'utf-8');
            console.log(`[native:contract] Wrote ${NATIVE_CONTRACT.length} operations -> ${CONTRACT_PATH}`);
        });
    },
);

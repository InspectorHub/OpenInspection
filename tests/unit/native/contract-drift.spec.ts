/**
 * Native contract drift gate.
 *
 * Fails when the live API diverges from the committed
 * contracts/native-contract.openapi.json, or when a registry entry names an
 * operation the API does not declare. To fix: run `npm run native:contract`,
 * review the diff (CI runs oasdiff on it against the base branch), and commit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../../../server/index';
import { buildNativeContract, serializeNativeContract } from '../../helpers/native-contract-document';
import { NATIVE_CONTRACT, type NativeContractEntry } from '../../../scripts/lib/native-contract-registry';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = resolve(__dirname, '../../../contracts/native-contract.openapi.json');

function liveDocument() {
    return app.getOpenAPIDocument({
        openapi: '3.0.0',
        info: { version: 'native-contract', title: 'OpenInspection Native Contract' },
    });
}

describe('native contract drift', { timeout: 30_000 }, () => {
    it('finds every registry entry in the live OpenAPI document', () => {
        // Throws on a dangling $ref, so reaching the assertion means every one resolved.
        const { missing } = buildNativeContract(liveDocument());
        expect(missing.map((m) => `${m.method} ${m.path}`)).toEqual([]);
    });

    it('lists a registry entry the API does not declare, by name (positive control)', () => {
        const control: NativeContractEntry = { method: 'get', path: '/api/native-contract-control/{id}' };
        const { missing } = buildNativeContract(liveDocument(), [...NATIVE_CONTRACT, control]);
        expect(missing).toEqual([control]);
    });

    it('refuses to build when an operation points at a component the document lacks (positive control: it builds once the component exists)', () => {
        const entry: NativeContractEntry = { method: 'get', path: '/api/ref-control' };
        const operation = { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/RefControl' } } } } } };
        const doc = { paths: { '/api/ref-control': { get: operation } }, components: { schemas: {} } };
        expect(() => buildNativeContract(doc, [entry])).toThrow(/#\/components\/schemas\/RefControl/);
        const fixed = { ...doc, components: { schemas: { RefControl: { type: 'object' } } } };
        expect(buildNativeContract(fixed, [entry]).missing).toEqual([]);
    });

    it('has no duplicate registry entries', () => {
        const keys = NATIVE_CONTRACT.map((e) => `${e.method} ${e.path}`);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('live API matches the committed contract (run `npm run native:contract` to fix)', () => {
        const { contract } = buildNativeContract(liveDocument());
        const committed: unknown = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8'));
        expect(committed).toEqual(contract);
    });

    it('commits the contract in the exact bytes the generator writes', () => {
        const { contract } = buildNativeContract(liveDocument());
        expect(readFileSync(CONTRACT_PATH, 'utf-8')).toBe(serializeNativeContract(contract));
    });

    it('describes every registered operation and nothing else', () => {
        const committed: unknown = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8'));
        const paths = typeof committed === 'object' && committed !== null && 'paths' in committed
            ? Object.fromEntries(Object.entries(committed.paths ?? {})) : {};
        const listed = Object.entries(paths).flatMap(([p, item]) =>
            Object.keys(typeof item === 'object' && item !== null ? item : {}).map((m) => `${m} ${p}`));
        expect(listed.sort()).toEqual(NATIVE_CONTRACT.map((e) => `${e.method} ${e.path}`).sort());
    });
});

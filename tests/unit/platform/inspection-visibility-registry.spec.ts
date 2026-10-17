/**
 * Declaration versus enforcement for the inspection visibility scope.
 *
 * `authorization-surface.spec.ts` checks capabilities against routes. This does the same job for
 * visibility, in three layers that watch different things (see the data file for why). The point
 * of every assertion below is that a NEW route or file fails here until someone says how it is
 * kept inside a restricted inspector's scope.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { app } from '../../../server/index';
import { VIEW_ALL_SETTABLE } from '../../../server/lib/auth/capabilities';
import {
    SET_READS, API_FILE_CLASSIFICATION, ALL_INSPECTIONS_AUDITED_USES, READ_PREFIXES,
} from './inspection-visibility-registry';

type R = { method: string; path: string; handler: { inspectionScopeGuard?: boolean } };
const routes = (): R[] => (app as unknown as { routes: R[] }).routes;
const inFamily = (p: string) => /^\/api\/inspections\/:[^/]+(\/|$)/.test(p);
/** Unique "METHOD path" keys of the real route table, without middleware entries. */
const routeKeys = (): Set<string> => new Set(
    routes().filter(r => r.method !== 'ALL' && !r.path.includes('*')).map(r => `${r.method} ${r.path}`),
);

const PUBLIC_PREFIXES = ['/api/public', '/api/portal', '/webhooks', '/m2m', '/api/platform', '/api/agent', '/api/agents', '/api/__test__', '/.well-known'];
const isPublic = (p: string) => PUBLIC_PREFIXES.some(x => p === x || p.startsWith(`${x}/`));

const TABLES = new Set(['inspections', 'inspectionResults', 'inspectionPeople', 'inspectionMessages', 'inspectionInspectors', 'inspectionEvents', 'invoices', 'agreementRequests']);

/** server/api files that import an inspection-derived table from the schema, aliased or not. */
function scanApiFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { walk(p); continue; }
            if (!e.name.endsWith('.ts')) continue;
            const src = fs.readFileSync(p, 'utf8');
            const re = /import\s*\{([^}]*)\}\s*from\s*'[^']*db\/schema[^']*'/g;
            let m: RegExpExecArray | null;
            let hit = false;
            while ((m = re.exec(src))) {
                for (const spec of m[1]!.split(',')) {
                    const name = spec.trim().split(/\s+as\s+/)[0]!.replace(/^type\s+/, '');
                    if (TABLES.has(name)) hit = true;
                }
            }
            if (hit) out.push(p.split(path.sep).join('/'));
        }
    };
    walk('server/api');
    return out.sort();
}

describe('inspection visibility registry', { timeout: 60_000 }, () => {
    it('route-table layer: every route under /api/inspections/:id is behind the path guard, and both numbers print', () => {
        const all = routes();
        const guardIdx = all.map((r, i) => (r.handler?.inspectionScopeGuard ? i : -1)).filter(i => i >= 0);
        const covered = all.map((r, i) => ({ r, i })).filter(({ r }) => inFamily(r.path) && !r.handler?.inspectionScopeGuard);
        // eslint-disable-next-line no-console
        console.log(`[gate] visibility registry: guard entries=${guardIdx.length} covered handlers=${covered.length}`);
        expect(guardIdx.length).toBe(2);
        expect(covered.length).toBeGreaterThan(50);
        const unguarded = covered.filter(({ i }) => i < Math.min(...guardIdx)).map(({ r }) => `${r.method} ${r.path}`);
        expect(unguarded, unguarded.join('\n')).toEqual([]);
    });

    it('route-table layer: every route outside the family that carries an inspection id, or reads on a data prefix, is declared', () => {
        const declared = new Set(Object.keys(SET_READS));
        const candidates = [...routeKeys()].filter((key) => {
            const [method, p] = [key.slice(0, key.indexOf(' ')), key.slice(key.indexOf(' ') + 1)];
            if (inFamily(p) || isPublic(p)) return false;
            if (/:inspectionId|:inspection_id|by-inspection/.test(p)) return true;
            if (method !== 'GET') return false;
            return READ_PREFIXES.some(x => p === x || p.startsWith(`${x}/`));
        });
        // eslint-disable-next-line no-console
        console.log(`[gate] visibility registry: candidate routes=${candidates.length} declared=${declared.size}`);
        expect(candidates.length).toBeGreaterThan(10); // a broken walk must not read as green
        const missing = candidates.filter(k => !declared.has(k));
        expect(missing, missing.join('\n')).toEqual([]);
    });

    it('every SET_READS key names a route that exists (no stale entries)', () => {
        const have = routeKeys();
        const stale = Object.keys(SET_READS).filter(k => !have.has(k));
        expect(stale, stale.join('\n')).toEqual([]);
    });

    it('source layer: every server/api file that imports an inspection-derived table is classified', () => {
        const scanned = scanApiFiles();
        const classified = Object.keys(API_FILE_CLASSIFICATION);
        // eslint-disable-next-line no-console
        console.log(`[gate] visibility registry: scanned=${scanned.length} classified=${classified.length}`);
        expect(scanned.length, `scanned=${scanned.length} classified=${classified.length}`).toBeGreaterThan(20);
        const missing = scanned.filter(f => !(f in API_FILE_CLASSIFICATION));
        const stale = classified.filter(f => !scanned.includes(f));
        expect(missing, `unclassified:\n${missing.join('\n')}`).toEqual([]);
        expect(stale, `stale:\n${stale.join('\n')}`).toEqual([]);
    });

    it('ALL_INSPECTIONS is named only by files on the audited list', () => {
        const users: string[] = [];
        const walk = (dir: string) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) { walk(p); continue; }
                if (/\.(ts|tsx)$/.test(e.name) && fs.readFileSync(p, 'utf8').includes('ALL_INSPECTIONS')) users.push(p.split(path.sep).join('/'));
            }
        };
        walk('server');
        // eslint-disable-next-line no-console
        console.log(`[gate] visibility registry: ALL_INSPECTIONS files=${users.length} audited=${ALL_INSPECTIONS_AUDITED_USES.length}`);
        expect(users.length).toBeGreaterThan(0);
        const unaudited = users.filter(f => !ALL_INSPECTIONS_AUDITED_USES.includes(f));
        expect(unaudited, `add each to ALL_INSPECTIONS_AUDITED_USES after review:\n${unaudited.join('\n')}`).toEqual([]);
        const stale = ALL_INSPECTIONS_AUDITED_USES.filter(f => !users.includes(f));
        expect(stale, stale.join('\n')).toEqual([]);
    });

    it('viewAllInspections stays unsettable while any read path is still pending', () => {
        const pending = [
            ...Object.entries(SET_READS).filter(([, e]) => e.status === 'pending').map(([k]) => `route ${k}`),
            ...Object.entries(API_FILE_CLASSIFICATION).filter(([, e]) => e.status === 'pending').map(([k]) => `file ${k}`),
        ];
        // eslint-disable-next-line no-console
        console.log(`[gate] visibility registry: pending=${pending.length} settable=${VIEW_ALL_SETTABLE}`);
        if (VIEW_ALL_SETTABLE) expect(pending, pending.join('\n')).toEqual([]);
        // while the switch is closed pending entries are allowed; when the last one is enforced, flip it
    });

    it('the registry only holds entries that say why', () => {
        for (const [k, e] of [...Object.entries(SET_READS), ...Object.entries(API_FILE_CLASSIFICATION)]) {
            expect(e.reason.trim().length, k).toBeGreaterThan(8);
        }
    });
});

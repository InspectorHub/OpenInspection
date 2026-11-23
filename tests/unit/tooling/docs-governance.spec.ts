import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(__dirname, '..', '..', '..');
type Rule = { code: string[]; docs: string[] };
type Claim = { kind: 'path' | 'npm-script'; value: string; prefix: string | null; line: number };
let docsImpact: (files: string[], rules: Rule[]) => Array<{ rule: Rule; missingDocs: string[] }>;
let checkChangedCommit: (files: string[], message: string, rules: Rule[]) => string[];
let parseDocsTrailer: (message: string, changed?: string[] | null) => { kind: 'updated'; paths: string[] } | { kind: 'na'; reason: string } | null;
let validateMap: (rules: Rule[], files: string[], exists?: (path: string) => boolean) => string[];
let validateNaReason: (reason: string) => boolean;
let extractClaims: (text: string) => Claim[];
let resolveClaims: (claims: Claim[], context: { trackedFiles: string[]; scripts: Set<string>; repoRoot?: string; packageScriptsAt?: (dir: string) => Set<string> | null; docFile?: string; suffixSet: Set<string> }) => Array<{ claim: Claim; ok: boolean }>;
let buildSuffixSet: (files: string[]) => Set<string>;
let baselineDoesNotRise: (next: number, previous: number | null) => boolean;
let renderEnvironmentDoc: (input: { vars: Record<string, string>; properties: Array<{ name: string; optional: boolean; scope?: string }> }) => string;
let compareGenerated: (current: string, generated: string) => boolean;
let missingEnvironmentNames: (current: string, generated: string) => string[];
let configurationScope: (input: { vars: boolean; tenantConfigured?: boolean; tenantOwned?: boolean; integrationSecret?: boolean; splitIntegration?: boolean }) => string;

beforeAll(async () => {
    const load = async (name: string) => import(/* @vite-ignore */ pathToFileURL(join(ROOT, 'scripts/lib', name)).href);
    ({ docsImpact, checkChangedCommit, parseDocsTrailer, validateMap, validateNaReason } = await load('docs-impact.mjs'));
    ({ extractClaims, resolveClaims, buildSuffixSet, baselineDoesNotRise } = await load('doc-claims.mjs'));
    ({ renderEnvironmentDoc, compareGenerated, missingEnvironmentNames, configurationScope } = await load('environment-doc.mjs'));
});

describe('docs impact checks', () => {
    const rules = [{ code: ['server/api/inspections/**'], docs: ['docs/reference/api/inspections.md'] }];

    it('requires affected docs when a changed source matches a rule', () => {
        expect(docsImpact(['server/api/inspections/list.ts'], rules)).toEqual([
            { rule: rules[0], missingDocs: ['docs/reference/api/inspections.md'] },
        ]);
        expect(docsImpact(['server/api/inspections/list.ts', 'docs/reference/api/inspections.md'], rules)).toEqual([]);
    });

    it('accepts only meaningful n/a reasons and requires updated paths in the diff', () => {
        expect(parseDocsTrailer('fix: x\n\nDocs: n/a — pure refactor with no behavior change')).toEqual({ kind: 'na', reason: 'pure refactor with no behavior change' });
        expect(validateNaReason('tbd')).toBe(false);
        expect(parseDocsTrailer('Docs: docs/reference/api/inspections.md', ['docs/reference/api/inspections.md'])).toEqual({ kind: 'updated', paths: ['docs/reference/api/inspections.md'] });
        expect(parseDocsTrailer('docs: improve API docs\n\nDocs: docs/reference/api/inspections.md', ['docs/reference/api/inspections.md'])).toEqual({ kind: 'updated', paths: ['docs/reference/api/inspections.md'] });
        expect(parseDocsTrailer('Docs: docs/other.md', ['server/api/inspections/list.ts'])).toBeNull();
        expect(parseDocsTrailer('Docs: n/a — tbd')).toBeNull();
        expect(checkChangedCommit(['server/api/inspections/list.ts', 'docs/reference/api/inspections.md'], 'fix: x\n\nDocs: docs/reference/api/inspections.md', rules)).toEqual([]);
        expect(checkChangedCommit(['server/api/inspections/list.ts', 'docs/other.md'], 'fix: x\n\nDocs: docs/other.md', rules)).toHaveLength(1);
        expect(checkChangedCommit(['server/api/inspections/list.ts'], 'refactor: x\n\nDocs: n/a — pure refactor with no behavior change', rules)).toEqual([]);
    });

    it('requires an updated docs path for every affected rule', () => {
        const multiRules = [
            { code: ['workers/app.ts'], docs: ['docs/develop/architecture.md'] },
            { code: ['server/api/inspections/**'], docs: ['docs/reference/api/inspections.md'] },
        ];
        const files = [
            'workers/app.ts',
            'server/api/inspections/list.ts',
            'docs/develop/architecture.md',
        ];
        const message = 'fix: update request flow\n\nDocs: docs/develop/architecture.md';
        expect(checkChangedCommit(files, message, multiRules)).toContain('Docs: must name at least one updated path for each affected rule');
        expect(checkChangedCommit(
            [...files, 'docs/reference/api/inspections.md'],
            `${message}, docs/reference/api/inspections.md`,
            multiRules,
        )).toEqual([]);
    });

    it('rejects maps with dead globs, dead docs, and overly broad rules', () => {
        const tracked = [
            'server/api/inspections/list.ts', 'server/api/inspections/show.ts', 'server/lib/a.ts', 'server/lib/b.ts',
            'app/routes/a.tsx', 'app/routes/b.tsx', 'scripts/a.mjs', 'scripts/b.mjs', 'tests/a.ts', 'tests/b.ts',
        ];
        expect(validateMap(rules, tracked, () => true)).toEqual([]);
        expect(validateMap([{ code: ['missing/**'], docs: ['docs/no.md'] }], tracked, () => false)).toHaveLength(2);
        expect(validateMap([{ code: ['server/**'], docs: ['docs/reference/api/inspections.md'] }], tracked, () => true).some((error) => error.includes('too broad'))).toBe(true);
    });
});

describe('documentation claims', () => {
    it('extracts inline paths and npm scripts but skips fenced examples', () => {
        expect(extractClaims('See `docs/reference/api.md` and `npm run lint` plus `npm run a`.\n```\n`docs/missing.md`\n```')).toEqual([
            { kind: 'path', value: 'docs/reference/api.md', prefix: null, line: 1 },
            { kind: 'npm-script', value: 'lint', prefix: null, line: 1 },
        ]);
    });

    it('resolves claims against tracked paths and declared package scripts', () => {
        const claims = extractClaims('`docs/reference/api.md` `docs/missing.md` `npm run lint` `npm run missing`');
        const result = resolveClaims(claims, {
            trackedFiles: ['docs/reference/api.md'],
            scripts: new Set(['lint']),
            docFile: 'docs/README.md',
            suffixSet: buildSuffixSet(['docs/reference/api.md']),
        });
        expect(result.filter((item) => !item.ok)).toHaveLength(2);
        expect(result.filter((item) => !item.ok).map((item) => item.claim.value)).toEqual(['docs/missing.md', 'missing']);
    });

    it('does not resolve --prefix scripts through a package outside the repository', () => {
        const claims = extractClaims('Run `npm --prefix ../private-app run release` and `npm --prefix packages/data-package run build`.');
        const lookups: string[] = [];
        const result = resolveClaims(claims, {
            trackedFiles: [],
            scripts: new Set(),
            repoRoot: resolve('public/OpenInspection'),
            packageScriptsAt: (directory) => { lookups.push(directory); return new Set(['build']); },
            suffixSet: new Set(),
        });
        expect(result[0].ok).toBe(false);
        expect(result[1].ok).toBe(true);
        expect(lookups).toEqual([resolve('public/OpenInspection/packages/data-package')]);
    });

    it('allows the numeric baseline to stay or fall but never rise', () => {
        expect(baselineDoesNotRise(0, 4)).toBe(true);
        expect(baselineDoesNotRise(4, 4)).toBe(true);
        expect(baselineDoesNotRise(5, 4)).toBe(false);
        expect(baselineDoesNotRise(-1, null)).toBe(false);
    });
});

describe('environment reference generation', () => {
    it('labels tenant-injected and deployment-plus-tenant integration settings separately', () => {
        expect(configurationScope({ vars: false, tenantConfigured: true, integrationSecret: true })).toBe('Tenant setting (request-injected)');
        expect(configurationScope({ vars: false, tenantOwned: true, integrationSecret: true })).toBe('Tenant setting takes precedence over deployment default');
        expect(configurationScope({ vars: false, integrationSecret: true })).toBe('Deployment default and tenant fallback (request-injected)');
        expect(configurationScope({ vars: false, integrationSecret: true, splitIntegration: true })).toBe('Tenant key for BYO inbound/status; deployment binding for managed compliance webhook');
        expect(configurationScope({ vars: true })).toBe('Deployment configuration');
    });

    it('includes configured variables and typed settings without copying secret values', () => {
        const markdown = renderEnvironmentDoc({
            vars: { APP_MODE: 'standalone' },
            properties: [
                { name: 'DB', optional: false },
                { name: 'JWT_SECRET', optional: true },
                { name: 'SENDGRID_API_KEY', optional: true, scope: 'Tenant setting (request-injected)' },
            ],
        });
        expect(markdown).toContain('APP_MODE');
        expect(markdown).toContain('JWT_SECRET');
        expect(markdown).toContain('DB');
        expect(markdown).toContain('SENDGRID_API_KEY');
        expect(markdown).toContain('Tenant setting (request-injected)');
        expect(markdown).toContain('Configuration scope');
        expect(markdown).not.toContain('standalone');
        expect(markdown).toContain('Optional');
        expect(compareGenerated(markdown.replace('JWT_SECRET', 'OLD_SECRET'), markdown)).toBe(false);
        expect(compareGenerated(markdown.replace(/\n/g, '\r\n'), markdown)).toBe(true);
        expect(missingEnvironmentNames(markdown.replace('JWT_SECRET', 'OLD_SECRET'), markdown)).toEqual(['JWT_SECRET']);
    });

    it('uses source annotations and the integration-secret catalog in the generated reference', () => {
        execFileSync(process.execPath, ['scripts/gen-env-doc.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' });
        const markdown = readFileSync(join(ROOT, 'docs/reference/environment-variables.md'), 'utf8');
        expect(markdown).toContain('| `SENDGRID_API_KEY` | Optional | Worker environment type | Tenant setting (request-injected) |');
        expect(markdown).toContain('| `ISN_ACCESS_KEY` | Optional | Worker environment type | Tenant setting takes precedence over deployment default |');
        expect(markdown).toContain('| `STRIPE_SECRET_KEY` | Optional | Worker environment type | Tenant setting takes precedence over deployment default |');
        expect(markdown).toContain('| `RESEND_API_KEY` | Required | Worker environment type | Deployment default and tenant fallback (request-injected) |');
        expect(markdown).toContain('| `TWILIO_ACCOUNT_SID` | Optional | Worker environment type | Deployment default and tenant fallback (request-injected) |');
        expect(markdown).toContain('| `TELNYX_PUBLIC_KEY` | Optional | Worker environment type | Tenant key for BYO inbound/status; deployment binding for managed compliance webhook |');
    });
});

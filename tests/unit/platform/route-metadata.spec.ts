/**
 * Route metadata gate — fails CI when any route in server/api/ lacks the
 * required MCP/Skill metadata. See:
 *   docs/route-metadata-conventions.md
 *
 * The SKIP_MODULES set lists modules not yet backfilled. As each module is
 * brought up to standard, its prefix is removed from the set. Phase 0 is
 * complete when the set is empty.
 */
import { describe, it, expect } from 'vitest';
import { app } from '../../../server/index';
import {
    VALID_TAGS,
    VALID_SECONDARY_TAGS,
    VALID_SCOPES,
    VALID_TIERS,
    MIN_SUMMARY_WORDS,
    MAX_SUMMARY_WORDS,
    MIN_DESCRIPTION_CHARS,
    MIN_FIELD_DESCRIPTION_CHARS,
    PRIMARY_TIER_CAP,
} from '../../../server/lib/route-metadata-standards';

// Phase 0 done: every /api/* module has full route metadata + field descriptions
// (route metadata from PR #21, Zod field descriptions from this PR).
// Only HTML page mounts remain. The ten root-mounted mirrors of /api/auth/*
// that used to be skipped here are gone: the auth router is mounted once, at
// /api/auth, and `GET /sso` — the one auth path still answering at the root —
// is NOT skipped, so it is held to the same metadata standard as the rest.
const SKIP_MODULES = new Set([
    // Misc page routes (HTML pages outside the API surface)
    '/settings',
    '/inspections',
    '/agent-dashboard',
    '/book',
    '/auth',
    '/',
]);

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

function moduleOf(path: string): string {
    // '/api/inspections/{id}/results' → '/api/inspections'
    // '/setup/wizard' → '/setup'
    // '/' → '/'
    if (path === '/') return '/';
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) return '/';
    if (parts[0] === 'api' && parts.length >= 2) return `/api/${parts[1]}`;
    return `/${parts[0]}`;
}

function getOpenApiDoc() {
    return app.getOpenAPIDocument({
        openapi: '3.0.0',
        info: { version: 'test', title: 'OpenInspection Core API' },
    });
}

interface OperationLike {
    operationId?: string;
    summary?: string;
    description?: string;
    tags?: string[];
    parameters?: Array<{ name: string; description?: string; schema?: unknown }>;
    requestBody?: { content?: Record<string, { schema?: unknown }> };
    [key: string]: unknown;
}

function eachOperation(): Array<{ method: string; path: string; op: OperationLike; where: string }> {
    const doc = getOpenApiDoc();
    const results: Array<{ method: string; path: string; op: OperationLike; where: string }> = [];
    // Deduplicate by operationId — a few routes answer at two paths (ssoConsume
    // at /api/auth/sso and /sso, and two aliased upload/import routes). Metadata
    // lives on the single createRoute object, so validating it once is enough.
    const seenOpIds = new Set<string>();
    for (const [path, methods] of Object.entries(doc.paths ?? {})) {
        const mod = moduleOf(path);
        if (SKIP_MODULES.has(mod)) continue;
        for (const [method, op] of Object.entries(methods as Record<string, OperationLike>)) {
            if (!HTTP_METHODS.has(method)) continue;
            // Dedup on operationId once it's set; before backfill operationId is
            // missing and we just include all paths (the operationId-presence
            // test will report each one separately).
            if (op.operationId) {
                if (seenOpIds.has(op.operationId)) continue;
                seenOpIds.add(op.operationId);
            }
            results.push({ method, path, op, where: `${method.toUpperCase()} ${path}` });
        }
    }
    return results;
}

// C-13 — each test regenerates the full OpenAPI document over the whole app;
// under CPU contention that exceeds the 5s default and flaps the suite.
describe('route metadata', { timeout: 30_000 }, () => {
    it('every route has an operationId', () => {
        const missing = eachOperation()
            .filter(({ op }) => !op.operationId)
            .map(({ where }) => where);
        expect(missing, `Routes missing operationId:\n${missing.join('\n')}`).toEqual([]);
    });

    it('operationIds are globally unique', () => {
        const seen = new Map<string, string>();
        const dupes: string[] = [];
        for (const { op, where } of eachOperation()) {
            if (!op.operationId) continue;
            const prior = seen.get(op.operationId);
            if (prior) dupes.push(`${op.operationId}: ${prior} vs ${where}`);
            else seen.set(op.operationId, where);
        }
        expect(dupes, `Duplicate operationIds:\n${dupes.join('\n')}`).toEqual([]);
    });

    it('every route has a valid summary (4-12 words, no trailing period)', () => {
        const issues: string[] = [];
        for (const { op, where } of eachOperation()) {
            if (!op.summary) {
                issues.push(`${where}: missing summary`);
                continue;
            }
            const wordCount = op.summary.trim().split(/\s+/).length;
            if (wordCount < MIN_SUMMARY_WORDS || wordCount > MAX_SUMMARY_WORDS) {
                issues.push(`${where}: summary "${op.summary}" has ${wordCount} words (want ${MIN_SUMMARY_WORDS}-${MAX_SUMMARY_WORDS})`);
            }
            if (op.summary.endsWith('.')) {
                issues.push(`${where}: summary should not end with a period`);
            }
        }
        expect(issues, issues.join('\n')).toEqual([]);
    });

    it(`every route has a description (≥ ${MIN_DESCRIPTION_CHARS} chars)`, () => {
        const issues: string[] = [];
        for (const { op, where } of eachOperation()) {
            if (!op.description) {
                issues.push(`${where}: missing description`);
                continue;
            }
            if (op.description.length < MIN_DESCRIPTION_CHARS) {
                issues.push(`${where}: description ${op.description.length} chars (need ≥ ${MIN_DESCRIPTION_CHARS})`);
            }
        }
        expect(issues, issues.join('\n')).toEqual([]);
    });

    it('every route has at least one valid tag', () => {
        const allValid = new Set<string>([...VALID_TAGS, ...VALID_SECONDARY_TAGS]);
        const issues: string[] = [];
        for (const { op, where } of eachOperation()) {
            if (!op.tags || op.tags.length === 0) {
                issues.push(`${where}: missing tags`);
                continue;
            }
            for (const t of op.tags) {
                if (!allValid.has(t)) issues.push(`${where}: invalid tag "${t}"`);
            }
        }
        expect(issues, issues.join('\n')).toEqual([]);
    });

    it('every route declares x-scopes (array of valid scopes)', () => {
        const issues: string[] = [];
        for (const { op, where } of eachOperation()) {
            const scopes = op['x-scopes'] as readonly string[] | undefined;
            if (!Array.isArray(scopes)) {
                issues.push(`${where}: missing x-scopes (expected array)`);
                continue;
            }
            for (const s of scopes) {
                if (!(VALID_SCOPES as readonly string[]).includes(s)) {
                    issues.push(`${where}: invalid scope "${s}"`);
                }
            }
        }
        expect(issues, issues.join('\n')).toEqual([]);
    });

    it('every route declares x-tier (primary | extended | excluded)', () => {
        const issues: string[] = [];
        for (const { op, where } of eachOperation()) {
            const tier = op['x-tier'] as string | undefined;
            if (!tier) {
                issues.push(`${where}: missing x-tier`);
                continue;
            }
            if (!(VALID_TIERS as readonly string[]).includes(tier)) {
                issues.push(`${where}: invalid tier "${tier}"`);
            }
        }
        expect(issues, issues.join('\n')).toEqual([]);
    });

    it(`primary-tier route count ≤ ${PRIMARY_TIER_CAP}`, () => {
        const primary = eachOperation().filter(({ op }) => op['x-tier'] === 'primary');
        expect(
            primary.length,
            `Primary-tier routes: ${primary.length} (cap ${PRIMARY_TIER_CAP})\n${primary.map(p => p.where).join('\n')}`,
        ).toBeLessThanOrEqual(PRIMARY_TIER_CAP);
    });

    it(`every input schema field has a description (≥ ${MIN_FIELD_DESCRIPTION_CHARS} chars)`, () => {
        const issues: string[] = [];

        function walkSchema(schema: unknown, fieldPath: string, where: string): void {
            if (!schema || typeof schema !== 'object') return;
            const s = schema as Record<string, unknown>;
            if (s.type === 'object' && typeof s.properties === 'object' && s.properties) {
                for (const [key, sub] of Object.entries(s.properties as Record<string, Record<string, unknown>>)) {
                    const subPath = fieldPath ? `${fieldPath}.${key}` : key;
                    const desc = typeof sub.description === 'string' ? sub.description : '';
                    if (!desc || desc.length < MIN_FIELD_DESCRIPTION_CHARS) {
                        issues.push(`${where}: ${subPath} missing/short description`);
                    }
                    walkSchema(sub, subPath, where);
                }
            }
            if (s.type === 'array' && s.items) {
                walkSchema(s.items, `${fieldPath}[]`, where);
            }
            // Handle anyOf/oneOf/allOf composites
            for (const compose of ['anyOf', 'oneOf', 'allOf'] as const) {
                if (Array.isArray(s[compose])) {
                    for (const variant of s[compose] as unknown[]) {
                        walkSchema(variant, fieldPath, where);
                    }
                }
            }
        }

        for (const { op, where } of eachOperation()) {
            for (const param of (op.parameters ?? [])) {
                const desc = param.description ?? '';
                if (!desc || desc.length < MIN_FIELD_DESCRIPTION_CHARS) {
                    issues.push(`${where}: param "${param.name}" missing/short description`);
                }
            }
            const bodySchema = op.requestBody?.content?.['application/json']?.schema;
            if (bodySchema) walkSchema(bodySchema, '', where);
        }
        expect(issues, issues.join('\n')).toEqual([]);
    });
});

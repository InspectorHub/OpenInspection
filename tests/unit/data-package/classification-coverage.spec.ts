import { describe, it, expect } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import * as schema from '../../../server/lib/db/schema';
import { CLASSIFICATION } from '../../../server/lib/data-package/classification';
import {
    archiveTable, exportTable, outTable, partialTable, withholdTable,
} from '../../../server/lib/data-package/classification-types';
import { REVIEWED_COLUMN_SNAPSHOT } from './classification-column-snapshot';
import { columnCount, compareColumnSnapshot, schemaTables, validateClassification, wholeTableColumnSnapshot } from './classification-validator';

const tables = schemaTables(schema);

describe('table classification covers the real schema', () => {
    it('classifies every table, and every column of every partial table', () => {
        const columns = columnCount(tables);
        // Both numbers side by side: a zero means the enumeration broke, not that the schema is empty.
        console.log(`classification coverage: tables=${tables.length} columns=${columns} classified=${CLASSIFICATION.length}`);
        expect(tables.length).toBeGreaterThan(0);
        expect(columns).toBeGreaterThan(0);
        expect(validateClassification(CLASSIFICATION, tables)).toEqual([]);
    });

    it('is not vacuous: dropping one real entry is reported', () => {
        const dropped = CLASSIFICATION.slice(1);
        const problems = validateClassification(dropped, tables);
        expect(problems.length).toBe(1);
        expect(problems[0]).toContain('unclassified table');
    });

    it('never includes a credential-shaped column in any table that travels', () => {
        const travelling = CLASSIFICATION.filter((e) => e.disposition !== 'out' && e.disposition !== 'withhold');
        expect(travelling.length).toBeGreaterThan(0);
        const bad = validateClassification(CLASSIFICATION, tables).filter((p) => p.includes('credential-shaped') || p.includes('secret-looking'));
        expect(bad).toEqual([]);
    });

    it('matches the reviewed column snapshot of every whole-table export/archive table', () => {
        const seen = Object.keys(wholeTableColumnSnapshot(CLASSIFICATION)).length;
        console.log(`column snapshot: whole-table tables=${seen} reviewed=${Object.keys(REVIEWED_COLUMN_SNAPSHOT).length}`);
        expect(seen).toBeGreaterThan(0);
        expect(compareColumnSnapshot(CLASSIFICATION, REVIEWED_COLUMN_SNAPSHOT)).toEqual([]);
    });

    it('keeps operator-held records and personal values out of whole-table exports', () => {
        const byName = new Map(CLASSIFICATION.map((e) => [getTableName(e.table), e]));
        expect(byName.get('legal_holds')?.disposition).toBe('out');
        expect(byName.get('tenant_destruction_records')?.disposition).toBe('out');
        const rule = (t: string, p: string): string => {
            const r = byName.get(t)?.columns[p];
            return r === undefined || r === 'include' ? 'none' : Object.keys(r)[0]!;
        };
        expect(rule('repair_requests', 'createdByRef')).toBe('reset');
        expect(rule('erasure_log', 'subjectEmail')).toBe('reset');
        expect(rule('audit_logs', 'ipAddress')).toBe('withhold');
        expect(rule('audit_logs', 'platformActorId')).toBe('withhold');
        expect(rule('account_acceptances', 'actorIdentityRef')).toBe('withhold');
        expect(rule('tenant_configs', 'enablePdfPipeline')).toBe('reset');
        expect(rule('tenant_configs', 'invoiceSeq')).toBe('reset');
    });

    it('pins the decisions that carry credentials', () => {
        const byName = new Map(CLASSIFICATION.map((e) => [getTableName(e.table), e]));
        const expected: Record<string, string> = {
            users: 'partial', tenant_configs: 'partial', signing_keys: 'partial',
            calendar_connections: 'withhold', qbo_connections: 'withhold',
            inspection_access_tokens: 'withhold', concierge_confirm_tokens: 'withhold',
        };
        for (const [name, disposition] of Object.entries(expected)) expect(byName.get(name)?.disposition, name).toBe(disposition);
        const withheldOf = (name: string): string[] => Object.entries(byName.get(name)?.columns ?? {})
            .filter(([, r]) => typeof r === 'object' && 'withhold' in r).map(([p]) => p);
        expect(withheldOf('agreement_signers')).toEqual(expect.arrayContaining(['tokenHash', 'tokenEnc']));
        expect(withheldOf('agreement_requests')).toContain('tokenHash');
        expect(withheldOf('users')).toEqual(expect.arrayContaining(['passwordHash', 'totpSecret', 'totpRecoveryCodes']));
        expect(withheldOf('tenant_configs')).toEqual(expect.arrayContaining(['secretsEnc', 'dekEnc', 'icsToken']));
    });
});

describe('decisions the importer depends on', () => {
    const byName = new Map(CLASSIFICATION.map((e) => [getTableName(e.table), e]));
    const kind = (t: string, p: string): string => {
        const r = byName.get(t)?.columns[p];
        return r === undefined ? 'none' : r === 'include' ? 'include' : Object.keys(r)[0]!;
    };
    const text = (t: string, p: string): string => {
        const r = byName.get(t)?.columns[p];
        return r === undefined || r === 'include' ? '' : Object.values(r)[0]!;
    };

    it('resets NOT NULL / uniquely indexed columns instead of dropping them', () => {
        expect(kind('report_views', 'accessTokenId')).toBe('reset');
        expect(text('report_views', 'accessTokenId')).toContain('imported:<row id>');
        expect(kind('repair_requests', 'shareToken')).toBe('reset');
        expect(kind('psq_responses', 'shareToken')).toBe('reset');
        expect(text('repair_requests', 'shareToken')).toContain('new unique token');
        expect(text('psq_responses', 'shareToken')).toContain('new unique token');
    });

    it('never lets a source signing key become the target signer', () => {
        expect(kind('signing_keys', 'retiredAt')).toBe('reset');
        expect(text('signing_keys', 'retiredAt')).toContain('import time');
        const reason = byName.get('signing_keys')?.reason ?? '';
        expect(reason).toContain('placeholder');
        expect(reason).toContain('reject');
        expect(kind('signing_keys', 'privateKeyEnc')).toBe('withhold');
        expect(kind('signing_keys', 'privateKeyIv')).toBe('withhold');
    });

    it('encodes the exporter nulling rules as column decisions, not prose', () => {
        for (const p of ['agentUserId', 'agentLinkedAt', 'agentRevokedAt']) expect(kind('contacts', p), p).toBe('reset');
        expect(text('contacts', 'agentUserId')).toContain('global agent');
        for (const p of ['source', 'externalId']) expect(kind('availability_overrides', p), p).toBe('reset');
        for (const p of ['streamUid', 'provider']) expect(kind('inspection_media_pool', p), p).toBe('reset');
        expect(byName.get('video_uploads')?.rowFilter).toContain('completed');
    });

    it('keeps public verifiers included with a reason and the free-text decline reason withheld', () => {
        expect(kind('report_versions', 'verificationToken')).toBe('include');
        expect(kind('agreement_requests', 'verificationToken')).toBe('include');
        expect(kind('agreement_requests', 'lastError')).toBe('withhold');
    });

    it('states the contracts the reasons promise', () => {
        expect(byName.get('erasure_log')?.reason + text('erasure_log', 'subjectEmail')).toContain('pseudonymised, not anonymised');
        expect(text('users', 'passwordHash')).toContain('empty string');
        expect(text('repair_requests', 'createdByRef')).toContain('legacy-share:');
        expect(text('repair_requests', 'createdByRef')).toContain('neither an email');
        expect(text('repair_requests', 'createdByRef')).not.toContain('64-hex');
    });

    it('records the dangling soft references the importer must handle', () => {
        expect(byName.get('comments')?.reason).toContain('library_id');
        expect(byName.get('statutory_form_productions')?.reason).toContain('form_id');
        expect(byName.get('invoices')?.reason).toContain('qbo_sync_status');
        expect(byName.get('notification_preferences')?.reason).toContain('subject_id');
    });
});

describe('the validator can fail (synthetic schema)', () => {
    const ghost = sqliteTable('ghost_things', { id: text('id').primaryKey(), tenantId: text('tenant_id').notNull() });
    const part = sqliteTable('part_things', { id: text('id').primaryKey(), tenantId: text('tenant_id').notNull(), note: text('note') });
    const secretful = sqliteTable('secretful', { id: text('id').primaryKey(), tenantId: text('tenant_id').notNull(), apiToken: text('api_token'), blobEnc: text('blob_enc') });
    const loose = sqliteTable('loose', { id: text('id').primaryKey(), tenantId: text('tenant_id'), n: integer('n') });
    const nowhere = sqliteTable('nowhere', { id: text('id').primaryKey() });

    it('flags an unclassified table', () => {
        expect(validateClassification([], [ghost])).toEqual(['ghost_things: unclassified table']);
    });

    it('flags a classified table the schema no longer exports', () => {
        expect(validateClassification([exportTable(ghost, 'direct', 'x')], [])).toContain('ghost_things: classified but not exported by the schema index');
    });

    it('flags an unclassified column of a partial table and a stale one', () => {
        const missing = partialTable(part, 'direct', 'x', { id: 'include', tenantId: { reset: 'target id' } } as never);
        expect(validateClassification([missing], [part])).toContain('part_things.note: unclassified column in a partial table');
        const stale = partialTable(part, 'direct', 'x', { id: 'include', tenantId: 'include', note: { withhold: 'free text' }, gone: 'include' } as never);
        expect(validateClassification([stale], [part])).toContain('part_things.gone: classified column does not exist');
    });

    it('flags a partial table that withholds nothing', () => {
        const all = partialTable(part, 'direct', 'x', { id: 'include', tenantId: 'include', note: 'include' });
        expect(validateClassification([all], [part])).toContain('part_things: partial but every column is included; use export or archive');
    });

    it('flags a secret-looking column unless a public reason is given, and never a credential-shaped one', () => {
        expect(validateClassification([exportTable(secretful, 'direct', 'x')], [secretful]).join('\n')).toMatch(/api_token: secret-looking column included without a stated public reason/);
        const withheld = exportTable(secretful, 'direct', 'x', { withhold: { apiToken: 'secret', blobEnc: 'encrypted' } });
        expect(validateClassification([withheld], [secretful])).toEqual([]);
        const publicOk = exportTable(secretful, 'direct', 'x', { withhold: { blobEnc: 'encrypted' }, publicColumns: { apiToken: 'printed on the report' } });
        expect(validateClassification([publicOk], [secretful])).toEqual([]);
        const publicEnc = exportTable(secretful, 'direct', 'x', { publicColumns: { apiToken: 'printed', blobEnc: 'trust me' } });
        expect(validateClassification([publicEnc], [secretful]).join('\n')).toMatch(/blob_enc: credential-shaped column must never travel/);
    });

    it('flags scope that disagrees with the real tenant_id column', () => {
        expect(validateClassification([exportTable(nowhere, 'direct', 'x')], [nowhere])).toContain('nowhere: scope direct but the table has no tenant_id column');
        expect(validateClassification([outTable(ghost, 'global', 'x')], [ghost])).toContain('ghost_things: scope global but the table has a tenant_id column');
        expect(validateClassification([exportTable(loose, 'direct', 'x')], [loose])).toContain('loose: scope direct but tenant_id is nullable');
        expect(validateClassification([exportTable(ghost, 'direct_nullable', 'x')], [ghost])).toContain('ghost_things: scope direct_nullable but tenant_id is NOT NULL');
        expect(validateClassification([exportTable(ghost, 'tenant_row', 'x')], [ghost])).toContain('ghost_things: scope tenant_row is only for the tenants table');
    });

    it('refuses to export or archive a table that has no tenant scoping', () => {
        expect(validateClassification([archiveTable(nowhere, 'global', 'x')], [nowhere]).join('\n')).toMatch(/would export other tenants data/);
        expect(validateClassification([outTable(nowhere, 'global', 'x')], [nowhere])).toEqual([]);
        expect(validateClassification([withholdTable(nowhere, 'global', 'x')], [nowhere])).toEqual([]);
    });

    it('flags a high-risk column of a whole-table export that has no explicit exception', () => {
        const risky = sqliteTable('risky', { id: text('id').primaryKey(), tenantId: text('tenant_id').notNull(), ref: text('created_by_ref') });
        const hr = { risky: ['created_by_ref'] };
        expect(validateClassification([exportTable(risky, 'direct', 'x')], [risky], hr)).toContain('risky.created_by_ref: high-risk column in a whole-table export needs an explicit exception');
        expect(validateClassification([exportTable(risky, 'direct', 'x', { reset: { ref: 'normalised' } })], [risky], hr)).toEqual([]);
        expect(validateClassification([exportTable(risky, 'direct', 'x')], [risky], { risky: ['nope'] })).toContain('risky.nope: high-risk column does not exist');
    });

    it('flags a column named in two exception lists', () => {
        const dup = exportTable(secretful, 'direct', 'x', { withhold: { apiToken: 'secret', blobEnc: 'enc' }, publicColumns: { apiToken: 'public' } });
        expect(validateClassification([dup], [secretful])).toContain('secretful.apiToken: named in more than one of withhold / reset / publicColumns');
    });

    it('fails the snapshot ratchet when a whole-table export gains or loses a column, naming it', () => {
        const before = sqliteTable('grows', { id: text('id').primaryKey(), tenantId: text('tenant_id').notNull() });
        const after = sqliteTable('grows', { id: text('id').primaryKey(), tenantId: text('tenant_id').notNull(), extra: text('extra') });
        const reviewed = wholeTableColumnSnapshot([exportTable(before, 'direct', 'x')]);
        expect(compareColumnSnapshot([exportTable(before, 'direct', 'x')], reviewed)).toEqual([]);
        expect(compareColumnSnapshot([exportTable(after, 'direct', 'x')], reviewed)).toEqual(['grows: column set changed (added: extra; removed: none); review, then update the snapshot']);
        expect(compareColumnSnapshot([exportTable(after, 'direct', 'x')], {})).toEqual(['grows: whole-table table has no reviewed column snapshot']);
        expect(compareColumnSnapshot([], reviewed)).toEqual(['grows: snapshot entry for a table that is not a whole-table export/archive']);
        const swapped = sqliteTable('grows', { id: text('id').primaryKey(), other: text('other_col').notNull() });
        expect(compareColumnSnapshot([exportTable(swapped, 'direct', 'x')], reviewed)).toEqual(['grows: column set changed (added: other_col; removed: tenant_id); review, then update the snapshot']);
    });

    it('flags an empty row filter', () => {
        const t = sqliteTable('filtered', { id: text('id').primaryKey(), tenantId: text('tenant_id').notNull() });
        expect(validateClassification([exportTable(t, 'direct', 'x', { rowFilter: ' ' })], [t])).toContain('filtered: empty rowFilter');
        expect(validateClassification([exportTable(t, 'direct', 'x', { rowFilter: 'completed rows only' })], [t])).toEqual([]);
    });

    it('treats an empty enumeration as a failure, not a pass', () => {
        expect(validateClassification([], []).join('\n')).toMatch(/0 schema tables seen/);
    });
});

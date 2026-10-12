#!/usr/bin/env node
/**
 * One-off: give every tenant that has no Reply-To the email of its owner.
 *
 * New workspaces get this default at creation time; this covers the ones that
 * predate it. Without a configured Reply-To, a customer replying to an outbound
 * message reaches the platform sender address rather than the inspector.
 *
 * Rules (decided in scripts/lib/reply-to-backfill.mjs, unit-tested there):
 *   - only a NULL / empty / whitespace-only `tenant_configs.reply_to` is filled;
 *     a value anyone set is never overwritten, and the write statement re-checks
 *     that condition itself so a concurrent edit between read and write wins;
 *   - the owner is the earliest-created user whose `users.role` is 'owner'
 *     (the role enum is owner | manager | inspector | agent);
 *   - a tenant without an owner, or whose owner email is blank, is skipped.
 *
 * DRY RUN BY DEFAULT: it prints every change it would make and writes nothing.
 * `--apply` performs the writes. Target is local D1 unless `--remote` is given.
 *
 *   node scripts/backfill-reply-to.mjs                    # dry run, local D1
 *   node scripts/backfill-reply-to.mjs --remote           # dry run, remote D1
 *   node scripts/backfill-reply-to.mjs --apply --remote   # write, remote D1
 *
 * Manual steps around a remote run, in order:
 *   1. Take a D1 Time Travel bookmark first and record it
 *      (`wrangler d1 time-travel info <database>`), so the run can be undone.
 *   2. Run the dry run and review the list: right tenants, right addresses.
 *   3. Run with `--apply`. Every statement re-checks that the field is still
 *      blank, so a run that stops half way can simply be repeated.
 *   4. Verify: run the dry run again. It must report `filled 0`, and the
 *      `skipped` count must equal the previous `filled` plus the previous
 *      `skipped`.
 *
 * The script reaches D1 through `scripts/wrangler.mjs` like the other scripts
 * here, and passes every statement as a temp file (`--file`), for reads and
 * for writes.
 */
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { planReplyToBackfill } from './lib/reply-to-backfill.mjs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const target = args.includes('--remote') ? '--remote' : '--local';
const wrangler = join(import.meta.dirname, 'wrangler.mjs');

/**
 * One SELECT through wrangler; returns the result rows.
 *
 * The statement goes through a temp file (`--file`): `scripts/wrangler.mjs`
 * forwards its arguments through a shell without quoting them, so a SQL string
 * passed with `--command` is split at the first space.
 */
function query(sql) {
    const file = join(tmpdir(), `backfill-reply-to-read-${process.pid}.sql`);
    writeFileSync(file, `${sql};
`, 'utf8');
    try {
        const r = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'DB', target, '--json', '--file', file], {
            encoding: 'utf8',
            env: { ...process.env, NO_COLOR: '1' },
        });
        if (r.status !== 0) throw new Error(`query failed: ${(r.stderr || r.stdout || '').slice(-400)}`);
        // Wrangler prints warnings before the JSON; the JSON array starts on a
        // line that holds nothing but "[".
        const out = r.stdout;
        const start = out.search(/^\[\s*$/m);
        if (start === -1) throw new Error(`no JSON in wrangler output: ${out.slice(0, 200)}`);
        return JSON.parse(out.slice(start))[0]?.results ?? [];
    } finally {
        unlinkSync(file);
    }
}

const quote = (s) => `'${String(s).replaceAll("'", "''")}'`;

/**
 * Upsert guarded on the field still being blank, so the statement is safe even
 * if the row changed after the read. A tenant with no config row gets one;
 * `updated_at` is the only other NOT NULL column.
 */
const writeSql = ({ tenantId, email }) =>
    `INSERT INTO tenant_configs (tenant_id, reply_to, updated_at) VALUES (${quote(tenantId)}, ${quote(email)}, ${Date.now()})\n`
    + `ON CONFLICT(tenant_id) DO UPDATE SET reply_to = excluded.reply_to, updated_at = excluded.updated_at\n`
    + `WHERE tenant_configs.reply_to IS NULL OR trim(tenant_configs.reply_to) = '';`;

console.info(`[backfill-reply-to] ${apply ? 'APPLY' : 'DRY RUN'} against ${target} D1`);

const tenants = query(
    'SELECT t.id AS tenantId, c.reply_to AS replyTo FROM tenants t LEFT JOIN tenant_configs c ON c.tenant_id = t.id',
);
const owners = query(
    "SELECT tenant_id AS tenantId, email, created_at AS createdAt FROM users WHERE role = 'owner' AND deleted_at IS NULL AND tenant_id IS NOT NULL",
);
const { fills, skipped } = planReplyToBackfill(tenants, owners);

for (const f of fills) console.info(`  fill  ${f.tenantId}  ->  ${f.email}`);
for (const s of skipped) console.info(`  skip  ${s.tenantId}  (${s.reason})`);

if (apply && fills.length > 0) {
    const file = join(tmpdir(), `backfill-reply-to-${process.pid}.sql`);
    writeFileSync(file, fills.map(writeSql).join('\n') + '\n', 'utf8');
    try {
        const r = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'DB', target, '--file', file, '--yes'], {
            stdio: 'inherit',
        });
        if (r.status !== 0) {
            console.error('[backfill-reply-to] write FAILED — nothing is confirmed; re-run the dry run to see the state');
            process.exitCode = r.status ?? 1;
        }
    } finally {
        unlinkSync(file);
    }
}

console.info(`filled ${fills.length} / skipped ${skipped.length}${apply ? '' : '  (dry run — nothing written; re-run with --apply)'}`);

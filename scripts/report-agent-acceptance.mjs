#!/usr/bin/env node
/**
 * Who holds an agent account, and how many of them are bound by the document
 * in force.
 *
 * This is a REPORT, not a gate. It blocks nothing and always exits 0 (except on
 * a query error, where a silent success would be the worst outcome). It exists
 * because the number that matters before arming the terms gate is not in any
 * test: it is how many live accounts would be stopped at the door the moment
 * the gate turns on.
 *
 * ── Two rules this script exists to obey ────────────────────────────────────
 *  1. A remote read uses `--command`, never `--file`. Wrangler's file mode
 *     answers with an EXECUTION SUMMARY ("Total queries executed", "Rows read")
 *     and not with the rows, so a script that parsed it would report zero and
 *     look like a healthy empty table.
 *  2. It never runs a migration. `db:migrate:*:remote` applies EVERY pending
 *     migration, including ones from branches that are not yours — a reporting
 *     script is the last place that should happen.
 *
 * Config resolution matches `scripts/wrangler.mjs`: WRANGLER_CONFIG wins, then
 * `wrangler.local.jsonc`, then the committed `wrangler.jsonc`. For the hosted
 * database that means:
 *
 *   WRANGLER_CONFIG=wrangler.saas.jsonc npm run report:agent-acceptance
 *
 * Without it you are reading whichever database the default config names, which
 * is the one mistake this report must not make quietly — so the config in use
 * is printed at the top of the output.
 */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER_BIN = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const config =
    process.env.WRANGLER_CONFIG ||
    (existsSync('wrangler.local.jsonc') ? 'wrangler.local.jsonc' : 'wrangler.jsonc');

const remote = !process.argv.includes('--local');

/** One SELECT. Returns the rows, or throws with wrangler's own message. */
function query(sql) {
    // Run wrangler's JS entry under this same node, with NO shell.
    //
    // The SQL is one argument full of spaces, commas and parentheses, and a
    // shell would re-parse it — quoting that correctly for cmd.exe and for sh
    // is a problem worth not having. That rules out `shell: true`. It also
    // rules out `npx`, because the only thing `npx` resolves to on Windows is
    // `npx.cmd`, and since Node 22 spawning a `.cmd` without a shell is refused
    // outright (EINVAL). Calling the entry script directly sidesteps both.
    const args = [
        WRANGLER_BIN,
        'd1', 'execute', 'DB',
        remote ? '--remote' : '--local',
        '--command', sql,
        '--json',
        '-c', config,
    ];
    let out;
    try {
        out = execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
        const detail = (String(err.stdout || '') + String(err.stderr || ''))
            .split('\n').map((l) => l.trim())
            .filter((l) => l && !l.startsWith('🪵') && !/WARNING|experimental/.test(l));
        throw new Error(`query failed — ${detail.slice(-3).join(' | ') || err.message}`);
    }
    // Wrangler prints warnings before the JSON; take the last JSON array.
    const start = out.indexOf('[');
    if (start === -1) throw new Error(`no JSON in wrangler output: ${out.slice(0, 200)}`);
    const parsed = JSON.parse(out.slice(start));
    return parsed[0]?.results ?? [];
}

const one = (rows, key) => (rows.length ? rows[0][key] : null);

function main() {
    console.log(`\nagent acceptance report`);
    console.log(`  config              : ${config}`);
    console.log(`  target              : ${remote ? 'REMOTE' : 'local'}`);

    // Every version on the registry. Production risk 5 in the plan: a row
    // inserted by hand bypasses the publisher's refusals, and this is where
    // that would show up as a version nobody remembers approving.
    const versions = query(
        "SELECT version, substr(content_hash, 1, 12) AS hash, "
        + "datetime(published_at / 1000, 'unixepoch') AS published "
        + "FROM deployment_legal_versions WHERE doc = 'agent_terms' "
        + "ORDER BY published_at DESC",
    );
    console.log(`  agent_terms versions: ${versions.length}`);
    for (const v of versions) console.log(`      · ${v.version}  ${v.hash}…  published ${v.published}`);
    if (versions.length === 0) {
        console.log('      · none published — agent signup is closed, and no acceptance can exist');
    }

    // An agent account is global: no tenant, role 'agent'.
    const accounts = one(
        query("SELECT COUNT(*) AS n FROM users WHERE tenant_id IS NULL AND role = 'agent' AND deleted_at IS NULL"),
        'n',
    );

    // Bound by the version IN FORCE, matched on the content hash rather than
    // the version string: the hash is what proves which words were on screen.
    const inForce = versions[0];
    let bound = 0;
    if (inForce) {
        const full = one(
            query("SELECT content_hash AS h FROM deployment_legal_versions WHERE doc = 'agent_terms' "
                + "ORDER BY published_at DESC LIMIT 1"),
            'h',
        );
        bound = one(
            query("SELECT COUNT(DISTINCT user_id) AS n FROM agent_terms_acceptances "
                + `WHERE doc = 'agent_terms' AND content_hash = '${full}'`),
            'n',
        );
    }

    console.log(`\n  agent accounts      : ${accounts}`);
    console.log(`  bound by version in force : ${bound} of ${accounts}`);

    const wouldBeStopped = Number(accounts) - Number(bound);
    if (inForce && wouldBeStopped > 0) {
        console.log(`\n  ⚠ ${wouldBeStopped} live account(s) would be stopped at the door when the gate arms.`);
        console.log(`    That is the intended retake, but it is only safe if /agent/accept-terms works:`);
        console.log(`    walk one real account through "stopped -> accept -> through" before arming.`);
    }
    if (!inForce && Number(accounts) > 0) {
        console.log(`\n  ⚠ ${accounts} account(s) exist with no document in force. The gate answers`);
        console.log(`    NOT_IN_FORCE and lets them through — a deployment with nothing to be bound by,`);
        console.log(`    which is not the same event as an agent who accepted something.`);
    }
    console.log('');
    return 0;
}

try {
    process.exit(main());
} catch (err) {
    console.error(`\n✘ ${err.message}\n`);
    process.exit(1);
}

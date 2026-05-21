#!/usr/bin/env node
/**
 * Rotate the portal↔core M2M shared secret.
 *
 * Generates a new high-entropy random secret (48 bytes / 96 hex chars),
 * deploys to all worker targets in both apps/core and apps/portal, bumps
 * PORTAL_M2M_CURRENT_KID. The old secret version remains during the brief
 * overlap window (typically 1-2 minutes between portal deploy and core
 * deploy completing).
 *
 * Usage:
 *   node scripts/rotate-m2m-secret.js                 mint v<next> + bump
 *   node scripts/rotate-m2m-secret.js --dry-run       no push
 *   node scripts/rotate-m2m-secret.js --prune-old-kid=v1
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CORE_ROOT = join(__dirname, '..');
const PORTAL_ROOT = join(CORE_ROOT, '..', 'portal');

const TARGETS = [
    ['openinspection-standalone',  CORE_ROOT,   '',                          ''],
    ['openinspection-saas',        CORE_ROOT,   '',                          '--env saas'],
    ['inspectorhub-core-shared',   CORE_ROOT,   '-c wrangler.saas.toml',     ''],
    ['inspectorhub-portal',        PORTAL_ROOT, '',                          ''],
];

function color(text, code) {
    return `\x1b[${code}m${text}\x1b[0m`;
}

function discoverCurrentKid() {
    const devVarsPath = join(CORE_ROOT, '.dev.vars');
    if (!existsSync(devVarsPath)) return null;
    const content = readFileSync(devVarsPath, 'utf8');
    const m = content.match(/^PORTAL_M2M_CURRENT_KID=(.+)$/m);
    return m ? m[1].trim() : null;
}

function nextKid(currentKid) {
    if (!currentKid) return 'v1';
    const n = parseInt(currentKid.replace(/^v/, ''), 10);
    if (isNaN(n)) throw new Error(`Cannot parse kid: ${currentKid}`);
    return `v${n + 1}`;
}

function pushSecret(target, name, value, dryRun) {
    const [label, cwd, configFlag, envFlag] = target;
    const flagArgs = [configFlag, envFlag].filter(Boolean).join(' ');
    const cmd = `npx wrangler secret put ${name} ${flagArgs}`.trim();
    console.log(`${color('→', '36')} [${label}] ${cmd}`);
    if (dryRun) return;
    execSync(cmd, { cwd, input: value, stdio: ['pipe', 'inherit', 'inherit'] });
}

function deleteSecret(target, name, dryRun) {
    const [label, cwd, configFlag, envFlag] = target;
    const flagArgs = [configFlag, envFlag].filter(Boolean).join(' ');
    const cmd = `npx wrangler secret delete ${name} ${flagArgs}`.trim();
    console.log(`${color('×', '31')} [${label}] ${cmd}`);
    if (dryRun) return;
    try {
        execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, CI: '1' } });
    } catch (e) {
        console.warn(`  ${color('warn', '33')}: ${e.message}`);
    }
}

function updateLocalDevVars(repoRoot, kid, secret) {
    const path = join(repoRoot, '.dev.vars');
    const lines = existsSync(path)
        ? readFileSync(path, 'utf8').split('\n')
        : [];
    const kidUpper = kid.toUpperCase();
    const filterRe = new RegExp(`^(PORTAL_M2M_SECRET_${kidUpper}=|PORTAL_M2M_CURRENT_KID=)`);
    const kept = lines.filter(l => !filterRe.test(l));
    kept.push(`PORTAL_M2M_SECRET_${kidUpper}=${secret}`);
    kept.push(`PORTAL_M2M_CURRENT_KID=${kid}`);
    writeFileSync(path, kept.filter(l => l.trim()).join('\n') + '\n');
    console.log(`${color('✓', '32')} wrote ${path}`);
}

function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const pruneArg = args.find(a => a.startsWith('--prune-old-kid='));

    if (pruneArg) {
        const kid = pruneArg.slice('--prune-old-kid='.length);
        const kidUpper = kid.toUpperCase();
        console.log(`Pruning ${kid} from all targets...`);
        for (const target of TARGETS) {
            deleteSecret(target, `PORTAL_M2M_SECRET_${kidUpper}`, dryRun);
        }
        console.log(`\n${color('✓', '32')} Pruned ${kid}. Remember to also remove it from local .dev.vars.`);
        return;
    }

    const currentKid = discoverCurrentKid();
    const newKid = nextKid(currentKid);
    console.log(`Current M2M kid: ${color(currentKid || '(none)', '33')} → New: ${color(newKid, '32')}`);
    if (dryRun) console.log(color('\n=== DRY RUN ===', '36'));

    const secret = randomBytes(48).toString('hex');  // 96 hex chars, 384 bits

    if (dryRun) {
        console.log(`\nPORTAL_M2M_SECRET_${newKid.toUpperCase()}=${secret.slice(0, 16)}...(${secret.length} chars)`);
        console.log(`PORTAL_M2M_CURRENT_KID=${newKid}\n`);
    }

    const kidUpper = newKid.toUpperCase();
    for (const target of TARGETS) {
        pushSecret(target, `PORTAL_M2M_SECRET_${kidUpper}`, secret, dryRun);
        pushSecret(target, 'PORTAL_M2M_CURRENT_KID', newKid, dryRun);
    }

    if (!dryRun) {
        updateLocalDevVars(CORE_ROOT, newKid, secret);
        if (existsSync(PORTAL_ROOT)) {
            updateLocalDevVars(PORTAL_ROOT, newKid, secret);
        }
    }

    console.log(`\n${color('✓', '32')} Rotation complete. New M2M kid: ${color(newKid, '32')}`);
    console.log(`\nDeploy order matters for M2M (zero-downtime):`);
    console.log(`  1. Redeploy portal first (it switches outbound to new secret):`);
    console.log(`     cd ${PORTAL_ROOT} && npm run deploy`);
    console.log(`  2. Redeploy core (now accepting only the new secret for new calls;`);
    console.log(`     old secret still valid until pruned):`);
    console.log(`     cd ${CORE_ROOT} && npm run deploy && npm run deploy:saas`);
    console.log(`  3. After in-flight calls drain (a few minutes), prune the old kid:`);
    if (currentKid) {
        console.log(`       node scripts/rotate-m2m-secret.js --prune-old-kid=${currentKid}`);
    } else {
        console.log(`       (no previous kid — first rotation)`);
    }
}

try {
    main();
} catch (err) {
    console.error(color('✘', '31'), err.message);
    process.exit(1);
}

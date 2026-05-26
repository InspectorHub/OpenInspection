#!/usr/bin/env node
/**
 * Rotate JWT signing keys for the OpenInspection ES256 keyring.
 *
 * Generates a new ES256 keypair, deploys to all worker targets in both
 * apps/core and apps/portal, bumps JWT_CURRENT_KID. The old key version
 * remains in the keyring for the overlap window (controlled by max JWT
 * TTL); use --prune-old-kid=v<N> to remove a specific previous version
 * after its tokens have all expired.
 *
 * Usage:
 *   node scripts/rotate-jwt-keys.js                 mint v<next> + bump current
 *   node scripts/rotate-jwt-keys.js --dry-run       generate locally, print
 *                                                   commands, don't push
 *   node scripts/rotate-jwt-keys.js --prune-old-kid=v1
 *                                                   remove a specific old kid
 *                                                   from all workers
 *
 * Requires: wrangler authenticated for the target account. Run from
 * D:/Code/inspectorhub/apps/core.
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateKeyPairSync, randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CORE_ROOT = join(__dirname, '..');
const PORTAL_ROOT = join(CORE_ROOT, '..', 'portal');

// [label, cwd, wrangler-config-flag, env-flag]
const TARGETS = [
    ['openinspection-standalone',  CORE_ROOT,   '',                          ''],
    ['openinspection-saas',        CORE_ROOT,   '',                          '--env saas'],
    ['inspectorhub-core-shared',   CORE_ROOT,   '-c wrangler.saas.toml',     ''],
    ['inspectorhub-portal',        PORTAL_ROOT, '',                          ''],
];

function color(text, code) {
    return `\x1b[${code}m${text}\x1b[0m`;
}

function generateKeypair() {
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
        namedCurve: 'P-256',
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { publicPem: publicKey, privatePem: privateKey };
}

/** Strip BEGIN/END markers + newlines so PEM fits on one line in .dev.vars. */
function pemBodyOneLine(pem) {
    return pem.replace(/-----BEGIN [A-Z ]+-----/, '')
              .replace(/-----END [A-Z ]+-----/, '')
              .replace(/\s+/g, '');
}

function discoverCurrentKid() {
    const devVarsPath = join(CORE_ROOT, '.dev.vars');
    if (!existsSync(devVarsPath)) return null;
    const content = readFileSync(devVarsPath, 'utf8');
    const m = content.match(/^JWT_CURRENT_KID=(.+)$/m);
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
    execSync(cmd, {
        cwd,
        input: value,
        stdio: ['pipe', 'inherit', 'inherit'],
    });
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

function updateLocalDevVars(repoRoot, kid, privateBody, publicBody) {
    const path = join(repoRoot, '.dev.vars');
    const lines = existsSync(path)
        ? readFileSync(path, 'utf8').split('\n')
        : [];
    const kidUpper = kid.toUpperCase();
    const filterRe = new RegExp(`^(JWT_PRIVATE_KEY_${kidUpper}=|JWT_PUBLIC_KEY_${kidUpper}=|JWT_CURRENT_KID=)`);
    const kept = lines.filter(l => !filterRe.test(l));
    kept.push(`JWT_PRIVATE_KEY_${kidUpper}=${privateBody}`);
    kept.push(`JWT_PUBLIC_KEY_${kidUpper}=${publicBody}`);
    kept.push(`JWT_CURRENT_KID=${kid}`);
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
            deleteSecret(target, `JWT_PRIVATE_KEY_${kidUpper}`, dryRun);
            deleteSecret(target, `JWT_PUBLIC_KEY_${kidUpper}`, dryRun);
        }
        console.log(`\n${color('✓', '32')} Pruned ${kid}. Remember to also remove it from local .dev.vars.`);
        return;
    }

    const currentKid = discoverCurrentKid();
    const newKid = nextKid(currentKid);
    console.log(`Current kid: ${color(currentKid || '(none)', '33')} → New kid: ${color(newKid, '32')}`);
    if (dryRun) console.log(color('\n=== DRY RUN — secrets will be generated but not pushed ===', '36'));

    const { privatePem, publicPem } = generateKeypair();
    const privBody = pemBodyOneLine(privatePem);
    const pubBody = pemBodyOneLine(publicPem);

    if (dryRun) {
        console.log(`\nJWT_PRIVATE_KEY_${newKid.toUpperCase()}=${privBody.slice(0, 40)}...(${privBody.length} chars)`);
        console.log(`JWT_PUBLIC_KEY_${newKid.toUpperCase()}=${pubBody.slice(0, 40)}...(${pubBody.length} chars)`);
        console.log(`JWT_CURRENT_KID=${newKid}\n`);
    }

    const kidUpper = newKid.toUpperCase();
    for (const target of TARGETS) {
        pushSecret(target, `JWT_PRIVATE_KEY_${kidUpper}`, privBody, dryRun);
        pushSecret(target, `JWT_PUBLIC_KEY_${kidUpper}`, pubBody, dryRun);
        pushSecret(target, 'JWT_CURRENT_KID', newKid, dryRun);
    }

    if (!dryRun) {
        updateLocalDevVars(CORE_ROOT, newKid, privBody, pubBody);
        if (existsSync(PORTAL_ROOT)) {
            updateLocalDevVars(PORTAL_ROOT, newKid, privBody, pubBody);
        }
    }

    console.log(`\n${color('✓', '32')} Rotation complete. New current kid: ${color(newKid, '32')}`);
    console.log(`\nNext steps:`);
    console.log(`  1. Redeploy core (standalone + saas):`);
    console.log(`     cd ${CORE_ROOT} && npm run deploy && npm run deploy:saas`);
    console.log(`  2. Redeploy portal:`);
    console.log(`     cd ${PORTAL_ROOT} && npm run deploy`);
    console.log(`  3. After max-JWT-TTL has elapsed since rotation (default 24h),`);
    console.log(`     prune the previous kid:`);
    if (currentKid) {
        console.log(`       node scripts/rotate-jwt-keys.js --prune-old-kid=${currentKid}`);
    } else {
        console.log(`       (no previous kid to prune — first rotation)`);
    }
}

try {
    main();
} catch (err) {
    console.error(color('✘', '31'), err.message);
    process.exit(1);
}

#!/usr/bin/env node
/**
 * Capability-reader gate: a capability nobody reads is a distinction we
 * published and never made.
 *
 * `tests/unit/platform/deployment-modes-doc.spec.ts` already checks that
 * `docs/reference/deployment-modes.md` matches the two profile constants. That
 * is the DOC↔CONSTANT axis, and it works — it went red the moment a stale row
 * was left behind. The axis it cannot see is CONSTANT↔CODE, and that blind spot
 * is not theoretical: `brandingSource` sat in the interface, in both constants,
 * in the generated table and in two assertions for months with **zero**
 * production readers, while `branding.ts` resolved branding identically in both
 * modes. The published table told a self-hoster their company name came from
 * `APP_NAME` — the opposite of what the code does.
 *
 * At the level the doc gate operates, a capability nobody reads is
 * indistinguishable from one everybody reads. This closes that.
 *
 * Shape:
 *   Input      keys of STANDALONE_PROFILE at RUNTIME, not the TS interface — a
 *              type has no keys at runtime, and not seeing a newly added field
 *              is exactly the failure being prevented.
 *   Readers    `.<capability>` under server/ app/ workers/ packages/, excluding
 *              the seam itself, scripts/, and any spec/test file. A capability
 *              read only by the generator and its own assertions is unread.
 *   Verdict    zero readers = failure. Zero capabilities parsed = failure too,
 *              because an empty scan prints the same clean line as a healthy one.
 *   Exemptions named, with a reason, in this file. Never silent.
 *
 * console.* is intentional — this is a build script, not server code.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEAM = 'server/lib/deployment-profile.ts';
const SCAN_DIRS = ['server', 'app', 'workers', 'packages'];

/**
 * Capabilities that legitimately have no reader, each with the reason.
 *
 * An entry here is a claim someone has to defend at review. The alternative —
 * letting the gate go quiet on its own — is how the thing it checks for got in.
 */
const EXEMPT = {
    mode: 'The profile describing itself, not a behaviour switch. Shipped to the '
        + 'client as `deployment.mode` and read there; the server reads named '
        + 'capabilities instead, which is the rule this gate enforces.',
};

/** A file whose read of a capability counts as the product actually using it. */
export function isProductionReader(relPath) {
    const p = relPath.replaceAll('\\', '/');
    if (p === SEAM) return false;                       // the seam declares them
    if (p.startsWith('scripts/')) return false;         // generators and gates
    if (/\.(spec|test)\.tsx?$/.test(p)) return false;   // assertions are not use
    if (p.startsWith('tests/')) return false;
    return true;
}

/** Which of `caps` have no entry in `readers` — the failure set. */
export function unreadCapabilities(caps, readers) {
    return caps.filter((c) => !EXEMPT[c] && (readers[c] ?? []).length === 0);
}

/** An empty capability list means the parse failed, not that everything is fine. */
export function capabilitiesAreImplausible(caps) {
    return caps.length < 5;
}

function walk(dir, acc = []) {
    let entries;
    try { entries = readdirSync(join(ROOT, dir)); } catch { return acc; }
    for (const entry of entries) {
        if (entry === 'node_modules' || entry === 'paraglide') continue;
        const rel = `${dir}/${entry}`;
        if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, acc);
        else if (/\.(ts|tsx)$/.test(rel)) acc.push(rel);
    }
    return acc;
}

async function capabilityNames() {
    // Read the CONSTANT's runtime keys, not the interface. Parsed out of source
    // so the gate needs no build step and cannot be fooled by a stale .d.ts.
    //
    // NOT anchored to the start of a line. The first version of this was, and it
    // silently missed `hasSeatQuota`, `hasUsageQuota` and `billingPortalUrl` —
    // three capabilities that share lines with their neighbours. A gate that
    // cannot see part of what it claims to check is the exact failure this gate
    // exists to catch, and it had it. The count is cross-checked against
    // `DESCRIPTIONS` below so a future parse gap cannot go quiet either.
    const src = readFileSync(join(ROOT, SEAM), 'utf8');
    const block = src.slice(src.indexOf('export const STANDALONE_PROFILE'));
    const body = block.slice(block.indexOf('{'), block.indexOf('\n};'));
    const names = [...body.matchAll(/(?:^|[{,]\s*)\s*([a-zA-Z][a-zA-Z0-9]*):/gm)].map((m) => m[1]);
    return [...new Set(names)];
}

/**
 * The generated doc is built from `DESCRIPTIONS`, and the drift spec already
 * pins doc↔DESCRIPTIONS. If this gate parses FEWER capabilities than that list,
 * the difference is capabilities this gate is not checking — silently.
 */
function describedCapabilityCount() {
    const gen = readFileSync(join(ROOT, 'scripts/gen-deployment-modes-doc.ts'), 'utf8');
    const block = gen.slice(gen.indexOf('const DESCRIPTIONS'));
    const body = block.slice(block.indexOf('{'), block.indexOf('\n};'));
    return new Set([...body.matchAll(/^\s{4}([a-zA-Z][a-zA-Z0-9]*):/gm)].map((m) => m[1])).size;
}

function selfTest() {
    const checks = [];
    checks.push(['an unread capability is reported',
        unreadCapabilities(['hasBilling', 'brandingSource'],
            { hasBilling: ['server/api/x.ts'], brandingSource: [] }).length === 1]);
    checks.push(['generator+spec-only reads do not count as readers',
        isProductionReader('scripts/gen-deployment-modes-doc.ts') === false
        && isProductionReader('tests/unit/platform/deployment-profile.spec.ts') === false
        && isProductionReader('server/api/marketplace.ts') === true]);
    checks.push(['zero capabilities parsed is a failure', capabilitiesAreImplausible([])]);
    // Reverse control. Without it, an implementation that always reports a
    // problem satisfies all three above.
    checks.push(['a single real reader is enough',
        unreadCapabilities(['qboAppManaged'],
            { qboAppManaged: ['app/routes/settings-integrations-qbo.tsx'] }).length === 0]);
    // Second reverse control: an exempt capability with no readers must pass.
    checks.push(['a named exemption with no readers passes',
        unreadCapabilities(['mode'], { mode: [] }).length === 0]);

    const failed = checks.filter(([, ok]) => !ok);
    for (const [name] of failed) console.error(`  WRONG: ${name}`);
    console.log(`  self-test: ${checks.length} checks, ${failed.length} wrong`);
    return failed.length === 0;
}

async function main() {
    if (process.argv.includes('--self-test')) {
        process.exit(selfTest() ? 0 : 1);
    }

    const caps = await capabilityNames();
    if (capabilitiesAreImplausible(caps)) {
        console.error(`✘ capability readers — parsed ${caps.length} capabilities from ${SEAM}.`);
        console.error('  That is a broken parse, not a clean profile. Refusing to report OK.');
        process.exit(1);
    }

    // The cross-check that would have caught this gate's own first bug.
    const described = describedCapabilityCount();
    if (caps.length < described) {
        console.error(`✘ capability readers — parsed ${caps.length} capabilities from the profile `
            + `but ${described} are documented.`);
        console.error('  The difference is capabilities this gate is NOT checking. Fix the parse');
        console.error('  before trusting anything it prints.');
        process.exit(1);
    }

    const files = walk(SCAN_DIRS[0]);
    for (const d of SCAN_DIRS.slice(1)) walk(d, files);

    const readers = Object.fromEntries(caps.map((c) => [c, []]));
    for (const file of files) {
        if (!isProductionReader(file)) continue;
        const text = readFileSync(join(ROOT, file), 'utf8');
        for (const cap of caps) {
            if (new RegExp(`\\.${cap}\\b`).test(text)) readers[cap].push(file);
        }
    }

    const unread = unreadCapabilities(caps, readers);
    const exemptCount = caps.filter((c) => EXEMPT[c]).length;

    // Both numbers, always. "0 unread" out of a scan that found nothing is a
    // broken scan wearing a pass.
    const summary = `capability readers — ${caps.length} capabilities scanned / `
        + `${unread.length} with zero production readers `
        + `(${exemptCount} named exemption${exemptCount === 1 ? '' : 's'}: ${Object.keys(EXEMPT).join(', ')})`;

    if (unread.length > 0) {
        console.error(`✘ ${summary}`);
        for (const cap of unread) {
            console.error(`  ✘ ${cap} — declared on both profiles, documented, read by nothing under `
                + `${SCAN_DIRS.join('/ ')}/`);
        }
        console.error('\n  Either wire it where the decision is actually made, or delete it and');
        console.error('  regenerate the doc. A published capability nobody reads is a distinction');
        console.error('  we promised and never implemented.');
        process.exit(1);
    }

    console.log(`✅ ${summary}`);
    console.log(`   scanned ${files.filter(isProductionReader).length} production source files`);
}

main().catch((e) => { console.error(e); process.exit(1); });

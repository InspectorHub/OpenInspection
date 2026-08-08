#!/usr/bin/env node
/**
 * Zero-client-tracking gate (#271 Task 5).
 *
 * OpenInspection carries NO client-side tracking. That is a product posture,
 * not an accident, and it is the reason server-side delivery confirmation is
 * defensible at all: the report counter records three numbers on the server and
 * the browser reports nothing. See docs/compliance/report-view-lia.md.
 *
 * A posture that lives only in a document is a rule until someone does not read
 * the document. This is the executable half.
 *
 * WHAT IT LOOKS FOR, and why only these.
 *
 * An earlier draft of this rule set flagged four legitimate things — the theme
 * preference cookie, a `visibilitychange` revalidate, an IntersectionObserver
 * used for infinite scroll, and an offscreen `new Image()` used to decode a crop
 * source. None of those report anything to anyone. A gate that cries wolf on
 * ordinary UI code gets switched off, so the rules below are deliberately narrow
 * and target the mechanisms by which a browser SENDS something:
 *
 *   1. `navigator.sendBeacon` — exists for exactly one purpose.
 *   2. Analytics globals — gtag / dataLayer / _paq / posthog / mixpanel /
 *      amplitude / zaraz. Their presence in client code is the whole vendor.
 *   3. A tracking pixel: `new Image()` or an `<img>` whose `src` is built by
 *      interpolation AND whose result is never consumed (no `onload`, no
 *      `decode()`, not assigned into anything). An image nobody looks at is a
 *      request, not a picture.
 *
 * NOT flagged, on purpose: cookies (a theme preference is not tracking),
 * IntersectionObserver (layout), visibilitychange (revalidation), fetch to our
 * own origin (that is the application).
 *
 * ⚠️ This gate must fail when it cannot see. Scanning zero files is a FAILURE,
 * not a pass — "found nothing" and "looked at nothing" produce the same empty
 * result, and this project has shipped that mistake before.
 *
 * Usage: node scripts/check-zero-tracking.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

// Client-side surfaces only. Server code may talk to anything it likes; the
// posture is about what the BROWSER does.
const ROOTS = ['app', 'public'];
const EXT = /\.(ts|tsx|js|jsx|mjs|html)$/;
const SKIP_DIR = new Set(['node_modules', 'dist', 'build', '.types', 'paraglide', 'vendor', 'fonts']);

// Files that match a rule for a reason that has been looked at. Each needs a
// sentence, not a name — a bare allowlist entry is indistinguishable from a
// forgotten one.
const ALLOW = new Map([
    // (empty today — every entry here must state why the match is not tracking)
]);

const RULES = [
    {
        id: 'sendBeacon',
        re: /navigator\s*\.\s*sendBeacon/,
        why: 'navigator.sendBeacon exists to post data on unload. There is no non-tracking use of it here.',
    },
    {
        id: 'analytics-global',
        re: /\b(gtag\s*\(|dataLayer\b|_paq\b|posthog\b|mixpanel\b|amplitude\b|zaraz\b)/,
        why: 'An analytics vendor global in client code IS the vendor. OpenInspection ships none.',
    },
];

// Rule 3 needs more than a regex: an image is only a beacon when nothing ever
// looks at it. Flag `new Image()` whose src is interpolated and whose result is
// not consumed in the same file.
function pixelHits(text, lines) {
    const out = [];
    const consumed = /\.(onload|onerror|decode)\b|addEventListener\(\s*['"]load/.test(text);
    lines.forEach((line, i) => {
        const isNewImage = /new\s+Image\s*\(/.test(line);
        const isImgTag = /<img[^>]+src\s*=\s*[{`]/.test(line);
        if (!isNewImage && !isImgTag) return;
        const interpolated = /[`$]\{|\+\s*\w|\$\{/.test(line);
        if (!interpolated) return;
        if (consumed) return;
        out.push({ line: i + 1, text: line.trim().slice(0, 120) });
    });
    return out;
}

function walk(dir, acc) {
    let entries;
    try { entries = readdirSync(dir); } catch { return acc; }
    for (const name of entries) {
        if (SKIP_DIR.has(name)) continue;
        const p = join(dir, name);
        let st;
        try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) walk(p, acc);
        else if (EXT.test(name)) acc.push(p);
    }
    return acc;
}

const files = [];
for (const r of ROOTS) walk(join(ROOT, r), files);

// Anti-blindness. A rename of `app/` or a bad cwd must not read as "clean".
if (files.length < 50) {
    console.error(`[zero-tracking] FAIL — scanned only ${files.length} files under ${ROOTS.join(', ')}.`);
    console.error('  That is too few to be this application, so the gate is looking at the wrong tree.');
    console.error('  Refusing to report success on a scan that examined nothing.');
    process.exit(1);
}

const findings = [];
for (const abs of files) {
    const rel = relative(ROOT, abs).split(sep).join('/');
    if (ALLOW.has(rel)) continue;
    let text;
    try { text = readFileSync(abs, 'utf8'); } catch { continue; }
    const lines = text.split(/\r?\n/);

    for (const rule of RULES) {
        lines.forEach((line, i) => {
            if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
            if (rule.re.test(line)) findings.push({ rel, line: i + 1, rule: rule.id, why: rule.why, text: line.trim().slice(0, 120) });
        });
    }
    for (const hit of pixelHits(text, lines)) {
        findings.push({ rel, line: hit.line, rule: 'tracking-pixel', why: 'An image with an interpolated src that nothing ever loads or decodes is a request, not a picture.', text: hit.text });
    }
}

if (findings.length === 0) {
    console.log(`[zero-tracking] OK — ${files.length} client files scanned; no beacons, analytics globals, or unconsumed pixels.`);
    process.exit(0);
}

console.error(`[zero-tracking] FAIL — ${findings.length} client-tracking finding(s) across ${files.length} files scanned.`);
for (const f of findings) {
    console.error(`  ${f.rel}:${f.line}  [${f.rule}]`);
    console.error(`     ${f.text}`);
    console.error(`     ${f.why}`);
}
console.error('');
console.error('OpenInspection ships no client-side tracking. If a match is genuinely not tracking,');
console.error('add it to ALLOW in this file WITH a sentence explaining why — a bare entry is');
console.error('indistinguishable from a forgotten one.');
process.exit(1);

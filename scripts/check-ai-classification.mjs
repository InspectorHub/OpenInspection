#!/usr/bin/env node
/**
 * AI output-classification gate.
 *
 * Every AI capability must say what KIND of statement it produces, because that
 * is what decides whether it may run and what it is subject to
 * (`server/lib/ai/output-classification.ts`).
 *
 * WHY THIS GATE IS DELIBERATELY SMALL. The primary enforcement is the type
 * system, not this script: `VersionedPrompt.classification` is REQUIRED, and
 * `AI_PROMPTS` carries `satisfies Record<string, VersionedPrompt<never>>`, so a
 * prompt with no classification fails to compile in two places at once — at the
 * definition and again at the chokepoint that consumes it. A gate could only
 * ever report that after the fact.
 *
 * So this script covers the one thing a type cannot see: **a second way to reach
 * a model.** Classification is enforced at `AIService.callGemini` because that
 * method takes a `VersionedPrompt` and has no overload accepting rendered text.
 * Code that sends a prompt some OTHER way is not merely untyped — it is a
 * capability that no classification, no posture, no meter and no provenance row
 * knows exists. That is the failure this repo keeps rediscovering: a gate that
 * checks whether declarations match execution will happily pass something that
 * declares nothing at all.
 *
 * THE RULES, and why each is drawn where it is.
 *
 *   1. `completion-outside-adapter` — a model COMPLETION endpoint reached from
 *      anywhere but `server/lib/ai/providers/`.
 *
 *      ⚠️ Keyed on the endpoint, NOT on the host. `server/api/secrets.ts` and
 *      `server/api/integrations.ts` both call
 *      `generativelanguage.googleapis.com/v1/models?pageSize=1` for the
 *      "Test connection" diagnostic. That asks the provider which models exist;
 *      it sends no prompt and produces no output to classify. A host-based rule
 *      would flag both on day one, and a gate that cries wolf gets switched off.
 *
 *   2. `adapter-outside-resolver` — constructing a provider adapter outside the
 *      one file whose job that is. A second construction site is a second
 *      opinion about which credentials a call runs on, which is what
 *      `resolve-provider.ts` exists to be the only answer to.
 *
 *      ⚠️ Keyed on the adapter DIRECTORY, not on a class name, and this is the
 *      whole reason the rule works at all. It previously matched a literal
 *      `new GeminiProvider(` — a class that had been deleted. The rule matched
 *      zero constructions in a tree containing two, and the summary line
 *      reported a pass, because "the rule found nothing" and "the rule cannot
 *      fire" print identically. The class names are now DISCOVERED from
 *      `server/lib/ai/providers/`, so the next rename cannot blind it, and both
 *      counts are printed on every run: how many adapter classes were found to
 *      look for, and how many constructions were found. **Zero of either is a
 *      FAILURE**, because that is the state this rule was just in.
 *
 *   3. `unclassified-prompt` — an `AI_PROMPTS` entry with no `classification`.
 *      Redundant with the compiler by design: this is the rule that names the
 *      gate, and it is what fires if someone ever loosens the type.
 *
 * A rule that finds NOTHING because it looked at nothing is a false green, so
 * the script fails when it cannot find the prompt table or scans no files.
 *
 * Usage:
 *   node scripts/check-ai-classification.mjs
 *   node scripts/check-ai-classification.mjs --self-test
 *
 * `--self-test` drives the SAME matcher over literal fixtures, including a
 * positive control: one construction outside the allowed files must produce
 * exactly one finding. A gate whose rules are only ever run against a clean
 * tree has never been shown to fail.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const PROMPTS = join(ROOT, 'server', 'lib', 'ai', 'prompts.ts');

/** Directories that legitimately speak a provider's HTTP shape. */
const ADAPTER_DIR = join('server', 'lib', 'ai', 'providers');
/**
 * The only file that may construct a provider adapter.
 *
 * The chokepoint is deliberately NOT on this list. It receives an adapter that
 * was already resolved; building its own would make it a second answer to whose
 * key paid, and the metering and the posture table both key on that answer.
 */
const ADAPTER_CONSTRUCTION_ALLOWED = [
    // Resolves whose key a call runs on, and returns the adapter bound to it.
    join('server', 'lib', 'ai', 'resolve-provider.ts'),
];

/**
 * The adapter class names, read out of the adapter directory.
 *
 * Returns `[]` when the directory is missing or exports no class — which the
 * caller treats as a FAILURE rather than as an empty rule.
 */
function discoverAdapterClasses(dir) {
    let files;
    try {
        files = readdirSync(dir);
    } catch {
        return [];
    }
    const names = [];
    for (const file of files) {
        if (!/\.ts$/.test(file) || /\.(test|spec)\.ts$/.test(file)) continue;
        const src = readFileSync(join(dir, file), 'utf8');
        for (const m of src.matchAll(/^export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/gm)) {
            names.push(m[1]);
        }
    }
    return names;
}

/** `new Foo(` / `new Bar(` for the discovered classes. Never a hand-written name. */
function adapterConstructionRe(names) {
    return new RegExp(`\\bnew\\s+(?:${names.join('|')})\\s*\\(`);
}

/** A line the scanners must not read as code — prose describes rules too. */
function isComment(line) {
    const t = line.trimStart();
    return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

const ADAPTER_CLASSES = discoverAdapterClasses(join(ROOT, ADAPTER_DIR));

const RULES = [
    {
        id: 'completion-outside-adapter',
        // Gemini, OpenAI-shaped and Anthropic-shaped completion endpoints.
        re: /:(?:stream)?generateContent|\/chat\/completions|\/v1\/messages\b/i,
        why: 'A model completion reached from outside the provider adapters bypasses the chokepoint, so nothing classifies, meters or records the call.',
        skip: (rel) => rel.startsWith(ADAPTER_DIR),
    },
    {
        id: 'adapter-outside-resolver',
        re: ADAPTER_CLASSES.length > 0 ? adapterConstructionRe(ADAPTER_CLASSES) : null,
        why: 'Only resolve-provider.ts may build a provider adapter; a second site is a second answer to which credentials a call runs on.',
        // Not `skip` — an allowed construction still has to be COUNTED, or
        // "no site outside the resolver" cannot be told from "no site at all".
        allowed: (rel) => ADAPTER_CONSTRUCTION_ALLOWED.includes(rel) || rel.startsWith(ADAPTER_DIR),
    },
];

const findings = [];
/** Constructions in a file that is allowed to have them. The positive control. */
let allowedConstructions = 0;

/* ---- self-test: prove the rules can fire, on fixtures ------------------ */

/**
 * Literal fixtures driven through the SAME matcher the real scan uses. Each
 * negative case sits beside a positive control, because a matcher that fired on
 * everything would satisfy every "must be flagged" case on its own.
 */
function selfTest() {
    const adapter = ADAPTER_CLASSES[0];
    const cases = [
        {
            name: 'positive control: a construction outside the allowed files is ONE finding',
            rel: 'server/services/rogue.ts',
            lines: [`const p = new ${adapter}({ baseUrl, model, apiKey });`],
            expect: { findings: 1, rule: 'adapter-outside-resolver' },
        },
        {
            name: 'the resolver may construct one, and it is counted rather than flagged',
            rel: 'server/lib/ai/resolve-provider.ts',
            lines: [`return { provider: new ${adapter}({ baseUrl, model, apiKey }) };`],
            expect: { findings: 0, allowed: 1 },
        },
        {
            name: 'a comment describing the rule is not the rule being broken',
            rel: 'server/services/rogue.ts',
            lines: [`// never write new ${adapter}( outside the resolver`],
            expect: { findings: 0 },
        },
        {
            name: 'positive control: a completion endpoint outside the adapters is flagged',
            rel: 'server/services/rogue.ts',
            lines: ["await fetch(base + '/chat/completions', init);"],
            expect: { findings: 1, rule: 'completion-outside-adapter' },
        },
        {
            name: 'an adapter speaking its own HTTP shape is not',
            rel: 'server/lib/ai/providers/openai-compatible.ts',
            lines: ["await fetch(base + '/chat/completions', init);"],
            expect: { findings: 0 },
        },
    ];

    console.log(`ai-classification self-test: ${cases.length} case(s), against ` +
        `${ADAPTER_CLASSES.length} discovered adapter class(es)\n`);
    if (ADAPTER_CLASSES.length === 0) {
        console.error('  discovered ZERO adapter classes — the rule under test does not exist.');
        return 1;
    }

    let failed = 0;
    for (const c of cases) {
        findings.length = 0;
        const before = allowedConstructions;
        scanLines(c.rel, c.lines);
        const gotAllowed = allowedConstructions - before;
        const okCount = findings.length === c.expect.findings;
        const okRule = c.expect.rule ? findings.every((f) => f.rule === c.expect.rule) : true;
        const okAllowed = c.expect.allowed === undefined || gotAllowed === c.expect.allowed;
        const pass = okCount && okRule && okAllowed;
        if (!pass) failed++;
        console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${c.name}`);
        if (!pass) {
            console.error(`        expected ${c.expect.findings} finding(s)` +
                (c.expect.rule ? ` of rule '${c.expect.rule}'` : '') +
                (c.expect.allowed === undefined ? '' : ` and ${c.expect.allowed} allowed`) +
                `, got ${findings.length}` +
                (findings.length ? ` [${findings.map((f) => f.rule).join(', ')}]` : '') +
                ` and ${gotAllowed} allowed`);
        }
    }
    findings.length = 0;
    allowedConstructions = 0;

    const controls = cases.filter((c) => /positive control/.test(c.name)).length;
    if (controls === 0) {
        console.error('\nai-classification self-test: NO positive control ran. A rule that never');
        console.error('fires in its own suite has not been shown to work.');
        return 1;
    }
    console.log(`\nai-classification self-test: ${cases.length - failed}/${cases.length} passed, ` +
        `${controls} of them positive controls`);
    return failed === 0 ? 0 : 1;
}

if (process.argv.includes('--self-test')) process.exit(selfTest());

/* ---- Rule 3: every prompt declares a classification ------------------- */

let promptsSrc;
try {
    promptsSrc = readFileSync(PROMPTS, 'utf8');
} catch {
    console.error('[ai-classification] FAIL — cannot read server/lib/ai/prompts.ts.');
    console.error('  The prompt table is what this gate checks. If it moved, update this script;');
    console.error('  a gate that cannot find its subject must not report success.');
    process.exit(1);
}

const tableStart = promptsSrc.indexOf('export const AI_PROMPTS = {');
if (tableStart === -1) {
    console.error('[ai-classification] FAIL — found no `export const AI_PROMPTS = {` in prompts.ts.');
    console.error('  Refusing to report success on a scan that located no prompts at all.');
    process.exit(1);
}

// Line numbers are reported against the FILE, so the offset of the table has to
// be carried through. Without it the gate points at the header comment and the
// reader concludes it is broken rather than that a prompt is unclassified.
const LINE_OFFSET = promptsSrc.slice(0, tableStart).split(/\r?\n/).length - 1;
const promptLines = promptsSrc.slice(tableStart).split(/\r?\n/);
const entries = [];
let current = null;
for (let i = 0; i < promptLines.length; i++) {
    const line = promptLines[i];
    const open = /^ {4}(\w+): \{\s*$/.exec(line);
    if (open) {
        current = { name: open[1], line: i, classified: false };
        entries.push(current);
        continue;
    }
    if (!current) continue;
    if (/^ {4}\},?\s*$/.test(line)) { current = null; continue; }
    if (/^ {8}classification:\s*'[a-z_]+'/.test(line)) current.classified = true;
}

if (entries.length === 0) {
    console.error('[ai-classification] FAIL — parsed 0 prompts out of AI_PROMPTS.');
    console.error('  The table exists but no entry matched the expected shape, so every');
    console.error('  classification rule below would pass vacuously. Fix the parser, not the gate.');
    process.exit(1);
}

const promptRel = relative(ROOT, PROMPTS).split(sep).join('/');
for (const e of entries) {
    if (e.classified) continue;
    findings.push({
        rel: promptRel,
        line: LINE_OFFSET + e.line + 1,
        rule: 'unclassified-prompt',
        text: `AI_PROMPTS.${e.name}`,
        why: 'A prompt with no classification has no posture, so nothing decides whether it may run or whether its output needs review.',
    });
}

/* ---- Rules 1 and 2: scan the server tree ------------------------------ */

const SCAN_ROOTS = ['server', 'app', 'packages', 'workers'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.types', '.react-router']);
const files = [];
for (const root of SCAN_ROOTS) {
    const abs = join(ROOT, root);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (!st.isDirectory()) continue;
    const stack = [abs];
    while (stack.length) {
        const dir = stack.pop();
        for (const name of readdirSync(dir)) {
            if (SKIP_DIRS.has(name)) continue;
            const full = join(dir, name);
            const s = statSync(full);
            if (s.isDirectory()) { stack.push(full); continue; }
            if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) files.push(full);
        }
    }
}

if (files.length < 50) {
    console.error(`[ai-classification] FAIL — scanned only ${files.length} source files.`);
    console.error('  This repository has hundreds. "Found no violations" and "examined nothing"');
    console.error('  produce the same empty result, so the low count is treated as the failure.');
    process.exit(1);
}

/** Run every rule over one file's lines. Shared with the self-test. */
function scanLines(relPosix, lines) {
    for (const rule of RULES) {
        if (rule.re === null) continue;
        if (rule.skip?.(relPosix.split('/').join(sep))) continue;
        const allowedHere = rule.allowed?.(relPosix.split('/').join(sep)) ?? false;
        lines.forEach((line, i) => {
            // Comments describe the rule as often as they break it — this very
            // file's header would trip rule 1 on the endpoint names it lists.
            if (isComment(line)) return;
            if (!rule.re.test(line)) return;
            if (allowedHere) {
                if (rule.id === 'adapter-outside-resolver') allowedConstructions++;
                return;
            }
            findings.push({
                rel: relPosix, line: i + 1, rule: rule.id, why: rule.why,
                text: line.trim().slice(0, 120),
            });
        });
    }
}

for (const abs of files) {
    const relPosix = relative(ROOT, abs).split(sep).join('/');
    scanLines(relPosix, readFileSync(abs, 'utf8').split(/\r?\n/));
}

/* ---- The two numbers, printed on every run ---------------------------- */

// A rule keyed on nothing matches nothing and prints the same OK as a clean
// tree. Both of these were true of this gate for its whole life, so both are
// hard failures rather than a note in the summary.
if (ADAPTER_CLASSES.length === 0) {
    console.error('[ai-classification] FAIL — discovered 0 adapter classes in ' + ADAPTER_DIR + '.');
    console.error('  The construction rule is built FROM that list, so an empty one means the rule');
    console.error('  matches nothing at all. Either the adapters moved, or `export class` is no');
    console.error('  longer how they are declared. A rule that cannot fire must not report a pass.');
    process.exit(1);
}
if (allowedConstructions === 0) {
    console.error('[ai-classification] FAIL — found 0 adapter constructions anywhere, including');
    console.error(`  the ${ADAPTER_CONSTRUCTION_ALLOWED.length} file(s) whose job it is.`);
    console.error('  Somebody has to build one. Zero means the matcher no longer recognises the');
    console.error('  construction it is looking for, which reads as a clean tree and is not.');
    process.exit(1);
}

if (findings.length === 0) {
    console.log(
        `[ai-classification] OK — ${entries.length} prompts all classified; ` +
        `${files.length} source files scanned; ` +
        `${ADAPTER_CLASSES.length} adapter class(es) discovered (${ADAPTER_CLASSES.join(', ')}); ` +
        `${allowedConstructions} construction site(s), all inside ` +
        `${ADAPTER_CONSTRUCTION_ALLOWED.map((p) => p.split(sep).join('/')).join(', ')}.`,
    );
    process.exit(0);
}

console.error(
    `[ai-classification] FAIL — ${findings.length} finding(s) across ${files.length} files ` +
    `scanned; ${ADAPTER_CLASSES.length} adapter class(es) discovered; ` +
    `${allowedConstructions} allowed construction site(s).`,
);
for (const f of findings) {
    console.error(`  ${f.rel}:${f.line}  [${f.rule}]`);
    console.error(`     ${f.text}`);
    console.error(`     ${f.why}`);
}
console.error('');
console.error('Every AI capability declares what kind of statement it produces, and reaches the');
console.error('model through AIService.callGemini. If a match is genuinely neither — a diagnostic');
console.error('that lists models rather than sending a prompt, say — allow it in this file WITH a');
console.error('sentence explaining why. A bare entry is indistinguishable from a forgotten one.');
process.exit(1);

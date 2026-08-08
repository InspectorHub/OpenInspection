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
 *      two files whose job that is. A third construction site is a second
 *      opinion about which credentials a call runs on, which is what
 *      `resolve-provider.ts` exists to be the only answer to.
 *
 *   3. `unclassified-prompt` — an `AI_PROMPTS` entry with no `classification`.
 *      Redundant with the compiler by design: this is the rule that names the
 *      gate, and it is what fires if someone ever loosens the type.
 *
 * A rule that finds NOTHING because it looked at nothing is a false green, so
 * the script fails when it cannot find the prompt table or scans no files.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const PROMPTS = join(ROOT, 'server', 'lib', 'ai', 'prompts.ts');

/** Directories that legitimately speak a provider's HTTP shape. */
const ADAPTER_DIR = join('server', 'lib', 'ai', 'providers');
/** The only files that may construct a provider adapter. */
const ADAPTER_CONSTRUCTION_ALLOWED = [
    // Resolves whose key a call runs on, and returns the adapter bound to it.
    join('server', 'lib', 'ai', 'resolve-provider.ts'),
    // The chokepoint. Builds the adapter it is about to call, after the gate.
    join('server', 'services', 'ai.service.ts'),
];

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
        re: /\bnew\s+GeminiProvider\s*\(/,
        why: 'Only resolve-provider.ts and the AI chokepoint may build a provider adapter; a third site is a second answer to which credentials a call runs on.',
        skip: (rel) => ADAPTER_CONSTRUCTION_ALLOWED.includes(rel) || rel.startsWith(ADAPTER_DIR),
    },
];

const findings = [];

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

for (const abs of files) {
    const rel = relative(ROOT, abs);
    const relPosix = rel.split(sep).join('/');
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
    for (const rule of RULES) {
        if (rule.skip(rel)) continue;
        lines.forEach((line, i) => {
            const t = line.trimStart();
            // Comments describe the rule as often as they break it — this very
            // file's header would trip rule 1 on the endpoint names it lists.
            if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
            if (rule.re.test(line)) {
                findings.push({
                    rel: relPosix, line: i + 1, rule: rule.id, why: rule.why,
                    text: line.trim().slice(0, 120),
                });
            }
        });
    }
}

if (findings.length === 0) {
    console.log(
        `[ai-classification] OK — ${entries.length} prompts all classified; ` +
        `${files.length} source files scanned, no completion call or adapter construction outside the chokepoint.`,
    );
    process.exit(0);
}

console.error(`[ai-classification] FAIL — ${findings.length} finding(s) across ${files.length} files scanned.`);
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

#!/usr/bin/env node
/**
 * Chrome-record gate (commit-msg rung).
 *
 * Fails (exit 1) when a commit changes a user-visible file under `app/` and its
 * message carries no Chrome record.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS GATE CANNOT DO
 * ---------------------------------------------------------------------------
 * It cannot verify that anyone looked at anything. A line of text satisfies it.
 * Somebody who never opened a browser can type `Chrome: /settings — looks fine`
 * and this gate will go green. There is no check here on truth, and there is no
 * check available: nothing a commit-msg hook can read distinguishes a screen
 * that was rendered from one that was imagined.
 *
 * So do not cite a green run of this gate as evidence that a screen was
 * verified. It is not that, and it will never become that.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CAN DO, AND WHY IT IS WORTH HAVING ANYWAY
 * ---------------------------------------------------------------------------
 * The house rule "look at a UI change in a browser before you commit it" has
 * been in CLAUDE.md for months and the repository holds almost no trace of it
 * being followed. Measured 2026-08-22: the execution ledger says "Chrome" 22
 * times and exactly ONE of those carries a verification word; of 23 unpushed
 * engine commits one mentions Chrome, and that one says the check is OWED; of
 * 13 unpushed portal commits, one, the same. Three screens genuinely were
 * checked that day and nothing recorded it — not because anyone hid it, but
 * because there was nowhere to write it down.
 *
 * That is the gap this closes. It gives the record a place to live, fixes its
 * shape so the records are comparable to each other, and makes a MISSING one
 * loud at the one moment when going back and looking is still cheap.
 *
 * The size of the change being asked for, measured with this script's own
 * --report-only mode on the day it was written (2026-08-23):
 *     engine  24 unpushed commits — 10 changed a user-visible file, 11 would fail
 *     portal  14 unpushed commits —  8 changed a user-visible file,  8 would fail
 * Nineteen of nineteen commits that touched a screen carry no usable record.
 * That is not a backlog to pay down — a commit-msg hook only ever sees new
 * commits, so none of this is baselined and none of it is enforced
 * retroactively. It is the measurement of a practice that has never had a
 * place to be written down.
 *
 * This is the same deal every ledger gate in this repo makes. `lint:migrefs`
 * does not verify that a comment is true; it makes an unstable citation
 * impossible to leave lying around silently. `check-gate-registry` does not
 * verify that a gate works; it makes an unregistered one impossible to forget.
 * None of them verify work. They make records consistent, and they make a
 * missing record loud. Read this gate as a member of that family and it is
 * doing its job. Read it as proof and it will mislead you.
 *
 * ---------------------------------------------------------------------------
 * THE GRAMMAR
 * ---------------------------------------------------------------------------
 *     Chrome: <route> — <what you observed>
 *
 * e.g.  Chrome: /settings/imports?intent=contacts.import — link renders, both
 *       themes, CSV byte-exact
 *
 * Both halves are load-bearing and both are checked as far as they can be:
 *   - <route> must start with `/`. A record that does not say WHICH screen
 *     cannot be re-checked by the next person, which makes it a mood, not a
 *     record.
 *   - <what you observed> must be at least MIN_OBSERVATION_CHARS characters and
 *     at least two words. "ok" is not an observation. This is the only lever
 *     available against a record that is technically present and says nothing,
 *     and it is a weak one — see WHAT THIS GATE CANNOT DO.
 * One line per screen; several lines are fine and all of them are counted.
 * The separator may be an em dash, an en dash, ` -- `, or ` - `.
 *
 * ---------------------------------------------------------------------------
 * THE ESCAPE HATCH
 * ---------------------------------------------------------------------------
 *     chrome-allow: <reason>
 *
 * There must be one. Some `app/` changes genuinely are not visual (a prop
 * rename, a `data-testid`, deleting dead markup) and some screens cannot be
 * reached locally at all — a state a standalone deployment cannot produce, a
 * screen behind a provider key this machine does not hold. A gate with no
 * hatch for those gets bypassed wholesale with `--no-verify`, and then it
 * protects nothing.
 *
 * It follows the house pattern from `lint:migrefs`: an EXPLICIT marker carrying
 * a REASON, never a bare skip. The reason is prose because a skip with no
 * reason is indistinguishable from an oversight. Escapes are COUNTED and
 * printed on every run, pass or fail, so that "we use the hatch constantly" is
 * a visible fact rather than a thing nobody happens to mention.
 *
 * The hatch is per-COMMIT, not per-file: one marker excuses the whole commit.
 * That is a deliberate looseness — a per-file hatch would need the file list in
 * the message, and a commit message is not a manifest. It does mean a commit
 * that mixes one unreachable screen with three reachable ones can be waved
 * through in one line. Nothing here can stop that.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS USER-VISIBLE
 * ---------------------------------------------------------------------------
 * Two stages, because either one alone is wrong. Flagging every `app/` touch
 * makes the gate noise, and a noisy gate gets bypassed — which is the failure
 * mode that matters most here, since the gate's whole value is that people
 * comply with it.
 *
 * Stage 1, PATH. A staged file is a candidate if it is under one of
 * CANDIDATE_DIRS, minus EXCLUDED_PATHS: tests (they do not ship), `.d.ts`
 * (types have no pixels), and generated output like `app/paraglide/` (nobody
 * hand-writes it, and it changes on every message extraction).
 *
 * Stage 2, CONTENT. The candidate's changed lines (added and removed, from the
 * staged diff at -U0) are read. Lines that are purely a comment, an import, or
 * a type declaration are dropped first — a comment mentioning `<Button>` must
 * not make a file visual, and the negation case is the dangerous one, because
 * explaining why you did NOT use a component means writing its name. What
 * remains must carry at least one RENDER_SIGNAL: a JSX tag, a `className` /
 * `style` prop, or a paraglide message call. Three file classes short-circuit
 * to visual on any real changed line, because for them every line is render:
 * stylesheets, the route table (`app/routes.ts` — a changed route is a changed
 * URL), and `app/content/` (copy that is rendered verbatim to a user).
 *
 * WHAT IT MISSES, in both directions. Stated because a gate whose blind spots
 * are undocumented gets trusted past its evidence.
 *
 * FALSE NEGATIVES — real UI changes this will wave through:
 *   1. Loaders and actions. The biggest one, and deliberate: a loader change
 *      that alters the data on screen is indistinguishable, at this altitude,
 *      from one that does not. The brief for this gate says a loader with no
 *      render change is not UI; the cost of honouring that is that a loader
 *      WITH a render change is not caught either.
 *   2. Visible text held in a bare constant — `const TITLE = "Imports";` — on a
 *      line with no JSX and no message call. CONFIRMED on real history: commit
 *      1e79c8d7 changed `app/lib/import-run-labels.ts`, the lookup table that
 *      decides the words on the imports screen, and this gate judged it not
 *      visual. That commit was fixing a bug where a declined run rendered as
 *      "Ready to review" — the most user-visible defect in the batch — and the
 *      only reason the gate stopped it at all was a malformed Chrome line.
 *   3. Render-gating logic with no markup on the changed line: `if (!x) return
 *      null;`, a changed ternary condition, a changed array `.filter()` feeding
 *      a list.
 *   4. Formatting helpers under `app/lib/` whose output is displayed — a date
 *      formatter, a currency helper. The pixels change; the diff has no tags.
 *   5. Everything outside CANDIDATE_DIRS. For the engine that includes
 *      `packages/shared-ui/src/` — the shared component library, whose changes
 *      are as visual as anything under `app/` and land on every screen at once.
 *      It is left out because the rule this gate was asked to enforce is scoped
 *      to `app/`; it is the first thing to add if the gate proves useful, and
 *      adding it means one entry in CANDIDATE_DIRS.
 *   6. Tailwind config, design tokens, and any CSS living outside `app/`.
 *
 * FALSE POSITIVES — non-visual changes this will flag:
 *   1. Prop-only edits on a JSX line: adding `data-testid`, `aria-*` (though an
 *      aria change arguably IS user-visible, to a screen reader), a key, a ref.
 *   2. Mechanical renames — `<Foo>` to `<Bar>` across many files.
 *   3. Deleting a component: every line is a removed line and several carry
 *      tags. Arguably correct — a deleted screen deserves a look — but it is a
 *      flag on a change with no new pixels to inspect.
 *   4. Reordering or reformatting JSX with no visual delta.
 * All four are what the escape hatch is for.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------
 *   node scripts/check-chrome-record.mjs <path-to-COMMIT_EDITMSG>
 *       The commit-msg rung. Judges the STAGED diff against that message.
 *
 *   node scripts/check-chrome-record.mjs --self-test
 *       Runs the built-in cases, positive control first.
 *
 *   node scripts/check-chrome-record.mjs --report-only --range <rev-range>
 *       Measurement mode. Judges each commit in the range against its own
 *       message and prints how many WOULD fail. Always exits 0 — this mode
 *       reports, it does not enforce. A commit-msg hook only ever sees new
 *       commits, so history is never baselined, only counted.
 *
 * Env: CHROME_RECORD_REPORT_ONLY=1 downgrades the commit-msg rung to a warning.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Directories whose files can be user-visible. See FALSE NEGATIVES note 5. */
const CANDIDATE_DIRS = ['app/'];

/** Under CANDIDATE_DIRS but never user-visible, with the reason. */
const EXCLUDED_PATHS = [
    { re: /\.(test|spec)\.[jt]sx?$/, why: 'test file — does not ship' },
    { re: /(^|\/)__(tests|mocks|snapshots|fixtures)__\//, why: 'test support — does not ship' },
    { re: /\.d\.ts$/, why: 'type declarations have no pixels' },
    { re: /^app\/paraglide\//, why: 'generated i18n output — not hand-written' },
];

/**
 * File classes where EVERY real changed line is a render change, so the
 * per-line signal search below is skipped.
 */
const WHOLE_FILE_VISUAL = [
    { re: /\.css$/, why: 'stylesheet' },
    { re: /^app\/routes\.ts$/, why: 'route table — a changed route is a changed URL' },
    { re: /^app\/content\//, why: 'copy rendered verbatim to a user' },
];

/**
 * At least one of these on a real changed line makes the file visual.
 *
 * `jsxOnly` signals are checked only in `.tsx`. A `.ts` file cannot legally
 * hold JSX, so restricting them there costs nothing and removes an entire
 * false-positive class: TYPESCRIPT GENERICS LOOK EXACTLY LIKE JSX TAGS.
 * `ReturnType<typeof hc<AgentTermsApi>>` in app/lib/api-client.server.ts read
 * as a component tag on the first real run of this gate, and a server module
 * with no markup in it was reported as user-visible.
 *
 * The lookbehind on the component-tag pattern closes the same hole INSIDE
 * `.tsx`, where generics are just as common: `useState<Row>(null)` is not a
 * render. A JSX tag's `<` is preceded by whitespace, `(`, `{`, `>` or start of
 * line; a generic's `<` is preceded by the identifier it parameterises.
 */
const RENDER_SIGNALS = [
    { name: 'jsx component tag', jsxOnly: true, re: /(?<![A-Za-z0-9_$])<\/?[A-Z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*[\s/>]/ },
    {
        name: 'html tag',
        jsxOnly: true,
        re: /<\/?(?:div|span|p|a|button|input|label|form|section|nav|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|h[1-6]|img|svg|path|circle|rect|select|textarea|option|optgroup|header|footer|main|aside|article|dl|dt|dd|pre|code|strong|em|small|b|i|u|br|hr|iframe|video|audio|canvas|details|summary|figure|figcaption|fieldset|legend|caption|blockquote|dialog)\b/,
    },
    { name: 'class/style prop', jsxOnly: true, re: /\b(?:className|class|style|tw)\s*=/ },
    // Not jsxOnly: a `.ts` helper under app/lib that builds a translated string
    // is producing text a person reads.
    { name: 'translated message call', jsxOnly: false, re: /\bm\.[A-Za-z0-9_]+\s*\(/ },
];

/** Shortest observation half that is allowed to count as a record. */
const MIN_OBSERVATION_CHARS = 10;
/** Shortest escape-hatch reason that is allowed to count as a reason. */
const MIN_REASON_CHARS = 10;

const CHROME_LINE_RE = /^[ \t]*Chrome:[ \t]*(.*)$/gim;
const CHROME_PARSE_RE = /^(\S+)[ \t]*(?:—|–|--|-)[ \t]*(.+)$/;
const ALLOW_LINE_RE = /^[ \t]*chrome-allow:[ \t]*(.*)$/gim;

// ---------------------------------------------------------------------------
// Pure judgement. Everything below main() takes data, not a repository, so the
// self-test exercises the same code the hook runs rather than a paraphrase.
// ---------------------------------------------------------------------------

/** True for a changed line that cannot itself be a render change. */
function isIgnorableLine(raw) {
    const t = raw.trim();
    if (t === '') return true;
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/')) return true;
    if (/^import[\s{(]/.test(t) || /^export[ \t]+(?:type|interface)\b/.test(t)) return true;
    if (/^(?:export[ \t]+)?(?:type|interface)[ \t]+[A-Za-z_$]/.test(t)) return true;
    return false;
}

/**
 * @param {{path: string, changedLines: string[]}[]} entries every staged file
 * @returns {{considered: number, candidates: object[], skipped: object[], visual: object[]}}
 */
export function judgeFiles(entries) {
    const candidates = [];
    const skipped = [];
    const visual = [];

    for (const entry of entries) {
        const p = entry.path;
        if (!CANDIDATE_DIRS.some((d) => p.startsWith(d))) continue;

        const excluded = EXCLUDED_PATHS.find((x) => x.re.test(p));
        if (excluded) {
            skipped.push({ path: p, why: excluded.why });
            continue;
        }
        candidates.push({ path: p });

        const real = entry.changedLines.filter((l) => !isIgnorableLine(l));
        if (real.length === 0) continue;

        const whole = WHOLE_FILE_VISUAL.find((w) => w.re.test(p));
        if (whole) {
            visual.push({ path: p, signal: whole.why, line: real[0].trim() });
            continue;
        }
        const isTsx = p.endsWith('.tsx');
        const signals = RENDER_SIGNALS.filter((s) => isTsx || !s.jsxOnly);
        for (const line of real) {
            const hit = signals.find((s) => s.re.test(line));
            if (hit) {
                visual.push({ path: p, signal: hit.name, line: line.trim() });
                break;
            }
        }
    }
    return { considered: entries.length, candidates, skipped, visual };
}

/** @returns {{records: object[], malformed: string[], allows: object[], badAllows: string[]}} */
export function parseMessage(message) {
    // The commit-message comment block (`# ...`) is stripped by git AFTER the
    // hook runs, so a `Chrome:` line the author left commented out must not
    // count. Strip it here the way git will.
    const body = message
        .split(/\r?\n/)
        .filter((l) => !/^[ \t]*#/.test(l))
        .join('\n');

    const records = [];
    const malformed = [];
    for (const m of body.matchAll(CHROME_LINE_RE)) {
        const rest = m[1].trim();
        const parsed = CHROME_PARSE_RE.exec(rest);
        if (!parsed) {
            malformed.push({ raw: m[0].trim(), why: 'no `<route> — <observation>` split' });
            continue;
        }
        const [, route, observation] = parsed;
        const obs = observation.trim();
        if (!route.startsWith('/')) {
            malformed.push({ raw: m[0].trim(), why: `route \`${route}\` does not start with \`/\`` });
        } else if (obs.length < MIN_OBSERVATION_CHARS || obs.split(/\s+/).length < 2) {
            malformed.push({
                raw: m[0].trim(),
                why: `observation \`${obs}\` is too thin (needs >= ${MIN_OBSERVATION_CHARS} chars and >= 2 words)`,
            });
        } else {
            records.push({ route, observation: obs, raw: m[0].trim() });
        }
    }

    const allows = [];
    const badAllows = [];
    for (const m of body.matchAll(ALLOW_LINE_RE)) {
        const reason = m[1].trim();
        if (reason.length < MIN_REASON_CHARS || reason.split(/\s+/).length < 2) {
            badAllows.push({
                raw: m[0].trim(),
                why: `reason \`${reason}\` is too thin (needs >= ${MIN_REASON_CHARS} chars and >= 2 words)`,
            });
        } else {
            allows.push({ reason, raw: m[0].trim() });
        }
    }
    return { records, malformed, allows, badAllows };
}

/**
 * @returns {{ok: boolean, counts: object, problems: string[], judged: object}}
 */
export function evaluate({ entries, message }) {
    const judged = judgeFiles(entries);
    const parsed = parseMessage(message);
    const counts = {
        staged: judged.considered,
        underApp: judged.candidates.length + judged.skipped.length,
        skipped: judged.skipped.length,
        visual: judged.visual.length,
        records: parsed.records.length,
        malformed: parsed.malformed.length,
        allows: parsed.allows.length,
        badAllows: parsed.badAllows.length,
    };

    const problems = [];
    // A malformed record is louder than a missing one: the author meant to
    // leave a record and the next reader cannot use what they left.
    for (const m of parsed.malformed) problems.push(`malformed Chrome line — ${m.why}\n      ${m.raw}`);
    for (const b of parsed.badAllows) problems.push(`malformed chrome-allow — ${b.why}\n      ${b.raw}`);

    if (counts.visual > 0 && counts.records === 0 && counts.allows === 0) {
        problems.push(
            `${counts.visual} user-visible file(s) changed and the message carries no Chrome record and no chrome-allow.`,
        );
    }
    return { ok: problems.length === 0, counts, problems, judged, parsed };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printCounts(c, verdict) {
    // Every number, every run. A gate that speaks only when it is angry cannot
    // be checked on the day it is quiet.
    console.log(
        `chrome-record: staged ${c.staged} | under app/ ${c.underApp} | skipped ${c.skipped} ` +
            `| judged visual ${c.visual} | Chrome records ${c.records} (malformed ${c.malformed}) ` +
            `| chrome-allow ${c.allows} (malformed ${c.badAllows}) -> ${verdict}`,
    );
}

function printFailure(result) {
    console.error('\nChrome-record check FAILED.\n');
    console.error('This commit changes what a person sees, and the message does not say anyone looked.\n');

    if (result.judged.visual.length > 0) {
        console.error('  Files judged user-visible, and the changed line that made them so:');
        for (const v of result.judged.visual) {
            console.error(`    ${v.path}  [${v.signal}]`);
            console.error(`        ${v.line.slice(0, 120)}`);
        }
        console.error('');
    }
    if (result.judged.skipped.length > 0) {
        console.error(`  Skipped under app/ (${result.judged.skipped.length}):`);
        for (const s of result.judged.skipped) console.error(`    ${s.path} — ${s.why}`);
        console.error('');
    }
    for (const p of result.problems) console.error(`  ✗ ${p}`);

    console.error('\n  Add one line per screen you opened:\n');
    console.error('      Chrome: /settings/imports?intent=contacts.import — link renders, both themes, CSV byte-exact');
    console.error('\n  Route must start with `/`. The observation must say what you SAW —');
    console.error(`  at least ${MIN_OBSERVATION_CHARS} characters and two words; "ok" is not an observation.`);
    console.error('  Separator may be — , – , -- , or - .');
    console.error('\n  If the change is genuinely not visual, or the screen cannot be reached');
    console.error('  on this machine, say so explicitly — never a bare skip:\n');
    console.error('      chrome-allow: prop rename only, no rendered output changes');
    console.error('      chrome-allow: seat-limit banner needs a SaaS tenant, unreachable standalone');
    console.error('\n  This gate cannot tell whether you looked. It only records that you say you did.');
}

// ---------------------------------------------------------------------------
// Git readers. Every one of them fails closed: a reader that cannot read must
// not be mistaken for a repository that is clean.
// ---------------------------------------------------------------------------

function git(args) {
    const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error || r.status !== 0) {
        return { ok: false, why: (r.stderr || r.error?.message || `git ${args[0]} exited ${r.status}`).trim() };
    }
    return { ok: true, out: r.stdout };
}

/**
 * Parse `git diff -U0` / `git show -U0` output into per-file changed lines.
 * -U0 means no context, so every `+`/`-` line is a real change.
 */
function parseUnifiedDiff(text) {
    const byFile = new Map();
    let current = null;
    let pendingOld = null;
    for (const line of text.split(/\r?\n/)) {
        if (line.startsWith('--- ')) {
            const p = line.slice(4).replace(/^a\//, '').trim();
            pendingOld = p === '/dev/null' ? null : p;
            continue;
        }
        if (line.startsWith('+++ ')) {
            const p = line.slice(4).replace(/^b\//, '').trim();
            // A DELETED file has `+++ /dev/null`, and falling through there once
            // dropped every removed line in it — so deleting a rendered
            // component read as a change to nothing. Fall back to the old path:
            // a screen that no longer exists is a user-visible change, and the
            // gate must be able to say which file it was.
            current = p === '/dev/null' ? pendingOld : p;
            if (current && !byFile.has(current)) byFile.set(current, []);
            pendingOld = null;
            continue;
        }
        if (line.startsWith('diff --git ') || line.startsWith('@@')) continue;
        if (!current) continue;
        if (line.startsWith('+') || line.startsWith('-')) byFile.get(current).push(line.slice(1));
    }
    return byFile;
}

/** Staged entries for the commit-msg rung. Returns null on a reader failure. */
function readStagedEntries() {
    const names = git(['diff', '--cached', '--name-only', '--diff-filter=ACMRTD']);
    if (!names.ok) return { error: `could not list staged files: ${names.why}` };
    const files = names.out.split(/\r?\n/).filter(Boolean);

    const diff = git(['diff', '--cached', '-U0', '--no-color', '--no-ext-diff']);
    if (!diff.ok) return { error: `could not read the staged diff: ${diff.why}` };
    const byFile = parseUnifiedDiff(diff.out);

    return { entries: files.map((p) => ({ path: p, changedLines: byFile.get(p) ?? [] })) };
}

function readCommitEntries(sha) {
    const diff = git(['show', '-U0', '--no-color', '--no-ext-diff', '--format=', '-m', '--first-parent', sha]);
    if (!diff.ok) return { error: `could not read ${sha}: ${diff.why}` };
    const byFile = parseUnifiedDiff(diff.out);
    return { entries: [...byFile.entries()].map(([path, changedLines]) => ({ path, changedLines })) };
}

// ---------------------------------------------------------------------------
// Self-test. POSITIVE CONTROL FIRST: the case that must FAIL is asserted before
// any case that must pass, because a broken judge passes everything and a
// suite that only asserts passes is green on the day it stops working.
// ---------------------------------------------------------------------------

const VISUAL_DIFF = [{ path: 'app/routes/settings.imports.tsx', changedLines: ['  <Button className="mt-2">Import</Button>'] }];
const LOADER_DIFF = [{ path: 'app/routes/settings.imports.tsx', changedLines: ['  const rows = await db.select().from(imports);'] }];
const TEST_DIFF = [{ path: 'app/components/Foo.test.tsx', changedLines: ['  <Foo />'] }];
const COMMENT_DIFF = [{ path: 'app/routes/a.tsx', changedLines: ['  // deliberately not a <Banner> here, see #144'] }];
const GOOD = 'Chrome: /settings/imports?intent=contacts.import — link renders, both themes, CSV byte-exact';

const CASES = [
    // --- POSITIVE CONTROLS: these MUST fail. If the judge breaks, these go
    // green and the whole gate is decorative. They run first, on purpose.
    {
        name: 'POSITIVE CONTROL: visual change, no Chrome line -> FAIL',
        entries: VISUAL_DIFF,
        message: 'imports: add the contacts import link',
        expect: { ok: false, visual: 1, records: 0, allows: 0 },
    },
    {
        name: 'POSITIVE CONTROL: css change, no Chrome line -> FAIL',
        entries: [{ path: 'app/styles/tailwind.css', changedLines: ['  --color-bad: oklch(0.5 0.2 25);'] }],
        message: 'ds: darken the bad tone',
        expect: { ok: false, visual: 1 },
    },
    {
        name: 'POSITIVE CONTROL: route table change, no Chrome line -> FAIL',
        entries: [{ path: 'app/routes.ts', changedLines: ["  route('settings/imports', './routes/settings.imports.tsx'),"] }],
        message: 'routes: mount the imports screen',
        expect: { ok: false, visual: 1 },
    },
    {
        name: 'POSITIVE CONTROL: Chrome line with no route -> FAIL as malformed',
        entries: VISUAL_DIFF,
        message: 'imports: add the link\n\nChrome: looked at it and it was fine',
        expect: { ok: false, records: 0, malformed: 1 },
    },
    {
        name: 'POSITIVE CONTROL: Chrome line with an empty observation -> FAIL as malformed',
        entries: VISUAL_DIFF,
        message: 'imports: add the link\n\nChrome: /settings/imports — ok',
        expect: { ok: false, records: 0, malformed: 1 },
    },
    {
        name: 'POSITIVE CONTROL: bare skip with no reason -> FAIL as malformed',
        entries: VISUAL_DIFF,
        message: 'imports: add the link\n\nchrome-allow:',
        expect: { ok: false, allows: 0, badAllows: 1 },
    },
    {
        name: 'POSITIVE CONTROL: Chrome line commented out by git -> FAIL, it does not count',
        entries: VISUAL_DIFF,
        message: `imports: add the link\n\n# ${GOOD}`,
        expect: { ok: false, records: 0 },
    },

    // --- The passes.
    {
        name: 'visual change WITH a well-formed Chrome line -> PASS',
        entries: VISUAL_DIFF,
        message: `imports: add the contacts import link\n\n${GOOD}`,
        expect: { ok: true, visual: 1, records: 1 },
    },
    {
        name: 'two screens, two records -> PASS, both counted',
        entries: VISUAL_DIFF,
        message: `imports: two screens\n\n${GOOD}\nChrome: /settings/security — both themes, the revoke button is reachable`,
        expect: { ok: true, records: 2 },
    },
    {
        name: 'non-visual app/ change (loader only), no Chrome line -> PASS',
        entries: LOADER_DIFF,
        message: 'imports: widen the loader query',
        expect: { ok: true, visual: 0 },
    },
    {
        name: 'test file only, no Chrome line -> PASS and counted as skipped',
        entries: TEST_DIFF,
        message: 'imports: cover the empty state',
        expect: { ok: true, visual: 0, skipped: 1 },
    },
    {
        name: 'a comment naming a component does not make a file visual -> PASS',
        entries: COMMENT_DIFF,
        message: 'imports: explain why there is no banner',
        expect: { ok: true, visual: 0 },
    },
    {
        name: 'ESCAPE HATCH: visual change excused with a reason -> PASS, and the escape is COUNTED',
        entries: VISUAL_DIFF,
        message: 'imports: rename a prop\n\nchrome-allow: prop rename only, no rendered output changes',
        expect: { ok: true, visual: 1, records: 0, allows: 1 },
    },
    {
        name: 'ESCAPE HATCH: unreachable-locally reason -> PASS, and the escape is COUNTED',
        entries: VISUAL_DIFF,
        message: 'seats: banner copy\n\nchrome-allow: seat-limit banner needs a SaaS tenant, unreachable standalone',
        expect: { ok: true, allows: 1 },
    },
    {
        name: 'nothing under app/ at all -> PASS, zero visual',
        entries: [{ path: 'server/api/imports.ts', changedLines: ['  return c.json({ ok: true });'] }],
        message: 'imports: return a body',
        expect: { ok: true, visual: 0, underApp: 0 },
    },

    // --- Regressions found by running this gate over real history. Both were
    // bugs in the judge, both were caught by the FIRST report-only run, and
    // neither would have been caught by a suite of hand-written passes.
    {
        name: 'REGRESSION: a TS generic in a .ts file is not a JSX tag -> PASS',
        // `ReturnType<typeof hc<AgentTermsApi>>` in app/lib/api-client.server.ts
        // was reported as user-visible on the first real run.
        entries: [
            {
                path: 'app/lib/api-client.server.ts',
                changedLines: ['    agentTerms: ReturnType<typeof hc<AgentTermsApi>>;', '    agentTerms: mk<AgentTermsApi>(MOUNT.agentTerms),'],
            },
        ],
        message: 'agent: mount the terms client',
        expect: { ok: true, visual: 0 },
    },
    {
        name: 'REGRESSION: a TS generic inside a .tsx is not a JSX tag -> PASS',
        entries: [{ path: 'app/routes/a.tsx', changedLines: ['  const [rows, setRows] = useState<Row>(null);'] }],
        message: 'imports: hold the selected row',
        expect: { ok: true, visual: 0 },
    },
    {
        name: 'POSITIVE CONTROL for that fix: a real JSX tag in a .tsx still counts -> FAIL',
        entries: [{ path: 'app/routes/a.tsx', changedLines: ['  return (<Row label="Imports" />);'] }],
        message: 'imports: render the row',
        expect: { ok: false, visual: 1 },
    },
    {
        name: 'POSITIVE CONTROL: DELETING a rendered component is user-visible -> FAIL',
        // The diff parser dropped every removed line of a deleted file, because
        // a deletion is `+++ /dev/null`. A screen that no longer exists is a
        // change worth looking at.
        entries: [{ path: 'app/components/OldPanel.tsx', changedLines: ['  <div className="panel">Old</div>'] }],
        message: 'imports: retire the old panel',
        expect: { ok: false, visual: 1 },
    },
];

function selfTest() {
    let failures = 0;
    console.log(`chrome-record self-test: ${CASES.length} case(s), positive controls first\n`);
    for (const c of CASES) {
        const r = evaluate({ entries: c.entries, message: c.message });
        const got = { ok: r.ok, ...r.counts };
        const bad = Object.entries(c.expect).filter(([k, v]) => got[k] !== v);
        if (bad.length) {
            failures++;
            console.error(`  ✗ ${c.name}`);
            for (const [k, v] of bad) console.error(`      expected ${k}=${JSON.stringify(v)}, got ${JSON.stringify(got[k])}`);
        } else {
            console.log(`  ✓ ${c.name}`);
        }
    }
    // A suite that ran nothing is not a suite that passed.
    if (CASES.length === 0) {
        console.error('\nchrome-record self-test: ZERO cases ran. The suite is broken, not clean.');
        process.exit(1);
    }
    const controls = CASES.filter((c) => c.name.startsWith('POSITIVE CONTROL')).length;
    console.log(`\nchrome-record self-test: ${CASES.length - failures}/${CASES.length} passed, ${controls} of them positive controls`);
    if (controls === 0) {
        console.error('chrome-record self-test: NO positive control ran. A judge that never fails proves nothing.');
        process.exit(1);
    }
    process.exit(failures === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function reportRange(range) {
    const log = git(['log', '--format=%H', '--no-merges', range]);
    if (!log.ok) {
        console.error(`chrome-record: could not read range ${range} — ${log.why}`);
        process.exit(1);
    }
    const shas = log.out.split(/\r?\n/).filter(Boolean);
    if (shas.length === 0) {
        console.error(`chrome-record: range ${range} holds ZERO commits. Refusing to report a measurement of nothing.`);
        process.exit(1);
    }

    let wouldFail = 0;
    let touchedUi = 0;
    console.log(`chrome-record REPORT-ONLY over ${range} — ${shas.length} commit(s), no enforcement\n`);
    for (const sha of shas) {
        const read = readCommitEntries(sha);
        if (read.error) {
            console.error(`  ! ${sha.slice(0, 8)} unreadable — ${read.error}`);
            process.exit(1); // unreadable input fails closed, even here
        }
        const msgRead = git(['log', '-1', '--format=%B', sha]);
        if (!msgRead.ok) {
            console.error(`  ! ${sha.slice(0, 8)} message unreadable — ${msgRead.why}`);
            process.exit(1);
        }
        const subject = msgRead.out.split(/\r?\n/)[0];
        const r = evaluate({ entries: read.entries, message: msgRead.out });
        if (r.counts.visual > 0) touchedUi++;
        if (!r.ok) {
            wouldFail++;
            const worst = r.judged.visual[0];
            console.log(
                `  FAIL ${sha.slice(0, 8)} ${subject.slice(0, 62)}\n` +
                    `        ${r.counts.visual} visual file(s), first: ${worst ? worst.path : '(none)'}`,
            );
        } else {
            console.log(`  ok   ${sha.slice(0, 8)} ${subject.slice(0, 62)}  (visual ${r.counts.visual}, records ${r.counts.records}, allow ${r.counts.allows})`);
        }
    }
    console.log(
        `\nchrome-record REPORT-ONLY: ${shas.length} commit(s) examined | ${touchedUi} changed a user-visible file ` +
            `| ${wouldFail} WOULD FAIL | ${shas.length - wouldFail} would pass`,
    );
    console.log('History is not baselined — a commit-msg hook only ever sees new commits. This is a count, not a ratchet.');
    process.exit(0);
}

function main() {
    const argv = process.argv.slice(2);
    if (argv.includes('--self-test')) return selfTest();

    const rangeIdx = argv.indexOf('--range');
    if (rangeIdx !== -1) {
        const range = argv[rangeIdx + 1];
        if (!range) {
            console.error('chrome-record: --range needs a rev-range.');
            process.exit(1);
        }
        return reportRange(range);
    }

    const msgPath = argv.find((a) => !a.startsWith('--'));
    if (!msgPath) {
        console.error('chrome-record: no commit-message file given. Usage: check-chrome-record.mjs <COMMIT_EDITMSG> | --self-test | --range <range>');
        process.exit(1);
    }

    let message;
    try {
        message = readFileSync(msgPath, 'utf8');
    } catch (e) {
        // Unreadable input fails closed. A gate that cannot read the thing it
        // judges has no business saying OK.
        console.error(`chrome-record: could not read the commit message at ${msgPath} — ${e.message}. Failing closed.`);
        process.exit(1);
    }
    if (message.trim() === '') {
        console.error('chrome-record: the commit message is EMPTY. Failing closed — git would abort this commit anyway.');
        process.exit(1);
    }

    // Merges do not author UI; their message is generated and there is nothing
    // for a person to have looked at. Skipped, and the skip is printed.
    const mergeHead = spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: ROOT, encoding: 'utf8' });
    if (mergeHead.status === 0) {
        console.log('chrome-record: skipped 1 (merge commit — generated message, no authored UI change)');
        process.exit(0);
    }

    const read = readStagedEntries();
    if (read.error) {
        console.error(`chrome-record: ${read.error}. Failing closed.`);
        process.exit(1);
    }
    if (read.entries.length === 0) {
        // Zero examined is a hard failure, never a pass. A commit-msg hook with
        // an empty staged list is either a `--allow-empty` commit or a reader
        // that has stopped seeing the index, and from in here those look
        // identical. The gate refuses to certify a list it may not be reading.
        console.error(
            'chrome-record: ZERO staged files. Either this is `git commit --allow-empty`, or the staged-file\n' +
                'reader has broken and is reporting an empty repository. Those are indistinguishable from here,\n' +
                'so this fails closed rather than reporting OK on a list it may not be reading.\n' +
                'If the empty commit is intentional, say so:  chrome-allow: intentional empty commit, no files staged',
        );
        const { allows } = parseMessage(message);
        if (allows.length > 0) {
            console.error(`  excused by: ${allows[0].raw}`);
            printCounts(
                { staged: 0, underApp: 0, skipped: 0, visual: 0, records: 0, malformed: 0, allows: allows.length, badAllows: 0 },
                'PASS (escaped)',
            );
            process.exit(0);
        }
        process.exit(1);
    }

    const result = evaluate({ entries: read.entries, message });
    const reportOnly = process.env.CHROME_RECORD_REPORT_ONLY === '1' || argv.includes('--report-only');

    if (result.ok) {
        printCounts(result.counts, result.counts.allows > 0 ? 'PASS (escaped)' : 'PASS');
        process.exit(0);
    }

    printCounts(result.counts, reportOnly ? 'WOULD FAIL (report-only)' : 'FAIL');
    printFailure(result);
    if (reportOnly) {
        console.error('\nchrome-record: CHROME_RECORD_REPORT_ONLY=1 — reporting only, not blocking this commit.');
        process.exit(0);
    }
    process.exit(1);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();

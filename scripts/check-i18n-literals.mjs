#!/usr/bin/env node
/**
 * i18n RAW LITERAL gate — the coverage ratchet the rollout-3 backlog asked for
 * and never got.
 *
 * The extraction sweep moved every user-facing string in `app/` into the message
 * catalogue. Three gates then guarded the catalogue — `check-i18n` (a hardcoded
 * locale passed to a formatter), `check-i18n-catalog` (en <-> es-419 key parity)
 * and `check-i18n-glossary` (term consistency) — and NONE of them reads JSX for
 * an English sentence typed straight into the markup. So the sweep's own stated
 * definition of done ("no user-facing JSX string is a raw literal on covered
 * surfaces") shipped green with nothing enforcing it, and a new hardcoded string
 * has been able to land unnoticed ever since.
 *
 * WHY ZERO AND NOT A BASELINE. The first measurement found 15 candidates in 565
 * files, of which exactly one was a real untranslated string; the rest were this
 * gate's own false positives, since fixed, plus six legitimate exceptions. A
 * ratchet is the right shape when debt is large and must only shrink. Here the
 * debt is gone, so a baseline file would be a list of nothing that still has to
 * be read, and its first job would be to accumulate. Zero, with a named
 * annotation for each real exception, keeps the reason next to the string.
 *
 * WHAT IT FLAGS: a JSX text child that reads as prose — two or more words, at
 * least one of them alphabetic and longer than one letter.
 *
 * WHAT IT DELIBERATELY DOES NOT FLAG, each because the first draft got it wrong:
 *   - anything inside a line or block comment. `>` and `<` are ordinary prose
 *     punctuation in comments, and the naive scan reported eight comments as
 *     untranslated UI.
 *   - TypeScript generics. `Parameters<typeof f>[0]` and `Record<string, x>`
 *     produce a `>...<` span that looks exactly like a JSX text child on a
 *     line-by-line read.
 *   - a single word, an ALL-CAPS token, or anything with no letters: those are
 *     identifiers, units and punctuation, not sentences.
 *
 * ESCAPE HATCH: put `i18n-literal-ok: <reason>` in a comment on the same line or
 * the line above. A reason is REQUIRED — a bare marker is refused, because an
 * exemption nobody has to justify is how the list grows.
 *
 * SELF-TEST: `--self-test` runs the detector over fixtures that must flag and
 * fixtures that must not, and fails if either direction is wrong. A gate that
 * cannot demonstrate it still detects anything is a gate that passes because its
 * scan found no files.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Surfaces the extraction sweep covered. Server-rendered email/PDF templates
 *  are not here: those resolve a locale per recipient and are guarded by the
 *  catalogue gate instead. */
const SCOPE = ['app'];

/** Generated output; the catalogue is the source, these are its compiled form. */
const EXCLUDE_DIRS = ['app/paraglide'];

/**
 * A reason must be a WORD, not merely a non-space character.
 *
 * Two drafts were wrong here and the self-test caught both, which is the whole
 * argument for having one.
 *
 * Asking for one non-space character passed a marker with NO reason, because the
 * next non-space character inside a JSX comment is the star that closes it. That
 * is precisely the failure this gate exists to prevent one level down: an
 * exemption nobody had to justify.
 *
 * Then asking for three letters immediately after the colon rejected a perfectly
 * good reason, because "a shell command" starts with a one-letter word. So the
 * rule is a three-letter word SOMEWHERE on the rest of the line.
 */
const ANNOTATION = /i18n-literal-ok:[^\n]*[A-Za-z]{3,}/;

/**
 * Whole-file exemption, for a component whose every string is sample data.
 * Separate from the per-line form on purpose: a file-level marker is a much
 * bigger claim, so it reads differently in a diff and is easy to grep for.
 * Still requires a reason.
 */
const FILE_ANNOTATION = /i18n-literals-ok-file:[^\n]*[A-Za-z]{3,}/;

/**
 * Remove comments before scanning, so prose punctuation inside them cannot read
 * as markup. Block comments are replaced with newlines rather than deleted, to
 * keep line numbers truthful in the report.
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  let state = 'code';
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (state === 'code') {
      if (two === '/*') { state = 'block'; i += 2; continue; }
      if (two === '//') { state = 'line'; i += 2; continue; }
      if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
        const quote = src[i];
        out += src[i];
        i += 1;
        while (i < src.length && src[i] !== quote) {
          if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
          out += src[i];
          i += 1;
        }
        out += src[i] ?? '';
        i += 1;
        continue;
      }
      out += src[i];
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (two === '*/') { state = 'code'; i += 2; continue; }
      out += src[i] === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    // line comment
    if (src[i] === '\n') { state = 'code'; out += '\n'; i += 1; continue; }
    out += ' ';
    i += 1;
  }
  return out;
}

/** Two or more words, at least one a real alphabetic word of 2+ letters. */
const PROSE = /[A-Za-z]{2,}\s+\S/;

/**
 * A `>...<` span that is a TypeScript generic rather than a JSX text child.
 * Generics close onto an identifier, a bracket or a call; JSX text does not.
 */
const LOOKS_LIKE_CODE =
  /(=>|\bas\b|\btypeof\b|\bkeyof\b|\bextends\b|[[\]{}()]|::|\|\||&&|;\s*$)/;

export function findRawLiterals(src, filename) {
  if (FILE_ANNOTATION.test(src)) return [];
  const stripped = stripComments(src);
  const rawLines = src.split('\n');
  const lines = stripped.split('\n');
  const out = [];
  lines.forEach((line, idx) => {
    // Look back three lines, not one: a reason worth writing rarely fits on
    // the same line as the markup it explains.
    const window = rawLines.slice(Math.max(0, idx - 3), idx + 1).join('\n');
    if (ANNOTATION.test(window)) return;
    const re = />([^<>{}\n]{4,})</g;
    let m;
    while ((m = re.exec(line))) {
      const text = m[1].trim();
      if (!PROSE.test(text)) continue;
      if (/^[A-Z0-9_ .·—-]+$/.test(text)) continue;
      if (LOOKS_LIKE_CODE.test(text)) continue;
      out.push({ file: filename, line: idx + 1, text });
    }
  });
  return out;
}

function collect(path, out = []) {
  let s;
  try { s = statSync(path); } catch { return out; }
  const norm = path.replace(/\\/g, '/');
  if (EXCLUDE_DIRS.some((d) => norm === d || norm.startsWith(d + '/'))) return out;
  if (s.isFile()) {
    if (!/\.tsx$/.test(path)) return out;
    if (/\.(test|spec)\.tsx$/.test(path)) return out;
    out.push(norm);
    return out;
  }
  for (const e of readdirSync(path)) collect(join(path, e), out);
  return out;
}

/* ---------------------------------------------------------------- self-test */

const MUST_FLAG = [
  ['plain sentence', '<p>Your report is ready to send.</p>'],
  ['sentence in a nested element', '<div><span>Nothing has been emailed yet</span></div>'],
];

const MUST_NOT_FLAG = [
  ['line comment containing markup-ish prose', '// a -> b and x < y > z is fine here now'],
  ['block comment spanning lines', '/*\n * Compare a > b rather than a < b when sorting.\n */'],
  ['typescript generic', 'const f = x as Parameters<typeof g>[0];'],
  ['record generic', 'const d = (await res.json()) as Record<string, unknown>;'],
  ['single word child', '<span>Cancel</span>'],
  ['all caps token', '<span>TOTAL REVENUE</span>'],
  ['interpolated message call', '<p>{m.report_publish_body_delivery()}</p>'],
  ['annotated exception', '<p>npm run agent-terms:publish</p> {/* i18n-literal-ok: a shell command */}'],
  ['annotation three lines above', '{/* i18n-literal-ok: a shell command */}\n\n\n<p>npm run agent-terms:publish</p>'],
  ['whole-file exemption', '// i18n-literals-ok-file: every string here is sample data\n<p>Several shingles missing on the SE slope.</p>'],
];

/** A bare marker with no reason must NOT exempt anything. */
const MUST_FLAG_UNREASONED = [
  ['bare per-line marker', '<p>Your report is ready.</p> {/* i18n-literal-ok: */}'],
  ['bare file marker', '// i18n-literals-ok-file:\n<p>Your report is ready.</p>'],
];

function selfTest() {
  let wrong = 0;
  for (const [name, src] of MUST_FLAG) {
    if (findRawLiterals(src, 'fixture.tsx').length === 0) {
      console.error(`  self-test MISS  (should flag) ${name}`);
      wrong += 1;
    }
  }
  for (const [name, src] of MUST_FLAG_UNREASONED) {
    if (findRawLiterals(src, 'fixture.tsx').length === 0) {
      console.error(`  self-test MISS  (marker with no reason must not exempt) ${name}`);
      wrong += 1;
    }
  }
  for (const [name, src] of MUST_NOT_FLAG) {
    const hits = findRawLiterals(src, 'fixture.tsx');
    if (hits.length > 0) {
      console.error(`  self-test FALSE POSITIVE ${name} -> ${JSON.stringify(hits[0].text)}`);
      wrong += 1;
    }
  }
  const total = MUST_FLAG.length + MUST_FLAG_UNREASONED.length + MUST_NOT_FLAG.length;
  console.log(`  self-test: ${total} fixture(s), ${wrong} wrong (${MUST_FLAG.length + MUST_FLAG_UNREASONED.length} must-flag, ${MUST_NOT_FLAG.length} must-not-flag)`);
  return wrong;
}

/* ---------------------------------------------------------------------- CLI */

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const wrong = selfTest();
  if (wrong > 0) {
    console.error('\ni18n raw-literal gate FAILED its own self-test — the detector is broken, so a clean scan below would mean nothing.');
    process.exit(1);
  }
  if (process.argv.includes('--self-test')) process.exit(0);

  const files = SCOPE.flatMap((s) => collect(s));
  // Zero files scanned is a broken scan, not a clean repo. Say so.
  if (files.length === 0) {
    console.error('i18n raw-literal gate FAILED: scanned 0 files. The scope is wrong or the walk is broken.');
    process.exit(1);
  }
  const hits = files.flatMap((f) => findRawLiterals(readFileSync(f, 'utf8'), f));
  // Count BOTH exemption kinds. The first version counted only the per-line form
  // and reported one exemption while two files were exempt — a gate that
  // under-reports its own escape hatches is the shape it exists to prevent.
  let perLine = 0;
  let wholeFile = 0;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    perLine += (src.match(/i18n-literal-ok:/g) ?? []).length;
    if (FILE_ANNOTATION.test(src)) wholeFile += 1;
  }

  if (hits.length) {
    console.error(
      `i18n raw-literal gate FAILED — ${hits.length} untranslated string(s) in ${files.length} scanned file(s):\n` +
        hits.map((h) => `  ${h.file}:${h.line}  ${JSON.stringify(h.text)}`).join('\n') +
        `\n\n  Move the text into messages/en/ (and messages/es-419/) and render it through` +
        `\n  \`m.<key>()\`, or annotate the line \`i18n-literal-ok: <reason>\` if it must not be` +
        `\n  translated (a shell command, a sample value in a style preview, a proper noun).`,
    );
    process.exit(1);
  }
  console.log(
    `i18n raw-literal gate OK — ${files.length} file(s) scanned, ${hits.length} raw literal(s), ` +
      `${perLine} per-line exemption(s), ${wholeFile} whole-file exemption(s). Every number is ` +
      `printed on purpose: a zero that comes from scanning nothing is not a pass, and an escape ` +
      `hatch nobody counts is one nobody reviews.`,
  );
}

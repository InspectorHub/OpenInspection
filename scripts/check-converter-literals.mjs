#!/usr/bin/env node
/**
 * Every string a converter embeds is CLASSIFIED, or this fails.
 *
 * ── Why this is a gate and not a review habit ───────────────────────────────
 * A converter reads somebody else's file, and the strings it holds are the one
 * place that somebody else's expression could end up in this repository. Four
 * classifications are permitted, and a literal that is none of them has no
 * standing at all — there is nothing to fall back on. A habit catches that on
 * the days somebody remembers; a gate catches it on the day they are pasting a
 * column list out of a real export at four in the afternoon.
 *
 * ── What it checks ──────────────────────────────────────────────────────────
 *  A. Every module-level DECLARATION holding string literals — a `const` or a
 *     string-union `type` — must carry a classification directly above it.
 *     That is where an embedded vocabulary lives, and where a pasted list is
 *     most natural to put.
 *  B. Every literal MATCHED AGAINST file content — `=== '…'`, `.includes('…')`,
 *     `.startsWith('…')`, `.endsWith('…')` — must be covered: either it is a
 *     value of a classified declaration in the same file, or the line carries
 *     its own classification. A discriminator inlined at its use site is still
 *     a discriminator, and it is the form that escapes review.
 *
 * ⚠️ NO LENGTH RULE. "Shorter than N characters is safe" was put to review and
 * rejected in as many words: length is not the test. This gate classifies; it
 * does not measure. The one exemption is by NAME — the eight answers `typeof`
 * can give — because a JavaScript type name is not anybody's expression.
 *
 *   node scripts/check-converter-literals.mjs
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();

/** Where converters live. Both directories, because a discriminator lives in either. */
const SCANNED = [
  'server/lib/migration-intake/adapters',
  'server/lib/migration-intake/formats',
];

/** The only four classifications there are. */
const CATEGORIES = [
  'format discriminator',
  'required enum',
  'public standard value',
  'independently authored',
];

const MARKER = /literal[- ]use(?:\s+classification)?\s*:?/i;

/** A literal carrying no expression at all, which can classify nothing. */
const EMPTY = /^['"]{2}$/;

const STRING = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g;

const COMPARISON = /(?:[=!]==\s*|\.(?:includes|startsWith|endsWith)\(\s*)('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;

/** The eight things `typeof` can answer. Not content, and not anybody's expression. */
const JS_TYPEOF = /^['"](string|number|bigint|boolean|symbol|undefined|object|function)['"]$/;

const DECLARATION = /^(?:export\s+)?(?:const|type)\s+[A-Za-z_$][\w$]*/;

function sourceFiles() {
  const out = [];
  for (const dir of SCANNED) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(join(abs, name));
    }
  }
  return out;
}

/**
 * The source with every comment blanked to spaces of the SAME LENGTH.
 *
 * Same length so line and column numbers still mean what they meant. A gate
 * that names the wrong line sends people to read code that is fine, and the
 * second time that happens they stop reading the gate.
 */
function blankComments(source) {
  const out = source.split('');
  let i = 0;
  let inString = null;
  while (i < source.length) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inString) inString = null;
      i += 1;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { inString = ch; i += 1; continue; }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') { out[i] = ' '; i += 1; }
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      if (i < source.length) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/** Which category a comment names, `false` when marked but unnamed, `null` when unmarked. */
function categoryIn(text) {
  const lowered = text.toLowerCase();
  if (!MARKER.test(lowered)) return null;
  return CATEGORIES.find((c) => lowered.includes(c)) ?? false;
}

/**
 * The classification attached to line `n` — on the line itself, or in the
 * comment block directly above it.
 *
 * Read UPWARDS through CONTIGUOUS comment lines only. A classification
 * separated from its declaration by a blank line is not attached to it, and
 * treating it as attached is how one annotation comes to cover the six things
 * underneath it.
 */
function classificationAt(rawLines, n, claimed) {
  const own = categoryIn(rawLines[n] ?? '');
  if (own !== null) return own;
  const collected = [];
  let start = n;
  for (let i = n - 1; i >= 0; i--) {
    const line = (rawLines[i] ?? '').trim();
    const isComment = line.startsWith('*') || line.startsWith('//')
      || line.startsWith('/*') || line === '*/';
    if (!isComment) break;
    collected.unshift(line);
    start = i;
  }
  const verdict = categoryIn(collected.join(' '));
  if (verdict === null) return null;
  // ⚠️ ONE comment block classifies ONE declaration. Without this, pasting a
  // vocabulary directly beneath an existing annotation inherits it — the gate
  // still goes red, but it names the innocent declaration underneath and the
  // person reading it goes and looks at code that is fine.
  if (claimed) {
    if (claimed.has(start)) return 'taken';
    claimed.add(start);
  }
  return verdict;
}

function literalsIn(text) {
  STRING.lastIndex = 0;
  return [...text.matchAll(STRING)].map((m) => m[0]).filter((lit) => !EMPTY.test(lit));
}

const files = sourceFiles();
const violations = [];
let declarationsClassified = 0;
let literalsSeen = 0;
let literalsCovered = 0;

/**
 * Words classified as OURS, anywhere in the converter layer.
 *
 * Only `independently authored` travels between files, and the asymmetry is
 * deliberate. Our own vocabulary genuinely recurs — the entity kinds and
 * mapping kinds are matched in several modules — while a vendor's discriminator
 * belongs to the one reader that matches it, and a paste of it into a second
 * file should have to be classified again where it lands.
 */
const OURS = new Set();
for (const file of files) {
  const code = blankComments(readFileSync(file, 'utf8'));
  const codeLines = code.split('\n');
  const rawLines = readFileSync(file, 'utf8').split('\n');
  for (let n = 0; n < codeLines.length; n++) {
    if (!DECLARATION.test(codeLines[n])) continue;
    let declaration = codeLines[n];
    let end = n;
    while (!/;\s*$/.test(declaration) && end + 1 < codeLines.length && end - n < 80) {
      end += 1;
      declaration += `\n${codeLines[end]}`;
    }
    if (classificationAt(rawLines, n, null) === 'independently authored') {
      for (const lit of literalsIn(declaration)) OURS.add(lit.slice(1, -1));
    }
    n = end;
  }
}

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const code = blankComments(source);
  const codeLines = code.split('\n');
  const rawLines = source.split('\n');
  const where = (n) => `${relative(root, file).replace(/\\/g, '/')}:${n + 1}`;

  // ── Pass one: the declarations, and what they cover ──────────────────────
  //
  // Covering matters as much as flagging. A literal repeated at a use site is
  // the SAME literal, and asking for it to be classified twice teaches people
  // to paste the annotation — which is how a gate stops being read.
  const covered = new Set();
  const declaredAt = new Set();
  const claimed = new Set();
  for (let n = 0; n < codeLines.length; n++) {
    if (!DECLARATION.test(codeLines[n])) continue;
    let declaration = codeLines[n];
    let end = n;
    while (!/;\s*$/.test(declaration) && end + 1 < codeLines.length && end - n < 80) {
      end += 1;
      declaration += `\n${codeLines[end]}`;
    }
    const found = literalsIn(declaration);
    for (let i = n; i <= end; i++) declaredAt.add(i);
    if (found.length === 0) { n = end; continue; }
    literalsSeen += found.length;
    const verdict = classificationAt(rawLines, n);
    if (verdict === null) {
      violations.push(`  ✘ ${where(n)} — ${codeLines[n].trim().slice(0, 62)}\n`
        + '      holds a string and carries no LITERAL-USE CLASSIFICATION.\n'
        + '      (If a declaration was just inserted directly ABOVE this one, that one took\n'
        + '      the annotation and is the line to look at.)');
    } else if (verdict === false) {
      violations.push(`  ✘ ${where(n)} — ${codeLines[n].trim().slice(0, 62)}\n`
        + `      is marked but names no category. One of: ${CATEGORIES.join(' · ')}.`);
    } else {
      declarationsClassified += 1;
      literalsCovered += found.length;
      for (const lit of found) covered.add(lit.slice(1, -1));
    }
    n = end;
  }

  // ── Pass two: literals matched against file content ──────────────────────
  for (let n = 0; n < codeLines.length; n++) {
    if (declaredAt.has(n)) continue;
    COMPARISON.lastIndex = 0;
    for (const match of codeLines[n].matchAll(COMPARISON)) {
      const literal = match[1];
      if (EMPTY.test(literal)) continue;
      if (JS_TYPEOF.test(literal) && /\btypeof\b/.test(codeLines[n].slice(0, match.index))) continue;
      literalsSeen += 1;
      const value = literal.slice(1, -1);
      if (covered.has(value) || OURS.has(value)) { literalsCovered += 1; continue; }
      const verdict = classificationAt(rawLines, n, null);
      if (verdict === null || verdict === false) {
        violations.push(`  ✘ ${where(n)} — ${literal} is matched against file content\n`
          + '      and is neither a value of a classified declaration in this file nor\n'
          + '      annotated here. Hoist it into a classified constant, or classify the line.');
      } else {
        literalsCovered += 1;
      }
    }
  }
}

// Both numbers, side by side, on every run. A gate that prints only its verdict
// cannot be checked on the day it is green for the wrong reason.
console.log(`Converter literals — scanned ${files.length} file(s) across `
  + `${SCANNED.length} director(ies): ${SCANNED.join(', ')}`);
console.log(`  ${literalsSeen} literal(s) in classifiable positions · `
  + `${literalsCovered} covered · ${violations.length} unclassified · `
  + `${declarationsClassified} classified declaration(s)`);

if (files.length === 0) {
  console.log('✘ Scanned 0 files, so this run proves nothing. Check the scanned paths above.');
  process.exit(1);
}

if (literalsSeen === 0) {
  console.log('✘ Found 0 literals in classifiable positions across a non-empty file set.');
  console.log('  A converter with no strings at all does not exist; the matcher is broken.');
  process.exit(1);
}

if (violations.length) {
  console.log(`\n✘ Converter-literal gate — ${violations.length} unclassified literal(s):`);
  console.log(violations.join('\n'));
  console.log('\n  Every embedded string must be one of:');
  for (const c of CATEGORIES) console.log(`    · ${c}`);
  console.log('  Say which, in a comment directly above. There is no length exemption.');
  process.exit(1);
}

console.log('✅ Converter-literal gate — every embedded string is classified.');
process.exit(0);

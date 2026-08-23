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
 * ── What the corpus IS ─────────────────────────────────────────────────────
 * Every `.ts` UNDER the two scanned directories, walked recursively, named one
 * per line on every run. Recursively because a converter written by hand is the
 * one most likely to be long, and therefore the one most likely to be split
 * into a folder — which the one-level walk this replaces never looked inside.
 *
 * ⚠️ It reads SOURCE. A conversion performed by a PERSON reading the original
 * file and writing the mapping out by hand is the case that most needs this
 * check — transcribing the section names and rating words in front of you is
 * the natural thing to do, and a parser has no such temptation — but it is only
 * in scope once that work lands here AS CODE. A conversion delivered as DATA,
 * a bundle uploaded through the delivery route, embeds no literals in this
 * repository, and this gate is silent about it by construction rather than by
 * omission. Do not read a pass here as a statement about one.
 *
 *   node scripts/check-converter-literals.mjs
 *   node scripts/check-converter-literals.mjs --self-test
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

/** Where converters live. Both directories, because a discriminator lives in either. */
const SCANNED = [
  'server/lib/migration-intake/adapters',
  'server/lib/migration-intake/formats',
];

/**
 * The three filesystem calls this gate makes, behind one object.
 *
 * Injected rather than imported at the use site so the self-test can drive the
 * whole check over a tree it describes in a literal — including the two shapes
 * a real filesystem cannot be asked to produce on demand on every machine this
 * runs on: a named directory that is not there, and a file that refuses to be
 * read. A fail-closed branch nobody has ever executed is a comment.
 */
const realFs = {
  existsSync,
  readdirSync: (p) => readdirSync(p, { withFileTypes: true }),
  readFileSync: (p) => readFileSync(p, 'utf8'),
};

/** A path relative to the tree root, in one spelling on every platform. */
const rel = (base, file) => file.replace(/\\/g, '/').slice(base.replace(/\\/g, '/').length + 1);

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

/**
 * Every `.ts` UNDER the scanned directories, what was passed over, and which
 * named directory was not there at all.
 *
 * ⚠️ RECURSIVE, and that is the whole point of this function. The walk used to
 * read one level, so a converter split across a folder —
 * `adapters/<vendor>/sections.ts` — was never examined while the gate went on
 * printing a pass over the files it could still see. A hand-written converter
 * is the likeliest one to be split, because it is the likeliest one to be long.
 * The corpus therefore has to mean "under here", never "directly in here".
 *
 * A missing named directory is a FAILURE rather than a skip: renaming the
 * adapter folder would otherwise leave a green run over whatever directories
 * happened to survive, and the count printed above it would be the only clue.
 */
function sourceFiles(base, fs) {
  const files = [];
  const skipped = [];
  const missing = [];
  const walk = (abs) => {
    for (const entry of fs.readdirSync(abs)) {
      const full = join(abs, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) files.push(full);
      else skipped.push(full);
    }
  };
  for (const dir of SCANNED) {
    const abs = join(base, dir);
    if (!fs.existsSync(abs)) { missing.push(dir); continue; }
    walk(abs);
  }
  return { files, skipped, missing };
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

/**
 * The whole check, over ONE tree, with the filesystem injected.
 *
 * Returns rather than exits, so the self-test can run the real code path
 * instead of a re-implementation of it that agrees with whoever wrote it.
 */
function analyse(base, fs) {
  const { files, skipped, missing } = sourceFiles(base, fs);
  const violations = [];
  const perFile = [];
  let declarationsClassified = 0;
  let literalsSeen = 0;
  let literalsCovered = 0;

  // Read ONCE, up front, so an unreadable file is reported once rather than by
  // every pass that touches it — and so it is reported at all. Fail closed: a
  // file nobody could read is not a file whose literals are classified.
  const sources = [];
  for (const file of files) {
    try {
      sources.push({ file, source: fs.readFileSync(file) });
    } catch (err) {
      violations.push(`  ✘ ${rel(base, file)} could not be read (${err.code ?? err.message}).\n`
        + '      An unread file is not a classified file. This is a failure, not a skip.');
    }
  }

  /**
   * Words classified as OURS, anywhere in the converter layer.
   *
   * Only `independently authored` travels between files, and the asymmetry is
   * deliberate. Our own vocabulary genuinely recurs — the entity kinds and
   * mapping kinds are matched in several modules — while a vendor's
   * discriminator belongs to the one reader that matches it, and a paste of it
   * into a second file should have to be classified again where it lands.
   */
  const OURS = new Set();
  for (const { source } of sources) {
    const codeLines = blankComments(source).split('\n');
    const rawLines = source.split('\n');
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

  for (const { file, source } of sources) {
    const code = blankComments(source);
    const codeLines = code.split('\n');
    const rawLines = source.split('\n');
    const path = rel(base, file);
    const where = (n) => `${path}:${n + 1}`;
    const before = violations.length;
    let fileLiterals = 0;
    let fileDeclarations = 0;

    // ── Pass one: the declarations, and what they cover ────────────────────
    //
    // Covering matters as much as flagging. A literal repeated at a use site is
    // the SAME literal, and asking for it to be classified twice teaches people
    // to paste the annotation — which is how a gate stops being read.
    const covered = new Set();
    const declaredAt = new Set();
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
      fileLiterals += found.length;
      const outcome = classificationAt(rawLines, n, null);
      if (outcome === null) {
        violations.push(`  ✘ ${where(n)} — ${codeLines[n].trim().slice(0, 62)}\n`
          + '      holds a string and carries no LITERAL-USE CLASSIFICATION.\n'
          + '      (If a declaration was just inserted directly ABOVE this one, that one took\n'
          + '      the annotation and is the line to look at.)');
      } else if (outcome === false) {
        violations.push(`  ✘ ${where(n)} — ${codeLines[n].trim().slice(0, 62)}\n`
          + `      is marked but names no category. One of: ${CATEGORIES.join(' · ')}.`);
      } else {
        declarationsClassified += 1;
        fileDeclarations += 1;
        literalsCovered += found.length;
        for (const lit of found) covered.add(lit.slice(1, -1));
      }
      n = end;
    }

    // ── Pass two: literals matched against file content ────────────────────
    for (let n = 0; n < codeLines.length; n++) {
      if (declaredAt.has(n)) continue;
      COMPARISON.lastIndex = 0;
      for (const match of codeLines[n].matchAll(COMPARISON)) {
        const literal = match[1];
        if (EMPTY.test(literal)) continue;
        if (JS_TYPEOF.test(literal) && /\btypeof\b/.test(codeLines[n].slice(0, match.index))) continue;
        literalsSeen += 1;
        fileLiterals += 1;
        const value = literal.slice(1, -1);
        if (covered.has(value) || OURS.has(value)) { literalsCovered += 1; continue; }
        const outcome = classificationAt(rawLines, n, null);
        if (outcome === null || outcome === false) {
          violations.push(`  ✘ ${where(n)} — ${literal} is matched against file content\n`
            + '      and is neither a value of a classified declaration in this file nor\n'
            + '      annotated here. Hoist it into a classified constant, or classify the line.');
        } else {
          literalsCovered += 1;
        }
      }
    }

    perFile.push(`  · ${path} — ${fileLiterals} literal(s), `
      + `${fileDeclarations} classified declaration(s), `
      + `${violations.length - before} unclassified`);
  }

  return {
    files, skipped, missing, perFile, violations,
    literalsSeen, literalsCovered, declarationsClassified,
  };
}

/**
 * Every number, every run — the files by NAME, not only their count.
 *
 * The count alone is what let a converter hide in a subdirectory: nine was the
 * right answer on the day it was written and stayed printed afterwards, and
 * nobody diffs a number. Names make a corpus that has quietly shrunk visible in
 * the output of the run that is still green.
 */
function report(base, result) {
  console.log(`Converter literals — ${result.files.length} file(s) examined under `
    + `${SCANNED.length} named director(ies), walked recursively: ${SCANNED.join(', ')}`);
  for (const row of result.perFile) console.log(row);
  console.log(`  ${result.skipped.length} file(s) skipped as not .ts source`
    + (result.skipped.length ? `: ${result.skipped.map((f) => rel(base, f)).join(', ')}` : ''));
  console.log(`  ${result.literalsSeen} literal(s) in classifiable positions · `
    + `${result.literalsCovered} covered · ${result.violations.length} unclassified · `
    + `${result.declarationsClassified} classified declaration(s)`);
}

/** Why this result fails, as sentences, or an empty list when it does not. */
function verdict(result) {
  const out = [];
  if (result.missing.length) {
    out.push(`✘ ${result.missing.length} named director(ies) not found: ${result.missing.join(', ')}.`);
    out.push('  A directory that moved is a corpus that shrank silently. Fail, never skip.');
  }
  if (result.files.length === 0) {
    out.push('✘ Examined 0 files, so this run proves nothing. Check the scanned paths above.');
  } else if (result.literalsSeen === 0) {
    out.push('✘ Found 0 literals in classifiable positions across a non-empty file set.');
    out.push('  A converter with no strings at all does not exist; the matcher is broken.');
  }
  if (result.violations.length) {
    out.push(`\n✘ Converter-literal gate — ${result.violations.length} problem(s):`);
    out.push(result.violations.join('\n'));
    out.push('\n  Every embedded string must be one of:');
    for (const c of CATEGORIES) out.push(`    · ${c}`);
    out.push('  Say which, in a comment directly above. There is no length exemption:');
    out.push('  the question is which of the four a literal IS, never how long it is.');
  }
  return out;
}

/** A tree described in a literal, behind the same three calls as a real one. */
const UNREADABLE = Symbol('unreadable');
function virtualFs(tree) {
  const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const paths = Object.keys(tree);
  return {
    existsSync: (p) => paths.some((f) => f === norm(p) || f.startsWith(`${norm(p)}/`)),
    readdirSync: (p) => {
      const prefix = `${norm(p)}/`;
      const names = new Set();
      for (const f of paths) {
        if (!f.startsWith(prefix)) continue;
        const rest = f.slice(prefix.length);
        const cut = rest.indexOf('/');
        names.add(cut === -1 ? rest : rest.slice(0, cut));
      }
      return [...names].map((name) => ({
        name,
        isDirectory: () => paths.some((f) => f.startsWith(`${prefix}${name}/`)),
      }));
    },
    readFileSync: (p) => {
      const content = tree[norm(p)];
      if (content === UNREADABLE) {
        const err = new Error('permission denied');
        err.code = 'EACCES';
        throw err;
      }
      return content;
    },
  };
}

const ADAPTERS = SCANNED[0];
const FORMATS = SCANNED[1];

/** A file whose one literal is annotated. The shape that must NOT fire. */
const CLASSIFIED = `/** ⚠️ LITERAL-USE CLASSIFICATION: FORMAT DISCRIMINATOR. The container entry a
 *  reader opens to find anything at all. */
const ENTRY = 'structure.json';
export { ENTRY };
`;

/**
 * A vocabulary that appears ONLY in prose.
 *
 * Saying that something is deliberately NOT reproduced requires writing it
 * down, so a negative sentence is the shape most likely to trip a gate that
 * greps content. Comments are blanked before anything is matched; this case
 * exists so that stays true.
 */
const PROSE_ONLY = `/**
 * ⚠️ We deliberately do NOT reproduce the section list another product ships.
 * Words like 'Roof' and 'Exterior' stay in the product that wrote them; this
 * reader locates sections positionally instead.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: FORMAT DISCRIMINATOR. The container entry.
 */
const ENTRY = 'structure.json';
export { ENTRY };
`;

/** A vocabulary transcribed straight out of somebody's file. Must fire. */
const PASTED = "const SECTIONS = ['Roof', 'Exterior', 'Grounds'];\n"
  + "const RATINGS = ['Acceptable', 'Marginal', 'Defective'];\n"
  + 'export { SECTIONS, RATINGS };\n';

/**
 * Two-way self-test, POSITIVE CONTROLS FIRST.
 *
 * A gate is only trustworthy in the direction it has been SEEN to fire, so the
 * cases that must fail come first. The negative controls follow them because
 * without those a gate that failed on everything would look exactly like a
 * working one.
 */
function selfTest() {
  const cases = [
    ['POSITIVE — pasted vocabulary in a top-level adapter', 'fail',
      { [`/t/${ADAPTERS}/vendor.ts`]: PASTED, [`/t/${FORMATS}/keep.ts`]: CLASSIFIED }],
    ['POSITIVE — pasted vocabulary in an adapter SUBDIRECTORY', 'fail',
      { [`/t/${ADAPTERS}/ok.ts`]: CLASSIFIED, [`/t/${ADAPTERS}/vendor/sections.ts`]: PASTED,
        [`/t/${FORMATS}/keep.ts`]: CLASSIFIED }],
    ['POSITIVE — a named directory is missing', 'fail',
      { [`/t/${ADAPTERS}/ok.ts`]: CLASSIFIED }],
    ['POSITIVE — a file cannot be read', 'fail',
      { [`/t/${ADAPTERS}/ok.ts`]: CLASSIFIED, [`/t/${ADAPTERS}/locked.ts`]: UNREADABLE,
        [`/t/${FORMATS}/keep.ts`]: CLASSIFIED }],
    ['POSITIVE — marked, but naming none of the four categories', 'fail',
      { [`/t/${ADAPTERS}/vendor.ts`]: "/** LITERAL-USE: it is fine. */\nconst E = 'x.json';\n",
        [`/t/${FORMATS}/keep.ts`]: CLASSIFIED }],
    ['POSITIVE — nothing to examine at all', 'fail',
      { [`/t/${ADAPTERS}/.keep`]: '', [`/t/${FORMATS}/.keep`]: '' }],
    ['NEGATIVE — classified at the top level AND in a subdirectory', 'pass',
      { [`/t/${ADAPTERS}/ok.ts`]: CLASSIFIED, [`/t/${ADAPTERS}/vendor/ok.ts`]: CLASSIFIED,
        [`/t/${FORMATS}/keep.ts`]: CLASSIFIED }],
    ['NEGATIVE — the vocabulary appears only in prose', 'pass',
      { [`/t/${ADAPTERS}/ok.ts`]: PROSE_ONLY, [`/t/${FORMATS}/keep.ts`]: CLASSIFIED }],
  ];

  const wrong = [];
  for (const [name, expected, tree] of cases) {
    const got = verdict(analyse('/t', virtualFs(tree))).length ? 'fail' : 'pass';
    if (got !== expected) wrong.push(`  ✘ self-test "${name}": expected ${expected}, got ${got}`);
  }
  const positives = cases.filter((c) => c[1] === 'fail').length;
  console.log(`  self-test: ${cases.length} case(s) — ${positives} positive control(s) first, `
    + `${cases.length - positives} negative · ${wrong.length} wrong`);
  for (const line of wrong) console.log(line);
  return wrong.length === 0;
}

const selfTestPassed = selfTest();
if (process.argv.includes('--self-test')) process.exit(selfTestPassed ? 0 : 1);
if (!selfTestPassed) {
  console.log('\n✘ Converter-literal gate: its own self-test failed. Fix it before trusting it.');
  process.exit(1);
}

const result = analyse(root, realFs);
report(root, result);
const problems = verdict(result);
if (problems.length) {
  console.log(problems.join('\n'));
  process.exit(1);
}

console.log('✅ Converter-literal gate — every embedded string is classified.');
console.log('   ⚠️ It reads SOURCE, and only source. A conversion delivered as DATA — a');
console.log('      bundle somebody converted by hand and uploaded — embeds no literals');
console.log('      here, so this gate says nothing at all about one.');
process.exit(0);

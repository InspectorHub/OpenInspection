#!/usr/bin/env node
/**
 * Sample vendor files, generated from a schema WE authored.
 *
 * ── Why generated ───────────────────────────────────────────────────────────
 * Nothing derived from a real customer's or a real publisher's file may enter
 * this repository. A checked-in sample export is derived from one whatever is
 * redacted out of it. So the shape and the surprises are declared in
 * `tests/fixtures/intake/<vendor>.schema.json` — which is ours — and the
 * CONTENT of every file this produces is invented here.
 *
 * ── Why one case per quirk ──────────────────────────────────────────────────
 * A quirk nothing generates is documentation. `generateCases` produces exactly
 * one case per declared quirk and THROWS on a quirk it does not know how to
 * produce, so adding a line to a schema without teaching the generator fails
 * loudly instead of quietly widening the claim the schema makes.
 *
 *   node scripts/generate-intake-fixture.mjs                 # write every case
 *   node scripts/generate-intake-fixture.mjs --out <dir>     # write them somewhere
 *
 * Written files are for eyeballing and for feeding to other tools; the specs
 * call the exported functions directly and never touch the disk.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = join(HERE, '..', 'tests', 'fixtures', 'intake');

/** Invented content. Not a redaction of anything — there was no original. */
const MADE_UP = {
  parents: ['Alpha Area', 'Bravo Area'],
  children: ['First Thing', 'Second Thing'],
  entryNames: ['Note One', 'Note Two', 'Note Three'],
  entryText: 'A sentence that says nothing about any real property.',
  vocabulary: [' Padded Start', 'Middle', 'Padded End '],
  templateName: 'Generated Sample Template',
};

export function readSchema(vendor) {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, `${vendor}.schema.json`), 'utf8'));
}

export function readManifest() {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, 'manifest.json'), 'utf8'));
}

// ── zip writing ─────────────────────────────────────────────────────────────
// Written here rather than reused from the test helper because this script is
// the shipped generator and must not depend on test infrastructure. Both are
// STORED-entry writers: the readers handle both methods, and uncompressed bytes
// keep a generated sample legible to somebody checking what it contains.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipOf(entries) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  let centralSize = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = enc.encode(name);
    const body = enc.encode(text);
    const crc = crc32(body);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(12, 0x21, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, body.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    locals.push(local, body);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, body.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);
    centralSize += central.length;
    offset += local.length + body.length;
  }
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, eocd];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// ── the spreadsheet format ──────────────────────────────────────────────────

function worksheet(rows, { sparse = false } = {}) {
  const cells = (row, rowNumber) => row.map((value, column) => {
    // A sparse row omits an empty cell entirely rather than writing one, which
    // is what makes position in the row useless for finding a column.
    if (sparse && value === '') return '';
    const address = `${String.fromCharCode(65 + column)}${rowNumber}`;
    return `<c r="${address}" t="str"><v>${value}</v></c>`;
  }).join('');
  const body = rows.map((row, i) => `<row r="${i + 1}">${cells(row, i + 1)}</row>`).join('');
  return `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`;
}

function spectoraRows(schema, { type = 'info', escapedTwice = false } = {}) {
  const parent = escapedTwice
    // `&amp;amp;` in the file. One decode leaves `&amp;` where `&` belongs.
    ? `${MADE_UP.parents[0]} &amp;amp; More`
    : MADE_UP.parents[0];
  return [
    schema.sheet.headings,
    [parent, MADE_UP.children[0], MADE_UP.entryNames[0], MADE_UP.entryText, type],
    [parent, MADE_UP.children[1], MADE_UP.entryNames[1], MADE_UP.entryText, 'defect'],
  ];
}

const SPECTORA_CASES = {
  'empty-shared-strings': (schema) => zipOf({
    'xl/worksheets/sheet1.xml': worksheet(spectoraRows(schema)),
    'xl/sharedStrings.xml': '<?xml version="1.0"?><sst count="0" uniqueCount="0"/>',
  }),
  'double-escaped-ampersand': (schema) => zipOf({
    'xl/worksheets/sheet1.xml': worksheet(spectoraRows(schema, { escapedTwice: true })),
  }),
  'empty-discriminator-cell': (schema) => zipOf({
    'xl/worksheets/sheet1.xml': worksheet(spectoraRows(schema, { type: '' })),
  }),
  'repeated-parent-values': (schema) => zipOf({
    'xl/worksheets/sheet1.xml': worksheet([
      schema.sheet.headings,
      [MADE_UP.parents[0], MADE_UP.children[0], MADE_UP.entryNames[0], MADE_UP.entryText, 'info'],
      [MADE_UP.parents[0], MADE_UP.children[1], MADE_UP.entryNames[1], MADE_UP.entryText, 'limit'],
      [MADE_UP.parents[1], MADE_UP.children[0], MADE_UP.entryNames[2], MADE_UP.entryText, 'defect'],
    ]),
  }),
  'sparse-columns': (schema) => zipOf({
    'xl/worksheets/sheet1.xml': worksheet([
      schema.sheet.headings,
      [MADE_UP.parents[0], MADE_UP.children[0], '', MADE_UP.entryText, 'info'],
    ], { sparse: true }),
  }),
  // U+00A0 where an ordinary space belongs, including on an end. Placed in the
  // text column and nowhere else, which is where it was observed and — more to
  // the point — is what makes it harmless: a non-breaking space in a column the
  // reader GROUPS by would split one parent into two that look identical.
  //
  // Written as an escape rather than a literal on purpose. A raw U+00A0 in this
  // file is invisible to every reviewer of it, so the one place it is allowed to
  // be invisible is inside the file being generated, never inside the generator.
  'non-breaking-space-in-text': (schema) => zipOf({
    'xl/worksheets/sheet1.xml': worksheet([
      schema.sheet.headings,
      [
        MADE_UP.parents[0], MADE_UP.children[0], MADE_UP.entryNames[0],
        ` ${MADE_UP.entryText} with gaps `, 'info',
      ],
    ]),
  }),
};

// ── the serialised-object format ────────────────────────────────────────────

function javaDocument(structure, {
  vocabulary = MADE_UP.vocabulary,
  ratingsShown = null,
  version = '10.0.2',
  sections = [{ title: MADE_UP.parents[0], items: MADE_UP.children }],
} = {}) {
  const s = structure;
  const shown = ratingsShown === null
    ? ''
    : `<void property="${s.ratingsShownProperty}"><boolean>${ratingsShown}</boolean></void>`;
  const ratings = vocabulary.length === 0 ? '' : `<void property="${s.ratingsProperty}">`
    + vocabulary.map((v) => `<void method="add"><string>${v}</string></void>`).join('')
    + '</void>';
  const panes = sections.map((section) =>
    `<void method="add"><object class="generated.${s.sectionClass}">`
    + `<void property="${s.sectionNameProperty}"><string>${section.title}</string></void>`
    + '<void property="savedPanels">'
    + section.items.map((item) =>
      `<void method="add"><object class="generated.${s.itemClass}">`
      + `<void property="${s.itemNameProperty}"><string>${item}</string></void>`
      + '</object></void>').join('')
    + '</void></object></void>').join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<java${version ? ` version="${version}"` : ''} class="${s.document}">\n`
    + ` <object class="generated.TemplateInfo">\n`
    + `  <void property="${s.templateNameProperty}"><string>${MADE_UP.templateName}</string></void>\n`
    + `  ${shown}${ratings}\n`
    + (panes ? `  <void property="tabbedPanesList">${panes}</void>\n` : '')
    + ` </object>\n</java>`;
}

const HIP_CASES = {
  'user-defined-vocabulary': (schema) => zipOf({
    [schema.structure.entry]: javaDocument(schema.structure, {
      vocabulary: ['One', 'Two', 'Three', 'Four'],
    }),
  }),
  'absent-vocabulary': (schema) => zipOf({
    [schema.structure.entry]: javaDocument(schema.structure, { vocabulary: [] }),
  }),
  'padded-vocabulary-entries': (schema) => zipOf({
    [schema.structure.entry]: javaDocument(schema.structure, {
      vocabulary: [' Leading', 'Trailing '],
    }),
  }),
  'absent-boolean-property': (schema) => zipOf({
    [schema.structure.entry]: javaDocument(schema.structure, { ratingsShown: null }),
  }),
  'absent-version': (schema) => zipOf({
    [schema.structure.entry]: javaDocument(schema.structure, { version: '' }),
  }),
  'unrelated-entries': (schema) => zipOf({
    [schema.structure.entry]: javaDocument(schema.structure),
    'Extra One.xml': '<x/>',
    'nested/Extra Two.txt': 'anything at all',
  }),
  'empty-template': (schema) => zipOf({
    [schema.structure.entry]: javaDocument(schema.structure, { vocabulary: [], sections: [] }),
  }),
  // A panel holding another panel.
  //
  // ⚠️ What this fixture asserts is that the reader still READS such a file,
  // not that it preserves the level — it does not. `objectsOfClass` keeps
  // scanning inside a matched object, so the inner panel is returned as its
  // parent's sibling and one level is erased. The adapter warns when it sees
  // this shape; the fixture exists so that warning has something to fire on.
  'nested-panels': (schema) => {
    const s = schema.structure;
    const panelName = (name) => `<void property="${s.itemNameProperty}"><string>${name}</string></void>`;
    return zipOf({
      [s.entry]: javaDocument(s).replace(
        `${panelName(MADE_UP.children[0])}</object>`,
        `${panelName(MADE_UP.children[0])}<void property="savedPanels">`
        + `<void method="add"><object class="generated.${s.itemClass}">`
        + `${panelName(MADE_UP.entryNames[0])}</object></void></void></object>`,
      ),
    });
  },
  // A property supplied as a back-reference instead of a value.
  //
  // ⚠️ What this fixture asserts is that the reader reports ABSENT, not that it
  // resolves the reference. The target here is deliberately the same shape as
  // the observed one: an id on a property element, so the "value" is the result
  // of READING another property rather than anything stored. Resolving it would
  // mean executing the object graph, and this reader never executes anything.
  //
  // So the honest reading of a fixture that produces "absent" is: the file did
  // say something, and this reader has no value for it. That is a third state
  // beside present-and-true and never-mentioned, and it is why the case exists.
  'object-reference-instead-of-value': (schema) => zipOf({
    [schema.structure.entry]: javaDocument(schema.structure, { ratingsShown: null })
      .replace(
        '<void property="savedTabbedPanes">',
        '<void id="Ref0" property="autoscrolls"/>'
        + `<void property="${schema.structure.ratingsShownProperty}">`
        + '<object idref="Ref0"/></void>'
        + '<void property="savedTabbedPanes">',
      ),
  }),
};

const CASES = { spectora: SPECTORA_CASES, home_inspector_pro: HIP_CASES };

/**
 * One sample file per quirk the schema declares.
 *
 * Throws on a quirk with no generator. That is the point: a schema line nobody
 * taught this script to produce is a claim with nothing behind it.
 */
export function generateCases(vendor) {
  const schema = readSchema(vendor);
  const table = CASES[schema.vendor];
  if (!table) throw new Error(`No generator for vendor "${schema.vendor}".`);
  return schema.quirks.map((quirk) => {
    const make = table[quirk.id];
    if (!make) {
      throw new Error(
        `Schema "${vendor}" declares quirk "${quirk.id}" and nothing here generates it. `
        + 'Add a case to scripts/generate-intake-fixture.mjs, or remove the claim.',
      );
    }
    return { quirk: quirk.id, bytes: make(schema) };
  });
}

/** One baseline file, readable by the adapter it targets. */
export function generateFixture(vendor) {
  const cases = generateCases(vendor);
  if (cases.length === 0) throw new Error(`Schema "${vendor}" declares no quirks.`);
  return cases[0].bytes;
}

function main() {
  const outFlag = process.argv.indexOf('--out');
  const out = outFlag >= 0 ? process.argv[outFlag + 1] : join(HERE, '..', '.intake-fixtures');
  mkdirSync(out, { recursive: true });
  let written = 0;
  for (const vendor of Object.keys(CASES)) {
    for (const { quirk, bytes } of generateCases(vendor)) {
      const ext = readSchema(vendor).container === 'xlsx' ? 'xlsx' : 'tpz';
      writeFileSync(join(out, `${vendor}.${quirk}.${ext}`), bytes);
      written += 1;
    }
  }
  console.log(`Wrote ${written} generated sample file(s) to ${out}.`);
  console.log('Their content is invented. Nothing here is derived from a real file.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

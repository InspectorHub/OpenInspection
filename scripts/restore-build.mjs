// Build a clean, FK-ordered, schema-conformed data-only restore file from a D1
// full-dump backup. Statement-level parsing (handles embedded newlines/commas
// in TEXT values), drops columns/tables absent from the target baseline, and
// topologically orders parents before children.
//   node restore-build.mjs <baseline.sql> <backup.sql> <out.sql>
import { readFileSync, writeFileSync } from 'node:fs';

const [BASELINE, SRC, OUT] = process.argv.slice(2);

// Columns RENAMED in the schema after this backup was taken (#185 DB-naming
// pass) — map old data into the new column instead of dropping it. Everything
// else absent from the target is a genuine deletion and is dropped.
const RENAME = {
  tenant_configs: { site_name: 'company_name', encrypted_secrets: 'secrets_enc' },
};

// ── 1. Target schema: table -> Set(columns); table -> Set(parent tables) ──
const cols = {}, deps = {};
{
  let cur = null;
  for (const line of readFileSync(BASELINE, 'utf8').split('\n')) {
    const t = line.match(/^CREATE TABLE `([^`]+)`/);
    if (t) { cur = t[1]; cols[cur] = new Set(); deps[cur] = new Set(); continue; }
    if (!cur) continue;
    if (/^\);/.test(line)) { cur = null; continue; }
    const c = line.match(/^\s*`([^`]+)`/);
    if (c) cols[cur].add(c[1]);
    const fk = line.match(/REFERENCES `([^`]+)`/);
    if (fk) deps[cur].add(fk[1]);
  }
}

// ── 2. Split the dump into complete statements (top-level ';', string-aware) ──
function statements(text) {
  const out = [];
  let buf = '', inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    buf += ch;
    if (inStr) {
      if (ch === "'") {
        if (text[i + 1] === "'") { buf += "'"; i++; continue; }
        inStr = false;
      }
    } else if (ch === "'") {
      inStr = true;
    } else if (ch === ';') {
      out.push(buf.trim()); buf = '';
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// Split a paren-group body into top-level comma tokens. String-aware AND
// paren-depth-aware: D1 dumps TEXT-with-newlines as the expression
// replace('..\n..','\n',char(10)) whose inner commas live at depth>0 and must
// NOT split the value.
function splitTokens(s) {
  const out = []; let buf = '', inStr = false, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "'") {
        if (s[i + 1] === "'") { buf += "''"; i++; continue; }
        inStr = false; buf += ch; continue;
      }
      buf += ch; continue;
    }
    if (ch === "'") { inStr = true; buf += ch; continue; }
    if (ch === '(') { depth++; buf += ch; continue; }
    if (ch === ')') { depth--; buf += ch; continue; }
    if (ch === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  out.push(buf);
  return out;
}

// Extract the body of the first '(' .. matching ')' starting at idx; returns
// {body, end}. String-aware so parens inside literals don't miscount.
function parenGroup(s, start) {
  let depth = 0, inStr = false, begin = -1;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (ch === "'") { if (s[i + 1] === "'") { i++; continue; } inStr = false; } continue; }
    if (ch === "'") { inStr = true; continue; }
    if (ch === '(') { if (depth === 0) begin = i + 1; depth++; }
    else if (ch === ')') { depth--; if (depth === 0) return { body: s.slice(begin, i), end: i }; }
  }
  throw new Error('unbalanced parens');
}

// ── 3. Process INSERTs ──
const buckets = {};
const skippedTables = new Set(), droppedCols = new Set();
let kept = 0;
for (const stmt of statements(readFileSync(SRC, 'utf8'))) {
  const m = stmt.match(/^INSERT INTO "([^"]+)"/);
  if (!m) continue;
  const table = m[1];
  if (!cols[table]) { skippedTables.add(table); continue; }
  const valid = cols[table];

  const colsGrp = parenGroup(stmt, m[0].length);
  const colNames = splitTokens(colsGrp.body).map((c) => c.trim());
  const vIdx = stmt.indexOf('VALUES', colsGrp.end);
  const valsGrp = parenGroup(stmt, vIdx + 'VALUES'.length);
  const vals = splitTokens(valsGrp.body).map((v) => v.trim());
  if (colNames.length !== vals.length) {
    console.error(`COL/VAL MISMATCH ${table}: ${colNames.length} vs ${vals.length}`);
    process.exit(1);
  }
  const rmap = RENAME[table] || {};
  const kc = [], kv = [];
  for (let i = 0; i < colNames.length; i++) {
    const orig = colNames[i].replace(/^"|"$/g, '');
    const name = rmap[orig] && valid.has(rmap[orig]) ? rmap[orig] : orig;
    if (!valid.has(name)) { droppedCols.add(`${table}.${orig}`); continue; }
    kc.push(`"${name}"`); kv.push(vals[i]);
  }
  (buckets[table] ??= []).push(`INSERT INTO "${table}" (${kc.join(',')}) VALUES(${kv.join(',')});`);
  kept++;
}

// ── 4. Topological order (parents first), emit ──
const visited = new Set(), order = [];
function visit(t) {
  if (visited.has(t)) return;
  visited.add(t);
  for (const p of deps[t] || []) if (buckets[p]) visit(p);
  order.push(t);
}
for (const t of Object.keys(buckets)) visit(t);

const lines = ['PRAGMA defer_foreign_keys=true;'];
for (const t of order) lines.push(...buckets[t]);
writeFileSync(OUT, lines.join('\n') + '\n');

console.log(`kept ${kept} INSERTs across ${order.length} tables.`);
console.log('skipped tables (absent in target):', [...skippedTables].join(', ') || '(none)');
console.log('dropped columns:', [...droppedCols].sort().join(', ') || '(none)');
console.log('order:', order.join(' '));

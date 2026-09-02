#!/usr/bin/env node
/**
 * Generate `docs/reference/database-schema.md` — the field-level schema
 * reference — from the two artifacts that already define the schema.
 *
 * There was no such document. `docs/reference/database.md` names fifteen key
 * tables in a sentence each and then, honestly, hands the reader to the source:
 * "for the complete schema, see 0000_baseline.sql, or the Drizzle definitions".
 * That is a fine answer for someone already in the code and a poor one for
 * anyone deciding whether to open it.
 *
 * ── Why this is a generator and not a file ──────────────────────────────────
 * A hand-written field reference over ninety-five tables is stale the week it
 * lands, and a stale schema doc is worse than none: it is confidently wrong
 * about the one thing people consult it for. So the document is derived, and
 * `--check` re-derives it and fails if the committed copy differs. Adding a
 * column and forgetting the doc is then a red gate rather than a slow rot.
 *
 * ── Two sources, and which wins ─────────────────────────────────────────────
 *   migrations/*.sql            STRUCTURE. Types, nullability, defaults, keys,
 *                               indexes. What the database actually has.
 *   server/lib/db/schema/**.ts  SEMANTICS. The drizzle property name, the
 *                               type-layer enum, and the comment explaining
 *                               why the column exists.
 *
 * Neither is complete alone, and the pair is checkable: `db:check` already
 * proves they agree, so reading structure from one and meaning from the other
 * cannot silently drift.
 *
 * ── On the descriptions ─────────────────────────────────────────────────────
 * A description is quoted from the source comment where one exists. Where none
 * does, a naming-convention reading is emitted IN ITALICS and marked as such in
 * the legend, because an inference presented as documentation is how a reader
 * ends up trusting something nobody wrote. Columns that get neither are left
 * blank rather than padded.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'docs', 'reference', 'database-schema.md');
const check = process.argv.includes('--check');

// ── structure: the migration chain ──────────────────────────────────────────
const migDir = join(root, 'migrations');
// Joined with an explicit breakpoint, because a file boundary IS a statement
// boundary and the last statement in a file carries no trailing marker. Joining
// on a newline instead lets the next file's first statement share a chunk with
// the previous file's last one, where the first `if` in the apply loop below
// wins and the second statement is silently skipped. That cost two columns
// (`comments.edited_at`, `tenant_destruction_records.status`) and was invisible
// until the emitted column count was compared against a real SQLite build.
const sql = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => readFileSync(join(migDir, f), 'utf8')).join('\n--> statement-breakpoint\n');

// Statements are applied IN ORDER, the way the database applies them. Order
// matters more than it looks: a table can be dropped and re-created in the same
// chain (`concierge_confirm_tokens` is), so collecting every CREATE first and
// applying the DROPs afterwards loses the survivor. The table count is printed
// against the schema's own for exactly this reason.
const tables = {};
for (const raw of sql.split('--> statement-breakpoint')) {
    const stmt = raw.trim();
    if (!stmt) continue;

    const ct = stmt.match(/CREATE TABLE `(\w+)` \(([\s\S]*?)\n\);/);
    if (ct) {
        const cols = []; let pk = []; const fks = [];
        for (let line of ct[2].split('\n')) {
            line = line.trim().replace(/,$/, '');
            const c = line.match(/^`(\w+)` (text|integer|real|blob)(.*)$/);
            if (c) {
                const dv = c[3].match(/DEFAULT (.+?)(?: NOT NULL)?$/);
                cols.push({ name: c[1], type: c[2], notnull: c[3].includes('NOT NULL'),
                    pk: c[3].includes('PRIMARY KEY'), default: dv ? dv[1].trim() : null });
                continue;
            }
            const p = line.match(/^PRIMARY KEY\((.*)\)/);
            if (p) pk = p[1].split(',').map((s) => s.trim().replace(/`/g, ''));
            const f = line.match(/^FOREIGN KEY \(`(\w+)`\) REFERENCES `(\w+)`\(`(\w+)`\)(.*)/);
            if (f) fks.push({ col: f[1], ref: `${f[2]}.${f[3]}`, cascade: /DELETE cascade/.test(f[4]) });
        }
        if (!pk.length) pk = cols.filter((c) => c.pk).map((c) => c.name);
        tables[ct[1]] = { cols, pk, fks, idx: [] };
        continue;
    }

    const dt = stmt.match(/DROP TABLE `(\w+)`/);
    if (dt) { delete tables[dt[1]]; continue; }

    const ci = stmt.match(/CREATE (UNIQUE )?INDEX `(\w+)` ON `(\w+)` \(([\s\S]*?)\)(\s*WHERE [^;]*)?;/);
    if (ci && tables[ci[3]]) {
        tables[ci[3]].idx.push({ name: ci[2], unique: !!ci[1],
            cols: ci[4].split(',').map((s) => s.trim().replace(/`/g, '')),
            where: (ci[5] || '').trim().replace(/^WHERE /, '') });
        continue;
    }

    // `IF EXISTS` is the right thing to write in a migration that may run against
    // a database which already lacks the index — and it silently defeated this
    // regex, so the reference kept describing an index production had dropped.
    // 158 in the database, 159 on the page, and nothing compared the two.
    const di = stmt.match(/DROP INDEX (?:IF EXISTS )?`(\w+)`/);
    if (di) {
        for (const t of Object.values(tables)) t.idx = t.idx.filter((i) => i.name !== di[1]);
        continue;
    }

    // `ADD COLUMN` and `ADD` are both valid SQLite and both appear in this
    // directory: drizzle generates the short form, hand-written migrations tend
    // to spell it out. Matching only one silently drops the other's columns from
    // this reference — the doc still builds, still passes its own drift gate, and
    // is simply missing a field nobody notices is missing.
    const ac = stmt.match(/ALTER TABLE `(\w+)` ADD (?:COLUMN )?`(\w+)` (text|integer|real|blob)(.*?);/);
    if (ac && tables[ac[1]] && !tables[ac[1]].cols.some((c) => c.name === ac[2])) {
        const dv = ac[4].match(/DEFAULT (.+?)(?: NOT NULL)?$/);
        tables[ac[1]].cols.push({ name: ac[2], type: ac[3], notnull: ac[4].includes('NOT NULL'),
            pk: false, default: dv ? dv[1].trim() : null });
        continue;
    }

    const dc = stmt.match(/ALTER TABLE `(\w+)` DROP (?:COLUMN )?`(\w+)`/);
    if (dc && tables[dc[1]]) {
        tables[dc[1]].cols = tables[dc[1]].cols.filter((c) => c.name !== dc[2]);
    }
}

// ── semantics: the drizzle definitions ──────────────────────────────────────
function walk(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : (e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
}
const meta = {};
// Counted from the schema text rather than the migrations: the storage type is
// `integer` either way, and only the Drizzle mode says whether the integer is
// seconds or milliseconds.
/**
 * The VALUES an enum column admits, even when the column names a constant.
 *
 * `enum: MARKETPLACE_KINDS` rendered as that name — correct about the source and
 * useless to a reader who opened this document to learn which values are
 * allowed. Resolves only a `const NAME = [ ... ]` in the SAME file, and the `;`
 * bound keeps a non-array constant from walking forward and reporting some
 * other array's values as this column's. Unresolved is returned untouched,
 * never dropped: a name beats a blank cell.
 */
function resolveEnum(expr, fileText) {
    if (!expr || expr.startsWith('[')) return expr;
    const at = fileText.indexOf(`const ${expr} =`);
    if (at === -1) return expr;
    const open = fileText.indexOf('[', at);
    const end = fileText.indexOf(';', at);
    if (open === -1 || (end !== -1 && open > end)) return expr;
    const close = fileText.indexOf(']', open);
    return close === -1 ? expr : fileText.slice(open, close + 1);
}

let nTsMs = 0, nTsRaw = 0;
for (const file of walk(join(root, 'server', 'lib', 'db', 'schema'))) {
    const raw = readFileSync(file, 'utf8');
    nTsMs  += (raw.match(/mode: 'timestamp_ms'/g) || []).length;
    nTsRaw += (raw.match(/mode: 'timestamp'/g) || []).length;
    const lines = raw.split('\n');
    const rel = file.slice(root.length + 1).replace(/\\/g, '/');
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].match(/export const \w+ = sqliteTable\(\s*'([a-z_0-9]+)'/);
        if (!t) continue;
        const doc = [];
        for (let j = i - 1; j >= 0; j--) {
            const s = lines[j].trim();
            if (!/^(\/\/|\*|\/\*)/.test(s) && s !== '*/') break;
            const c = s.replace(/^(\/\*\*?|\/\/+|\*\/|\*)\s?/, '').replace(/\*\/\s*$/, '').trim();
            if (c) doc.unshift(c);
        }
        const entry = { file: rel, doc: doc.join(' '), cols: {} };
        let buf = [], depth = 0, k = i;
        for (; k < lines.length; k++) {
            const ln = lines[k];
            depth += (ln.match(/\{/g) || []).length - (ln.match(/\}/g) || []).length;
            const s = ln.trim();
            if (/^(\/\/|\*|\/\*)/.test(s) || s === '*/') {
                const c = s.replace(/^(\/\*\*?|\/\/+|\*\/|\*)\s?/, '').replace(/\*\/\s*$/, '').trim();
                if (c) buf.push(c);
            } else {
                const c = s.match(/^(\w+):\s*(?:text|integer|real|blob)\(\s*['"]([a-z_0-9]+)['"]/);
                if (c) {
                    // Read the NEXT line only when this one leaves the column's
                    // own call open, which a wrapped `enum: [...]` does. Joining
                    // unconditionally handed 16 columns the enum belonging to
                    // the column BELOW: `client_name` documented as the
                    // signature statuses, `price_cents` as having values at all.
                    // A plausible-looking name hid it until names began
                    // resolving to their values.
                    const unclosed = (ln.match(/\(/g) || []).length - (ln.match(/\)/g) || []).length;
                    const probe = unclosed > 0 ? `${ln} ${lines[k + 1] || ''}` : ln;
                    const en = probe.match(/enum:\s*(\[[^\]]*\]|[\w.]+)/);
                    // A TRAILING comment documents its column just as well as a
                    // preceding one, and this file is full of them
                    // (`tokenHash: text('token_hash'), // SHA-256 hex; NULL on …`).
                    // Reading only the lines above counted those columns as
                    // undocumented and would have sent someone to write a second
                    // comment beside the one already there.
                    const tail = s.match(/,\s*\/\/\s*(.+)$/);
                    const parts = buf.slice();
                    if (tail) parts.push(tail[1].trim());
                    entry.cols[c[2]] = { prop: c[1], raw: parts.join(' '), enum: resolveEnum(en ? en[1] : null, raw) };
                }
                buf = [];
            }
            if (depth <= 0 && k > i) break;
        }
        meta[t[1]] = entry;
        i = k;
    }
}

// ── descriptions ────────────────────────────────────────────────────────────
const sentence = (raw, limit = 300) => {
    const c = raw.replace(/\s+/g, ' ').trim();
    if (!c) return '';
    const parts = c.split(/(?<=[.])\s+/);
    let out = parts[0];
    if (out.length < 90 && parts[1]) out += ' ' + parts[1];
    return out.length > limit ? out.slice(0, limit).replace(/\s\S*$/, '') + ' …' : out;
};

const EXACT = {
    id: 'Primary key — an application-generated string id.',
    tenant_id: 'Tenant isolation key. Every read and write must filter on it.',
    created_at: 'Creation time, epoch milliseconds.',
    updated_at: 'Last write time, epoch milliseconds.',
    inspection_id: 'The inspection (order) this belongs to. App-layer reference.',
    user_id: 'The staff user this belongs to (`users.id`). App-layer reference.',
    contact_id: 'The contact this belongs to (`contacts.id`). App-layer reference.',
    sort_order: 'Display order within its tenant; lower sorts first.',
    status: 'State-machine column — see the Values column for the vocabulary.',
    date: 'Calendar date `YYYY-MM-DD`, no time and no zone.',
    r2_key: 'Object key in the R2 bucket.',
    error: 'Message from the most recent failure.',
    metadata: 'Structured extra context, JSON-encoded.',
};
const SUFFIX = [
    [/_cents$/, 'Money, integer cents — never a float.'],
    [/_enc$/, 'Encrypted at rest (AES-GCM envelope).'],
    [/_hash$/, 'Hash used for lookup and comparison; not reversible.'],
    [/^(is|has)_/, 'Boolean flag, stored as integer 0/1.'],
    [/_at$/, 'Timestamp, epoch milliseconds. NULL means it has not happened.'],
    [/_url$/, 'A URL.'],
    [/_email$/, 'An email address.'],
    [/_name$/, 'A name.'],
    [/_id$/, 'App-layer reference to another row — no database foreign key.'],
    [/_json$|_snapshot$/, 'Serialized JSON snapshot.'],
    [/_bytes$/, 'A size in bytes.'],
    [/_count$/, 'A count.'],
    [/_time$/, 'Clock time `HH:MM` — no date, no zone.'],
];
function infer(col, type) {
    if (EXACT[col]) return EXACT[col];
    for (const [re, text] of SUFFIX) if (re.test(col)) return text;
    if (type === 'integer') return 'An integer value.';
    return '';
}

// ── emit ────────────────────────────────────────────────────────────────────
// A derived number that can silently reach zero is worse than a hand-written
// one, because it prints with the authority of having been counted. The first
// version of the timestamp census was wired in wrong and cheerfully emitted
// "0 columns use timestamp_ms" into the reference. Every table here has a
// `created_at`, so zero is not a schema state — it is a broken parser.
if (nTsMs === 0) {
    console.error('[schema-doc] the timestamp census counted 0 `timestamp_ms` columns.');
    console.error('            Every table has a created_at, so this is a parser fault, not a fact.');
    console.error('            Refusing to write a number that would be read as one.');
    process.exit(1);
}

const names = Object.keys(tables).sort();
const nCols = names.reduce((a, t) => a + tables[t].cols.length, 0);
const nIdx = names.reduce((a, t) => a + tables[t].idx.length, 0);
const nFk = names.reduce((a, t) => a + tables[t].fks.length, 0);
const documented = names.reduce((a, t) => a + tables[t].cols
    .filter((c) => meta[t]?.cols[c.name]?.raw).length, 0);

const L = [];
L.push('# Database schema reference', '');
L.push('<!-- GENERATED by scripts/gen-schema-doc.mjs — do not edit by hand.');
L.push('     Run `npm run docs:schema` after a schema change; `npm run lint:schema-doc` checks it. -->', '');
L.push('Every table, every column. Structure comes from the migration chain, meaning');
L.push('from the Drizzle definitions in `server/lib/db/schema/` — the two that');
L.push('`npm run db:check` already proves agree with each other.', '');
L.push('| | |', '|---|---|');
L.push(`| Tables | ${names.length} |`);
L.push(`| Columns | ${nCols} |`);
L.push(`| Indexes (excluding primary keys) | ${nIdx} |`);
L.push(`| Database foreign keys (all legacy, frozen) | ${nFk} |`);
L.push(`| Columns carrying a source comment | ${documented} (${Math.round(documented / nCols * 100)}%) |`);
L.push('');
// Facts a hand-written page kept getting wrong. `database.md` used to assert
// "every table has tenant_id" and a table count, and both were false by the time
// anyone read them. Anything countable belongs on this side of the split: the
// prose page states the RULE, this page states what is actually there.
const noTenant = names.filter((t) => !tables[t].cols.some((c) => c.name === 'tenant_id'));
L.push('**Tables without `tenant_id`.** Every table holding tenant data must carry it —');
L.push('`npm run lint:tenant-scope` is the gate. These are the tables that are not *about*');
L.push('a tenant, which is the only reason to be missing it:', '');
L.push(noTenant.map((t) => `\`${t}\``).join(' · ') || '_none_', '');
L.push(`That is ${noTenant.length} of ${names.length}. If a table you just added appears here,`);
L.push('that is the bug, not the list.', '');
L.push(`**Timestamps.** ${nTsMs} column(s) use \`integer(..., { mode: 'timestamp_ms' })\` —`);
L.push(`epoch MILLISECONDS${nTsRaw ? `, and ${nTsRaw} legacy column(s) still use \`mode: 'timestamp'\`` : ', with no legacy `mode: \'timestamp\'` columns left'}.`);
L.push('Seconds and milliseconds are one multiplication apart and the mistake reads as a');
L.push('date tens of thousands of years out, so the Schema Rules allow only the former for');
L.push('new columns.');
L.push('');
L.push('**Reading the tables.** SQLite has four storage types; the semantic type is a');
L.push('Drizzle layer on top — `integer{mode:timestamp_ms}` is epoch milliseconds,');
L.push('`integer{mode:boolean}` is 0/1, `text{mode:json}` is a JSON string. Flags:');
L.push('`PK` primary key · `NN` not null · `UQ` in a unique index · `IX` in a plain');
L.push('index · `FK→` a database foreign key (legacy — new tables must not add any).');
L.push('');
L.push('**Descriptions** in upright text are quoted from the source comment. *Italic*');
L.push('descriptions are read off this repository\'s naming conventions and were **not**');
L.push('written by anyone — treat them as a hint, not documentation. A column with');
L.push('neither is left blank. `[more]` marks a column whose source comment runs past');
L.push('400 characters: read it before changing that column.');
L.push('');

for (const name of names) {
    const t = tables[name];
    const m = meta[name] || { cols: {}, doc: '', file: '(no drizzle definition found)' };
    const uq = new Set(), ix = new Set();
    for (const i of t.idx) for (const c of i.cols) (i.unique ? uq : ix).add(c);
    const fkm = Object.fromEntries(t.fks.map((f) => [f.col, f]));

    L.push('---', '', `## \`${name}\``, '');
    L.push(`<sub>${m.file} · ${t.cols.length} columns · primary key \`${t.pk.join(', ') || '—'}\`</sub>`, '');
    if (m.doc) L.push('> ' + sentence(m.doc, 700), '');
    L.push('| Column | Type | Flags | Default | Values | Description |');
    L.push('|---|---|---|---|---|---|');
    for (const c of t.cols) {
        const cm = m.cols[c.name] || {};
        const flags = [];
        if (t.pk.includes(c.name)) flags.push('PK');
        if (c.notnull) flags.push('NN');
        if (uq.has(c.name)) flags.push('UQ');
        if (ix.has(c.name)) flags.push('IX');
        if (fkm[c.name]) flags.push(`FK→\`${fkm[c.name].ref}\`${fkm[c.name].cascade ? ' ⊗' : ''}`);
        let desc = cm.raw ? sentence(cm.raw) : '';
        if (desc && cm.raw.replace(/\s+/g, ' ').length > 400) desc += ' **[more]**';
        if (!desc) { const i = infer(c.name, c.type); desc = i ? `*${i}*` : ''; }
        let dv = c.default || ''; if (dv.length > 34) dv = dv.slice(0, 34) + '…';
        let ev = (cm.enum || '').replace(/\s+/g, ' ').replace(/'/g, '').replace(/^\[|\]$/g, '');
        if (ev.length > 70) ev = ev.slice(0, 70) + '…';
        // Escape the escape character FIRST. Replacing pipes alone leaves an
        // input backslash free to consume the escape that follows it: a comment
        // containing a backslash-pipe came out as backslash-backslash-pipe,
        // which markdown reads as a literal backslash plus a LIVE cell
        // separator, and the row splits. A trailing backslash eats the row's own
        // closing pipe the same way, and an embedded newline ends the row
        // outright. Three of five sample inputs broke a table row; CodeQL
        // flagged this as js/incomplete-sanitization and was right.
        const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
        L.push(`| \`${c.name}\` | ${c.type} | ${flags.join(' ')} | ${dv ? '`' + esc(dv) + '`' : ''} | ${ev ? '`' + esc(ev) + '`' : ''} | ${esc(desc)} |`);
    }
    L.push('');
    if (t.idx.length) {
        L.push('**Indexes**', '');
        for (const i of t.idx) {
            L.push(`- ${i.unique ? '**UNIQUE** ' : ''}\`${i.name}\` (${i.cols.join(', ')})`
                + (i.where ? ` — partial, \`WHERE ${i.where}\`` : ''));
        }
        L.push('');
    }
}

const out = L.join('\n') + '\n';
if (check) {
    // Compare CONTENT, not bytes. The generator writes LF; git hands a Windows
    // checkout back with CRLF, so a byte comparison reports the doc as stale on
    // a machine where nothing is stale — and only there, because CI runs on
    // Linux and never sees the conversion. A gate that fails locally and passes
    // in CI teaches people to stop reading it.
    const norm = (s) => s.replace(/\r\n/g, '\n');
    const current = existsSync(OUT) ? norm(readFileSync(OUT, 'utf8')) : '';
    if (current !== out) {
        console.error('[schema-doc] docs/reference/database-schema.md is out of date.');
        console.error(`            regenerated: ${out.length} chars over ${names.length} tables / ${nCols} columns`);
        console.error(`            committed:   ${current.length} chars`);
        console.error('            Fix: npm run docs:schema');
        process.exit(1);
    }
    console.log(`[schema-doc] OK — ${names.length} tables / ${nCols} columns, doc matches the schema.`);
} else {
    writeFileSync(OUT, out);
    console.log(`[schema-doc] wrote ${OUT} — ${names.length} tables / ${nCols} columns / ${nIdx} indexes.`);
}

#!/usr/bin/env node
/**
 * measure-data-package-move.mjs — time a RESTORE (import) of a generated data
 * package into a running OpenInspection instance, then time its UNDO.
 *
 * This is a MEASUREMENT HARNESS, not a gate. It prints an honest timing table;
 * it does not assert that a large package finishes inside a day (on a free
 * Cloudflare plan it may not — that is a recorded result, not a failure).
 *
 *   TARGET_URL=https://target... TARGET_BEARER=... OWNER_PASSWORD=... \
 *   node scripts/measure-data-package-move.mjs --fixture <dir> [--batch 1000] [--no-revert]
 *
 * Auth (the operator supplies credentials; this script never logs in and never
 * prints a secret):
 *   TARGET_BEARER      owner bearer for the target instance (session or native)
 *   OWNER_PASSWORD     the owner password, used to mint a FRESH single-use
 *                      step-up token before every privileged call. Engine
 *                      step-up tokens are one-time and expire in five minutes,
 *                      so a fixed token per action would 401 on the second
 *                      call. The password goes only to /api/auth/step-up.
 *   X-Data-Job tokens are obtained from POST /data-package/jobs and refreshed
 *   by the script; they are never accepted from the environment.
 *
 * The script reads only the generator's own files under --fixture. It derives
 * per-table rows from the NDJSON shards and applies them through the real import
 * API in referential tiers from GET .../import/plan, then uploads media from the
 * volumes and stores the evidence archive, then loops the revert until done.
 *
 * Requires a built format library: npm run build -w @inspectorhub/data-package
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

let dp;
try {
    dp = await import('@inspectorhub/data-package');
} catch {
    console.error('measure-data-package-move: build the format library first: npm run build -w @inspectorhub/data-package');
    process.exit(2);
}

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const v = process.argv[i + 1];
    if (v === undefined || v.startsWith('--')) return fallback;
    return v;
}
const intArg = (name, fallback) => {
    const n = Number.parseInt(arg(name, String(fallback)), 10);
    return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
};
const need = (name) => {
    const v = process.env[name];
    if (!v) { console.error(`measure-data-package-move: ${name} is required`); process.exit(2); }
    return v;
};

const fixture = arg('fixture', '');
if (!fixture) { console.error('measure-data-package-move: --fixture <dir> is required'); process.exit(2); }
const batchSize = Math.min(1000, Math.max(1, intArg('batch', 1000)));
const doRevert = arg('no-revert', '') === '' ;
const target = (process.env.TARGET_URL || '').replace(/\/$/, '');
if (!target) { console.error('measure-data-package-move: TARGET_URL is required'); process.exit(2); }

const bearer = need('TARGET_BEARER');
const ownerPassword = need('OWNER_PASSWORD');

// --- read the fixture from disk (no real company data; generator only) ------
const manifest = dp.parseManifest(readFileSync(join(fixture, 'manifest.json')));
const rootZip = unzipSync(new Uint8Array(readFileSync(join(fixture, dp.ROOT_VOLUME_NAME))));
const tableRows = new Map();
for (const f of manifest.files) {
    if (!f.path.startsWith('data/') || !f.path.endsWith('.ndjson')) continue;
    const raw = strFromU8(rootZip[f.path]);
    const rows = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const table = f.path.slice('data/'.length).replace(/\.\d+\.ndjson$/, '').replace(/\.ndjson$/, '');
    const list = tableRows.get(table) ?? [];
    list.push(...rows);
    tableRows.set(table, list);
}
// Evidence archive bytes (events + keys) from the fixed esign shards. The
// shards store snake_case columns (safe NDJSON keys); the PUT route expects the
// camelCase ArchiveEvent shape, so map the field names here.
const archive = { events: [], keys: [] };
if (rootZip['esign/events.ndjson']) {
    archive.events = strFromU8(rootZip['esign/events.ndjson']).split('\n').filter(Boolean).map((l) => {
        const e = JSON.parse(l);
        return {
            id: e.id, event: e.event, payloadJson: e.payload_json,
            prevHash: e.prev_hash ?? null, hash: e.hash, signature: e.signature,
            keyFingerprint: e.key_fingerprint,
        };
    });
}
if (rootZip['esign/keys.ndjson']) {
    archive.keys = strFromU8(rootZip['esign/keys.ndjson']).split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// --- a tiny fetch wrapper with timing ---------------------------------------
const timings = [];
async function call(method, path, { body, headers = {}, stepUp, raw } = {}) {
    const allHeaders = {
        Authorization: `Bearer ${bearer}`,
        ...headers,
    };
    if (stepUp) allHeaders['X-Step-Up-Token'] = stepUp;
    let payload;
    if (raw !== undefined) {
        payload = raw;
        allHeaders['Content-Type'] = 'application/octet-stream';
    } else if (body !== undefined) {
        allHeaders['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
    }
    const t0 = performance.now();
    const res = await fetch(`${target}${path}`, { method, headers: allHeaders, body: payload });
    const ms = performance.now() - t0;
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
    if (!res.ok) {
        throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
    }
    return { json, ms, status: res.status };
}
const mark = (phase, ms, detail) => timings.push({ phase, ms: Math.round(ms), detail });

// Mint a fresh, single-use step-up token for one action. A session JWT signs in
// over /api/auth/login; the engine then returns the elevation token in the
// HttpOnly __Host-step_up Set-Cookie (not the body, which is the native path).
// We read it from the header and send it explicitly so each privileged call
// gets its own token — reuse would 401 because the engine consumes it once.
async function mintStepUp(action) {
    const res = await fetch(`${target}/api/auth/step-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ action, password: ownerPassword }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`step-up ${action} -> ${res.status}: ${text.slice(0, 300)}`);
    const fromCookie = (res.headers.get('set-cookie') ?? '').match(/__Host-step_up=([^;]+)/)?.[1];
    let token = fromCookie;
    if (!token) {
        try { token = JSON.parse(text)?.data?.token; } catch { /* native path may put it in the body */ }
    }
    if (!token) throw new Error(`step-up ${action} returned no token`);
    return token;
}

// --- 1. create the import job (lease + X-Data-Job token) --------------------
// Job creation is elevated for data-export-start for BOTH directions (the route
// checks that action regardless of job kind), not for data-import-apply.
const created = await call('POST', '/api/admin/data-package/jobs', {
    body: { kind: 'import', clientKind: 'measurement', deviceLabel: 'perf-run', packageId: manifest.packageId },
    stepUp: await mintStepUp('data-export-start'),
});
const job = created.json.data;
let jobToken = job.jobToken;
const jobHeaders = () => ({ 'X-Data-Job': jobToken });
mark('create job', created.ms);

// --- 2. preflight (read-only) ------------------------------------------------
const preflight = await call('POST', `/api/admin/data-package/jobs/${job.jobId}/import/preflight`, {
    headers: jobHeaders(),
    body: {
        formatVersion: manifest.formatVersion,
        columnFingerprint: manifest.columnFingerprint,
        schemaVersion: manifest.schemaVersion,
        sourceTenantId: manifest.sourceTenantId,
        sourceMode: manifest.sourceMode,
        counts: manifest.counts,
    },
});
mark('preflight', preflight.ms, preflight.json.data?.estimate ?? null);
if (!preflight.json.data?.ok) {
    console.error('preflight refused the package:', preflight.json.data?.reasons);
    process.exit(1);
}

// --- 3. plan (referential tiers) --------------------------------------------
const plan = await call('GET', `/api/admin/data-package/jobs/${job.jobId}/import/plan`, { headers: jobHeaders() });
const tiers = plan.json.data.tiers;
mark('plan', plan.ms, { tiers: tiers.length });

// --- 4. apply rows in referential tiers, in bounded batches ------------------
let rowsApplied = 0;
let rowsRejected = 0;
const applyStart = performance.now();
for (const tier of tiers) {
    for (const table of tier) {
        const rows = tableRows.get(table) ?? [];
        for (let i = 0; i < rows.length; i += batchSize) {
            const slice = rows.slice(i, i + batchSize);
            const r = await call('POST', `/api/admin/data-package/jobs/${job.jobId}/import/batches`, {
                headers: jobHeaders(),
                stepUp: await mintStepUp('data-import-apply'),
                body: { table, rows: slice },
            });
            rowsApplied += Object.values(r.json.data.created).reduce((a, b) => a + b, 0);
            rowsRejected += r.json.data.rejected.length;
        }
    }
}
mark('apply rows', performance.now() - applyStart, { rowsApplied, rowsRejected, batchSize });

// --- 5. upload media from the volumes ---------------------------------------
let mediaUploaded = 0;
const mediaStart = performance.now();
for (const volume of manifest.volumes) {
    const zip = unzipSync(new Uint8Array(readFileSync(join(fixture, basename(volume.name)))));
    for (const [entry, bytes] of Object.entries(zip)) {
        if (entry === 'manifest.json' || entry === 'checksums.sha256') continue;
        const sha256 = await dp.sha256Hex(new Uint8Array(bytes));
        const q = new URLSearchParams({
            key: entry.replace(/^media\//, 'photos/'), sha256,
            bytes: String(bytes.byteLength), content_type: 'application/octet-stream',
            entry, volume: volume.name,
        });
        await call('POST', `/api/admin/data-package/jobs/${job.jobId}/import/media?${q}`, {
            headers: jobHeaders(), stepUp: await mintStepUp('data-import-apply'), raw: new Uint8Array(bytes),
        });
        mediaUploaded++;
    }
}
mark('upload media', performance.now() - mediaStart, { mediaUploaded });

// --- 6. store the evidence archive (read-only, never re-signs) --------------
if (archive.events.length || archive.keys.length) {
    const a = await call('PUT', `/api/admin/data-package/jobs/${job.jobId}/import/archive`, {
        headers: jobHeaders(), stepUp: await mintStepUp('data-import-apply'), body: archive,
    });
    // HTTP 200 means STORED, not VERIFIED. The chain-verification result is in
    // data.verdict.problems. The synthetic fixture uses random signatures, so
    // problems are expected here — record them honestly instead of claiming a
    // clean verify from the storage `ok` flag alone.
    const stored = a.json.data?.ok === true;
    const problems = a.json.data?.verdict?.problems ?? [];
    if (!stored) throw new Error(`archive was not stored: ${JSON.stringify(a.json.data).slice(0, 400)}`);
    mark('store archive', a.ms, {
        events: archive.events.length, keys: archive.keys.length,
        stored, chainProblems: problems.length,
    });
    if (problems.length > 0) {
        console.error(`NOTE: synthetic archive chain reported ${problems.length} problem(s) (random signatures); a real signed package must report 0`);
    }
}

// --- 7. undo, one bounded step at a time (irreversible) ---------------------
if (doRevert) {
    let done = false;
    let processed = 0;
    let mediaDeleted = 0;
    let revertErrors = 0;
    let guard = 0;
    const revertStart = performance.now();
    while (!done) {
        if (guard++ > 100_000) throw new Error('revert did not terminate');
        const r = await call('POST', `/api/admin/data-package/jobs/${job.jobId}/revert/step`, {
            headers: jobHeaders(), stepUp: await mintStepUp('data-import-revert'), body: { limit: 1000 },
        });
        done = r.json.data.done;
        processed += r.json.data.processed;
        mediaDeleted += r.json.data.mediaDeleted;
        // A failed delete is reported in the body, not the HTTP status. Count it
        // so an incomplete undo is never recorded as a clean measurement.
        revertErrors += (r.json.data.errors ?? []).length;
    }
    mark('revert', performance.now() - revertStart, { processed, mediaDeleted, errors: revertErrors });
    if (revertErrors > 0) console.error(`WARNING: revert reported ${revertErrors} row error(s) — undo may be incomplete`);
}

// --- report -----------------------------------------------------------------
const total = timings.reduce((s, t) => s + t.ms, 0);
console.log('\nData-package move measurement (restore into the target instance)');
console.log('='.repeat(72));
for (const t of timings) {
    const d = t.detail ? `  ${JSON.stringify(t.detail)}` : '';
    console.log(`${t.phase.padEnd(16)} ${String(t.ms).padStart(8)} ms${d}`);
}
console.log('-'.repeat(72));
console.log(`${'total'.padEnd(16)} ${String(total).padStart(8)} ms`);
console.log('\nFree-tier note: D1 daily write allowance may cap a large import within one');
console.log('day. A partial run that hits "stopped for today" is a recorded result; resume');
console.log('on a later day or use a paid plan. This harness does not assert a deadline.');

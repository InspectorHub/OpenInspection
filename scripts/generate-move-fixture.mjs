#!/usr/bin/env node
/**
 * generate-move-fixture.mjs — build a large, SELF-CONSISTENT format-1 tenant
 * data package on disk for move E2E and performance runs.
 *
 *   node scripts/generate-move-fixture.mjs --out <dir> [--rows 20000] \
 *        [--media 200] [--media-bytes 4096] [--signed 25] [--seed 1]
 *
 * The package is plaintext synthetic data only — no real company information.
 * It is built with the SAME @inspectorhub/data-package encoders the exporter and
 * verifier use, so a passing `verify-data-package.mjs` proves the fixture is a
 * format the importer accepts, not a format two scripts agreed on.
 *
 * Layout (format 1):
 *   manifest.json        canonical manifest
 *   checksums.sha256     root-volume digests
 *   package.zip          root volume: data/*.ndjson, esign/*.ndjson, media index
 *   media-001.zip, ...   stored, uncompressed media volumes
 *
 * Requires the data-package build (`npm run build -w @inspectorhub/data-package`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { zipSync, strToU8, Zip } from 'fflate';

let dp;
try {
    dp = await import('@inspectorhub/data-package');
} catch {
    console.error('generate-move-fixture: build the format library first: npm run build -w @inspectorhub/data-package');
    process.exit(2);
}

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const value = process.argv[i + 1];
    if (value === undefined || value.startsWith('--')) return fallback;
    return value;
}
const intArg = (name, fallback) => {
    const n = Number.parseInt(arg(name, String(fallback)), 10);
    return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
};

const out = arg('out', '');
if (!out) {
    console.error('generate-move-fixture: --out <dir> is required');
    process.exit(2);
}
const rows = intArg('rows', 20_000);
const mediaCount = intArg('media', 200);
const mediaBytes = intArg('media-bytes', 4096);
const signed = intArg('signed', 25);
const seed = intArg('seed', 1);

// A tiny deterministic PRNG so two runs with the same seed produce byte-identical packages.
let state = (seed || 1) >>> 0;
const rand = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
};
const pick = (n) => rand() % n;
const hex = (n) => Array.from({ length: n }, () => (rand() & 15).toString(16)).join('');
const iso = (day) => new Date(Date.UTC(2024, 0, 1 + (day % 700))).toISOString();

mkdirSync(out, { recursive: true });

// --- rows: spread across the tables a package carries -----------------------
const tables = [
    { name: 'contacts', weight: 0.3 },
    { name: 'inspections', weight: 0.25 },
    { name: 'templates', weight: 0.1 },
    { name: 'services', weight: 0.15 },
    { name: 'comments', weight: 0.2 },
];
const counts = {};
const fileEntries = [];
const rootFiles = {};
let emitted = 0;
for (let t = 0; t < tables.length; t++) {
    const table = tables[t];
    const n = t === tables.length - 1 ? rows - emitted : Math.floor(rows * table.weight);
    emitted += n;
    counts[table.name] = n;
    const lines = [];
    for (let i = 0; i < n; i++) {
        // Rows are safe JSON with a stable id and tenant id, like a real export.
        lines.push(dp.encodeNdjsonRow({
            id: `${table.name.slice(0, 3)}-${i.toString().padStart(8, '0')}`,
            tenant_id: 'src',
            name: `${table.name} record ${i}`,
            day: iso(i + t),
            amount: pick(100000) / 100,
            paid: pick(2) === 1,
        }));
    }
    const data = lines.length ? Buffer.concat(lines.map((l) => Buffer.from(l))) : Buffer.alloc(0);
    const path = `data/${table.name}.ndjson`;
    const sha = await dp.sha256Hex(data);
    fileEntries.push({ path, volume: dp.ROOT_VOLUME_NAME, rows: n, bytes: data.length, sha256: sha });
    rootFiles[path] = data;
}

// --- signed agreements as read-only esign shards ----------------------------
// Events follow the ArchiveEvent contract the import route accepts
// (id, event, payloadJson, prevHash, hash, signature, keyFingerprint), so the
// same bytes the verifier checks can be posted to PUT .../import/archive.
// A synthetic chain: each event's prevHash is the previous event's hash.
const esignRows = [];
let prevHash = null;
for (let i = 0; i < signed; i++) {
    const id = `env-${i.toString().padStart(6, '0')}`;
    const hash = hex(64);
    esignRows.push(dp.encodeNdjsonRow({
        id,
        request_id: id,
        event: i % 3 === 0 ? 'agreement.signed' : 'agreement.created',
        payload_json: JSON.stringify({ envelopeId: id, signedAt: iso(i + 11), signers: pick(4) + 1 }),
        prev_hash: prevHash,
        hash,
        signature: hex(128),
        key_fingerprint: hex(32),
    }));
    prevHash = hash;
}
const esignData = esignRows.length ? Buffer.concat(esignRows.map((l) => Buffer.from(l))) : Buffer.alloc(0);
const esignSha = await dp.sha256Hex(esignData);
fileEntries.push({ path: 'esign/events.ndjson', volume: dp.ROOT_VOLUME_NAME, rows: signed, bytes: esignData.length, sha256: esignSha });
rootFiles['esign/events.ndjson'] = esignData;

// The matching public keys shard (fingerprint + PEM), also a fixed entry name.
const keyRows = [dp.encodeNdjsonRow({ fingerprint: hex(32), pem: '-----BEGIN PUBLIC KEY-----\n' + hex(64) + '\n-----END PUBLIC KEY-----\n' })];
const keysData = Buffer.concat(keyRows.map((l) => Buffer.from(l)));
const keysSha = await dp.sha256Hex(keysData);
fileEntries.push({ path: 'esign/keys.ndjson', volume: dp.ROOT_VOLUME_NAME, rows: keyRows.length, bytes: keysData.length, sha256: keysSha });
rootFiles['esign/keys.ndjson'] = keysData;

// --- media index + stored volumes ------------------------------------------
const mediaRows = [];
const volumeBuckets = [];
const MEDIA_PER_VOLUME = 50;
let remaining = mediaCount;
let volIndex = 0;
while (remaining > 0) {
    volIndex++;
    const take = Math.min(MEDIA_PER_VOLUME, remaining);
    remaining -= take;
    const volumeName = dp.mediaVolumeName(volIndex);
    const entries = {};
    for (let i = 0; i < take; i++) {
        const key = `photos/${volIndex}/${i.toString().padStart(4, '0')}.bin`;
        // The ZIP entry is under media/ (never the index), while `key` is the
        // R2 key the importer restores under the target tenant prefix.
        const entry = `media/${volIndex}/${i.toString().padStart(4, '0')}.bin`;
        const obj = Buffer.alloc(mediaBytes, pick(256));
        const objSha = await dp.sha256Hex(obj);
        entries[entry] = obj;
        mediaRows.push({
            key, entry, volume: volumeName, bytes: obj.length, sha256: objSha,
            content_type: 'application/octet-stream',
            referenced_by: [{ table: 'media', id: `m-${i.toString().padStart(6, '0')}` }],
        });
    }
    volumeBuckets.push({ name: volumeName, entries });
}

const mediaIndexBytes = mediaRows.length
    ? Buffer.concat(mediaRows.map((r) => dp.encodeNdjsonRow(r)))
    : Buffer.alloc(0);
const mediaIndexSha = await dp.sha256Hex(mediaIndexBytes);

const volumes = [];
for (const bucket of volumeBuckets) {
    // Volumes are STORED (uncompressed), as the format requires.
    const zip = zipSync(bucket.entries, { level: 0 });
    const zipBuf = Buffer.from(zip);
    const sha = await dp.sha256Hex(zipBuf);
    volumes.push({ name: bucket.name, bytes: zipBuf.length, entries: Object.keys(bucket.entries).length, sha256: sha });
    writeFileSync(join(out, basename(bucket.name)), zipBuf);
}

// --- manifest, checksums, root zip -----------------------------------------
const manifestBytes = dp.serializeManifest({
    formatVersion: 1,
    schemaVersion: '0015_import_archives',
    columnFingerprint: hex(64),
    engineVersion: '2.7.0',
    packageId: 'a3f5c2d0-0000-4000-8000-000000000001',
    exportedAt: '2026-11-20T00:00:00.000Z',
    sourceMode: 'saas',
    sourceTenantId: 'src',
    sourceHost: 'source.example.test',
    encryption: null,
    counts,
    media: {
        count: mediaCount,
        index: { path: dp.DATA_PACKAGE_MEDIA_INDEX_ENTRY, bytes: mediaIndexBytes.length, sha256: mediaIndexSha },
    },
    files: fileEntries,
    volumes,
    excluded: [
        { class: 'withheld_secret', table: 'users', columns: ['password_hash', 'totp_secret'], reason: 'credentials never travel' },
        { class: 'external_media', table: 'video_uploads', ids: Array.from({ length: Math.min(10, signed) }, (_, i) => `vid-${i}`), reason: 'stream-hosted video' },
        { class: 'mode_bound', table: 'settings', columns: ['plan'], reason: 'tied to the source plan' },
    ],
});

const checksums = dp.generateChecksums([
    ...fileEntries.map((f) => ({ path: f.path, sha256: f.sha256 })),
    { path: dp.DATA_PACKAGE_MEDIA_INDEX_ENTRY, sha256: mediaIndexSha },
]);

rootFiles['manifest.json'] = manifestBytes;
rootFiles['checksums.sha256'] = strToU8(checksums);
rootFiles[dp.DATA_PACKAGE_MEDIA_INDEX_ENTRY] = mediaIndexBytes;
const rootZip = zipSync(rootFiles, { level: 0 });

writeFileSync(join(out, 'manifest.json'), manifestBytes);
writeFileSync(join(out, 'checksums.sha256'), rootFiles['checksums.sha256']);
writeFileSync(join(out, dp.ROOT_VOLUME_NAME), Buffer.from(rootZip));

console.log(JSON.stringify({
    out,
    rows,
    tables: counts,
    signed,
    media: mediaCount,
    volumes: volumes.length,
    rootZipBytes: rootZip.byteLength,
    totalBytes: rootZip.byteLength + volumes.reduce((s, v) => s + v.bytes, 0),
}, null, 2));

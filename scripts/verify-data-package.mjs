#!/usr/bin/env node
/**
 * Offline verifier for a tenant data package directory (E-4).
 *
 * Re-reads a package produced by the desktop client using the SAME validation
 * code as the importer (`@inspectorhub/data-package`), so a verifier cannot
 * silently agree with an exporter about a format neither implements correctly.
 * It never touches the network and never reads outside the given directory.
 *
 *   node scripts/verify-data-package.mjs <package-dir>
 *
 * Layout (format 1):
 *   manifest.json        canonical manifest (parseManifest)
 *   checksums.sha256     root-volume file digests (parseChecksums + assertRootChecksums)
 *   package.zip          root volume: listed files, media/index.ndjson, manifest.json, checksums.sha256
 *   media-001.zip, ...   stored media volumes, each digest listed in manifest.volumes
 *
 * Checks (a package that runs ZERO checks is a failure, not a pass):
 *   - manifest parses canonically; root zip opens and stays within classic zip limits
 *   - checksums.sha256 lists exactly manifest.files + the media index, with matching digests
 *   - every listed file's bytes and sha256 match; NDJSON rows parse safely and their count matches
 *   - media/index.ndjson verifies against manifest (bytes, sha256, row count, per-volume totals)
 *   - each media volume's sha256 matches; every object's sha256 matches its index row
 *
 * Requires the data-package build (`npm run build -w @inspectorhub/data-package`) so
 * the workspace package resolves to dist/index.js — the same code the publisher ships.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { unzipSync } from 'fflate';

function bytesToStream(bytes) {
    return new ReadableStream({
        start(controller) { controller.enqueue(bytes); controller.close(); },
    });
}

function fail(message) { throw new Error(message); }

/**
 * Verify a package directory. Returns a structured report; never throws for a
 * bad package (that is reported in `failures`), only for a missing directory.
 *
 * `dp` is the validation library. The CLI loads the published package (dist);
 * tests inject the same code via the `@core/data-package` source alias, so the
 * verifier needs no build artifact under vitest.
 */
export async function verifyDataPackage(dir, dp = null) {
    dp ??= await import('@inspectorhub/data-package');
    const ROOT = dp.ROOT_VOLUME_NAME;
    const MEDIA_INDEX = dp.DATA_PACKAGE_MEDIA_INDEX_ENTRY;
    const checks = [];
    const failures = [];
    const check = (name, fn) => {
        try {
            const detail = fn();
            checks.push({ name, ok: true, detail });
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            failures.push({ name, detail });
            checks.push({ name, ok: false, detail });
        }
    };
    const asyncCheck = async (name, fn) => {
        try {
            const detail = await fn();
            checks.push({ name, ok: true, detail });
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            failures.push({ name, detail });
            checks.push({ name, ok: false, detail });
        }
    };

    if (!existsSync(dir) || !existsSync(join(dir, 'manifest.json'))) {
        fail(`no package at ${dir} (manifest.json missing)`);
    }

    let manifest;
    check('manifest parses canonically', () => {
        manifest = dp.parseManifest(readFileSync(join(dir, 'manifest.json')));
        return `format v${manifest.formatVersion}, ${manifest.files.length} files, ${manifest.media.count} media`;
    });
    if (!manifest) {
        // Nothing else can be checked against a manifest that does not parse.
        return { ok: false, checks, failures: [...failures, { name: 'checks-run', detail: 'manifest did not parse; no further checks possible' }] };
    }

    let rootZip;
    check('root volume opens within zip limits', () => {
        const raw = readFileSync(join(dir, ROOT));
        if (raw.length > dp.ZIP_MAX_BYTES) fail('root volume exceeds the classic zip byte limit');
        rootZip = unzipSync(new Uint8Array(raw));
        const names = Object.keys(rootZip);
        if (names.length > dp.ZIP_MAX_ENTRIES) fail('root volume has too many entries');
        for (const name of names) if (dp.entryNameProblem(name) !== null) fail(`unsafe entry name: ${name}`);
        dp.assertNoDuplicateEntryNames(names);
        dp.assertNoPrefixCollisions(names);
        return `${names.length} entries`;
    });
    if (!rootZip) {
        return { ok: false, checks, failures: [...failures, { name: 'checks-run', detail: 'root volume did not open' }] };
    }

    check('checksums.sha256 matches the manifest', () => {
        const raw = rootZip['checksums.sha256'];
        if (!raw) fail('checksums.sha256 missing from the root volume');
        const entries = dp.parseChecksums(raw);
        dp.assertRootChecksums(entries, manifest);
        return `${entries.length} digests`;
    });

    check('manifest.json in the root zip matches the directory copy', () => {
        const raw = rootZip['manifest.json'];
        if (!raw) fail('manifest.json missing from the root volume');
        const embedded = dp.parseManifest(raw);
        if (JSON.stringify(embedded) !== JSON.stringify(manifest)) fail('embedded manifest differs from manifest.json');
        return 'identical';
    });

    for (const file of manifest.files) {
        await asyncCheck(`file ${file.path}`, async () => {
            const data = rootZip[file.path];
            if (!data) fail('listed file missing from root volume');
            if (data.length !== file.bytes) fail(`byte length ${data.length} != manifest ${file.bytes}`);
            const digest = await dp.sha256Hex(data);
            if (digest !== file.sha256) fail('sha256 mismatch');
            if (file.path.endsWith('.ndjson') && file.rows !== undefined) {
                let rows = 0;
                // rows:0 with bytes:0 is a legal empty shard; maxRows must be >=1.
                for await (const _ of dp.readNdjson(bytesToStream(data), { maxRows: Math.max(1, file.rows) })) rows++;
                if (rows !== file.rows) fail(`row count ${rows} != manifest ${file.rows}`);
            }
            return `${data.length} bytes${file.rows !== undefined ? `, ${file.rows} rows` : ''}`;
        });
    }

    await asyncCheck('media index verifies against the manifest', async () => {
        const index = rootZip[MEDIA_INDEX];
        if (!index) fail('media index missing from root volume');
        const count = await dp.verifyMediaIndex(bytesToStream(index), manifest);
        return `${count} media rows`;
    });

    // Read the index rows to cross-check every media object's own sha256.
    let indexRows = [];
    await asyncCheck('media index rows parse', async () => {
        const index = rootZip[MEDIA_INDEX];
        if (!index) fail('media index missing');
        for await (const row of dp.readMediaIndex(bytesToStream(index), { expectedRows: manifest.media.count })) {
            indexRows.push(row);
        }
        if (indexRows.length !== manifest.media.count) fail(`index rows ${indexRows.length} != media.count ${manifest.media.count}`);
        return `${indexRows.length} rows`;
    });

    // Group index rows by volume so each volume is opened ONCE: verify its
    // digest, entry count, entry names and every object's digest while it is
    // decompressed, then drop it before the next. Keeping all volumes resident
    // would OOM on a real multi-gigabyte export.
    const rowsByVolume = new Map();
    for (const row of indexRows) {
        if (!rowsByVolume.has(row.volume)) rowsByVolume.set(row.volume, []);
        rowsByVolume.get(row.volume).push(row);
    }
    let objectsChecked = 0;
    for (const volume of manifest.volumes) {
        await asyncCheck(`media volume ${volume.name}`, async () => {
            const raw = readFileSync(join(dir, volume.name));
            if (raw.length > dp.ZIP_MAX_BYTES) fail('media volume exceeds the classic zip byte limit');
            if (raw.length !== volume.bytes) fail(`volume byte length ${raw.length} != manifest ${volume.bytes}`);
            const digest = await dp.sha256Hex(new Uint8Array(raw));
            if (digest !== volume.sha256) fail('media volume sha256 mismatch');
            const zip = unzipSync(new Uint8Array(raw));
            const names = Object.keys(zip);
            if (names.length !== volume.entries) fail(`volume entries ${names.length} != manifest ${volume.entries}`);
            for (const name of names) if (dp.entryNameProblem(name) !== null) fail(`unsafe media entry: ${name}`);
            const rows = rowsByVolume.get(volume.name) ?? [];
            for (const row of rows) {
                const data = zip[row.entry];
                if (!data) fail(`indexed object ${row.entry} missing from ${volume.name}`);
                const objectDigest = await dp.sha256Hex(data);
                if (objectDigest !== row.sha256) fail(`object ${row.entry} sha256 mismatch`);
                objectsChecked++;
            }
            return `${names.length} objects, ${rows.length} digests verified`;
        });
    }
    if (manifest.media.count > 0) {
        check('every indexed object was verified', () => {
            if (objectsChecked !== manifest.media.count) fail(`verified ${objectsChecked} of ${manifest.media.count} media objects`);
            return `${objectsChecked} objects`;
        });
    }

    const ok = failures.length === 0 && checks.length > 0;
    return { ok, checks, failures };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && basename(process.argv[1]) === 'verify-data-package.mjs') {
    const dir = process.argv[2];
    if (!dir) {
        console.error('usage: node scripts/verify-data-package.mjs <package-dir>');
        process.exit(2);
    }
    try {
        const report = await verifyDataPackage(dir);
        for (const c of report.checks) console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
        if (!report.ok) {
            console.error(`\n${report.failures.length} check(s) failed.`);
            process.exit(1);
        }
        console.log(`\nAll ${report.checks.length} checks passed.`);
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(2);
    }
}

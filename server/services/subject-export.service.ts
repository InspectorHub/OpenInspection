/**
 * Privacy P3 — build the subject SAR archive and stream it into the shared
 * EXPORTS_BUCKET.
 *
 * Sibling of `DataExportService.buildZipToR2`: same transport (multipart ZIP via
 * `lib/zip-to-r2.ts`), different scope. That one archives a whole TENANT for
 * offboarding; this one archives ONE data subject for an Art. 15 access request.
 *
 * `r2Key` is allocated portal-side and stays stable across re-dispatches, so a
 * retried command overwrites the same object rather than littering the bucket
 * with near-identical archives. The reply nonetheless carries the key this
 * method actually wrote — a reply that echoes the request tells you what portal
 * asked for, not what exists.
 *
 * PHOTO SCOPE is the subject's inspections and nothing else. R2 keys are
 * `{tenantId}/inspections/{inspectionId}/…` (see `lib/r2-keys.ts`), so one
 * prefix list per inspection is the exact reach — no filtering of a tenant-wide
 * listing, which would be both slower and one bad predicate away from handing a
 * subject somebody else's property photos.
 */
import { logger } from '../lib/logger';
import { streamZipToR2 } from '../lib/zip-to-r2';
import { assembleSubjectData, type SubjectLocator } from './subject-data.assembler';

export interface SubjectExportManifest {
    rows: number;
    photos: number;
    /** Photos whose BYTES made it into the archive (a read failure is skipped,
     *  never fatal — a missing photo must not cost the subject the whole SAR). */
    photosEmbedded: number;
}

interface PhotoEntry {
    key: string;
    size: number;
    included: boolean;
}

export class SubjectExportService {
    /**
     * @param db      drizzle handle (D1 in prod, better-sqlite3 under unit test).
     * @param photos  the PHOTOS bucket the objects are read from.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(private db: any, private photos: R2Bucket) {}

    async buildZipToR2(
        loc: SubjectLocator,
        exportsBucket: R2Bucket,
        r2Key: string,
        opts: { partSizeBytes?: number } = {},
    ): Promise<SubjectExportManifest> {
        const data = await assembleSubjectData(this.db, loc);

        // Enumerate the subject's photo objects, one inspection prefix at a time.
        const photoEntries: PhotoEntry[] = [];
        for (const inspectionId of data.inspectionIds) {
            let cursor: string | undefined;
            do {
                const list = await this.photos.list({
                    prefix: `${loc.tenantId}/inspections/${inspectionId}/`,
                    limit: 1000,
                    ...(cursor ? { cursor } : {}),
                });
                list.objects.forEach((o) => photoEntries.push({ key: o.key, size: o.size, included: false }));
                cursor = list.truncated ? list.cursor : undefined;
            } while (cursor);
        }

        const { parts } = await streamZipToR2(exportsBucket, r2Key, async (w) => {
            for (const p of photoEntries) {
                let obj: R2ObjectBody | null = null;
                try {
                    obj = await this.photos.get(p.key);
                } catch (err) {
                    logger.error('Photo fetch failed during subject export',
                        { tenantId: loc.tenantId, key: p.key }, err instanceof Error ? err : undefined);
                }
                if (!obj) continue;
                await w.addStream(`photos/${p.key}`, obj.body);
                p.included = true;
            }

            for (const [name, rows] of Object.entries(data.collections)) {
                // Every collection is written, including the empty ones. An
                // absent file reads as "we did not look"; an empty array is a
                // positive statement that this table was searched and held
                // nothing for the subject.
                await w.addText(`data/${name}.json`, JSON.stringify(rows, null, 2));
            }
            await w.addText('photos-manifest.json', JSON.stringify(photoEntries, null, 2));
            await w.addText('README.txt', this.readme(loc, {
                rows: data.rows,
                collections: Object.keys(data.collections).length,
                photos: photoEntries,
                matchedOn: data.matchedOn,
            }));
        }, opts);

        const manifest: SubjectExportManifest = {
            rows: data.rows,
            photos: photoEntries.length,
            photosEmbedded: photoEntries.filter((p) => p.included).length,
        };
        logger.info('Subject export streamed to R2',
            { tenantId: loc.tenantId, r2Key, parts, ...manifest });
        return manifest;
    }

    /**
     * The archive's cover note. It states the MATCH AXES explicitly, because a
     * recipient cannot otherwise tell whether a thin archive means "little is
     * held" or "we looked for the wrong person" — and because an access request
     * answered on email alone, when a phone was supplied, is a different answer
     * from one answered on both.
     */
    private readme(
        loc: SubjectLocator,
        summary: { rows: number; collections: number; photos: PhotoEntry[]; matchedOn: string[] },
    ): string {
        const { rows, collections, photos, matchedOn } = summary;
        const embedded = photos.filter((p) => p.included).length;
        return [
            `Data-subject access export. Generated ${new Date().toISOString()}.`,
            '',
            `Subject email: ${loc.subjectEmail}`,
            `Subject phone: ${loc.subjectPhone ?? '(none supplied — email axis only)'}`,
            '',
            `${rows} rows across ${collections} data/*.json files, ` +
            `${photos.length} photo objects (${embedded} with bytes embedded under photos/; ` +
            'any photo missing from photos/ could not be read and is listed in ' +
            'photos-manifest.json with included=false).',
            '',
            matchedOn.length > 0
                ? `Matched on: ${matchedOn.join(', ')}.`
                : 'No records matched this subject in this workspace.',
            '',
            'An empty data/*.json file means that table was searched and held nothing',
            'for this subject — not that it was skipped.',
            '',
            'Access links, share tokens and their hashes are redacted: they are',
            'credentials rather than personal data. Signature evidence, and records',
            'about other people who appear on the same documents, are not included.',
        ].join('\n');
    }
}

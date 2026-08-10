/**
 * Probe out-of-scope register for
 * `scripts/check-non-translatable.mjs --fixture`.
 *
 * Read together with `probe-manifest.ts` — the gate concatenates both sources
 * before parsing either, so this file also exercises the cross-file id
 * collision check.
 */
export const NON_TRANSLATABLE_OUT_OF_SCOPE = [
    // OK — positive control, and the one that matters most: this names the SAME
    // catalogue-rendered file the manifest was flagged for. Here it must pass.
    // A platform notice rendering through paraglide is correct; only an entry
    // claiming the content is instrument text makes it a contradiction.
    {
        id: 'oos-probe-ok',
        source: 'probe-translated-source.ts',
        reason: 'positive control: a platform notice may be catalogue-rendered',
    },
    // VIOLATION — exclusion with no reason.
    {
        id: 'oos-probe-no-reason',
        source: 'probe-clean-source.ts',
        reason: '',
    },
    // VIOLATION — excludes a file that does not exist.
    {
        id: 'oos-probe-vanished-source',
        source: 'probe-file-that-was-deleted.ts',
        reason: 'the file this exclusion names is gone',
    },
    // VIOLATION — id already claimed by the manifest.
    {
        id: 'probe-shared-id',
        source: 'probe-clean-source.ts',
        reason: 'this id is claimed by both registers',
    },
];

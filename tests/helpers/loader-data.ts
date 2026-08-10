/**
 * Narrow an admin BFF loader's result to its DATA branch.
 *
 * The settings loaders are role-gated and return `{ forbidden: true }` instead
 * of data when `requireAdminLoader` refuses, so their return type is a UNION and
 * every data field reads as possibly-undefined. Specs that assert on the data
 * were written against the happy branch and never said so.
 *
 * `granted(await loader(...))` says it, and says it as an ASSERTION rather than
 * a cast: if the loader ever starts refusing — a changed gate, a mock that
 * stopped returning a token — the spec fails here with a sentence, instead of
 * failing later with `Cannot read properties of undefined`.
 */
export function granted<T extends object>(data: T): Extract<T, { forbidden?: undefined }> {
    if (isGranted(data)) return data;
    throw new Error(
        'The loader took its `forbidden` branch. This spec asserts on loader DATA, so the ' +
            'session/role stub is not producing an authorised request.',
    );
}

/**
 * Separate predicate for the same reason `tests/helpers/dom.ts` has one: stating
 * the narrowed type in a `x is T` position is what lets the caller return it
 * without an `as`.
 */
function isGranted<T extends object>(data: T): data is Extract<T, { forbidden?: undefined }> {
    return !('forbidden' in data && data.forbidden === true);
}

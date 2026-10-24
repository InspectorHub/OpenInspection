/**
 * One URL path segment, safe to interpolate into a request path.
 *
 * `encodeURIComponent` keeps `.` and `..` as they are, and a browser resolves a `..` segment before the
 * request leaves, so those two are escaped by hand. Ordinary ids (UUIDs, template item ids) contain none of the
 * characters that change, so a path built with this is byte-identical to the unencoded one for every real id.
 * It exists for values a collaborator can write (a video `ref` in the results document) and for ids that
 * arrive from a route param.
 */
export function pathSegment(value: string): string {
    if (value === ".") return "%2E";
    if (value === "..") return "%2E%2E";
    return encodeURIComponent(value);
}

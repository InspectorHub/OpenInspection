/**
 * True for a value that is safe to paste into ONE URL path segment. The typed API client does not encode the
 * params it is given, so a client-supplied id containing a slash, `..`, `?`, `#`, a backslash or a percent
 * escape could steer a forwarded call to another path. Real ids (UUIDs, template item ids) never contain these.
 * React Router decodes `%2F` in route params, so a route param needs this guard just as a form field does.
 */
export function isPathSegment(value: string): boolean {
    return value !== "" && value !== "." && value !== ".." && !/[/\\?#%]/.test(value);
}

/**
 * Escapes SQL LIKE metacharacters (%, _, \) in user-supplied input so the
 * string is matched literally when interpolated into a `LIKE '%…%'` pattern.
 *
 * Without this, an attacker can inject `%` or `_` wildcards to widen a search
 * beyond the intended scope — e.g. `%` matches everything, leaking all rows.
 */
export function escapeLikePattern(input: string): string {
    return input.replace(/[%_\\]/g, '\\$&');
}

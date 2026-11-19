/**
 * Settings filtering for the data-package importer.
 *
 * A package may carry settings that are meaningless or unsafe in the target
 * deployment mode: platform-backed email/video in a self-hosted target, or
 * self-hosted provider keys in the hosted target. The importer never guesses a
 * replacement — it DROPS those keys and reports every one, so the owner can set
 * them deliberately afterwards. AI configuration is always imported OFF: a
 * package carries no provider credential, and a restored workspace must not
 * silently inherit an AI provider choice.
 */

/** tenant_configs keys that only mean something with a platform behind them. */
const PLATFORM_ONLY_KEYS: ReadonlySet<string> = new Set([
    'email_mode', 'sender_email', 'reply_to',
]);
/** Keys bound to a self-hosted operator's own credentials, managed in SaaS. */
const SELF_HOST_ONLY_KEYS: ReadonlySet<string> = new Set([
    'video_mode',
]);

export interface SettingsFilterResult {
    /** The row with disallowed keys removed; never mutated in place. */
    kept: Record<string, unknown>;
    /** Column names removed, for the preview/apply report. */
    dropped: string[];
}

/**
 * Filter one settings row for the target profile. `table` is the DB table name;
 * non-settings tables pass through unchanged. AI configs are never imported as
 * live settings (the apply layer skips the tenant_ai_configs table entirely).
 */
export function filterSettings(
    table: string,
    row: Record<string, unknown>,
    profile: { hasBilling: boolean },
): SettingsFilterResult {
    if (table !== 'tenant_configs') return { kept: row, dropped: [] };
    // A hosted target has a platform behind it; a self-hosted one does not.
    // Read the capability, never disguise a mode branch.
    const disallowed = profile.hasBilling ? SELF_HOST_ONLY_KEYS : PLATFORM_ONLY_KEYS;
    const kept: Record<string, unknown> = {};
    const dropped: string[] = [];
    for (const [key, value] of Object.entries(row)) {
        if (disallowed.has(key)) {
            // A null/default carries no setting; only report a real drop.
            if (value !== null && value !== undefined) dropped.push(key);
            continue;
        }
        kept[key] = value;
    }
    return { kept, dropped };
}

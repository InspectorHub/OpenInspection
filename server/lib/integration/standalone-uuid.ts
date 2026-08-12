/**
 * SQLite expression that generates a canonically-formatted UUID v4
 * (8-4-4-4-12 with hyphens, version='4', variant='a'). Earlier seed code
 * used `lower(hex(randomblob(16)))` which produced a 32-char flat hex
 * string — Zod UUID validators on send-agreement / list-services /
 * automation API endpoints reject those, so seeded rows became
 * unreferenceable.
 *
 * Shared by the raw-SQL standalone seeders (`standalone.ts`,
 * `standalone-seed-automations.ts`) that need a DB-side UUID literal inside
 * an `INSERT ... SELECT`.
 */
export const SQL_UUID_V4 = `lower(
    substr(hex(randomblob(4)), 1, 8) || '-' ||
    substr(hex(randomblob(2)), 1, 4) || '-' ||
    '4' || substr(hex(randomblob(2)), 2, 3) || '-' ||
    'a' || substr(hex(randomblob(2)), 2, 3) || '-' ||
    substr(hex(randomblob(6)), 1, 12)
)`;

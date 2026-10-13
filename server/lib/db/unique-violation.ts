/**
 * True when a driver error (or any error in its `cause` chain) is a UNIQUE
 * constraint failure on `column` ("table.column", as SQLite prints it).
 * Drizzle wraps the driver error, so the original message is on `.cause`.
 */
export function isUniqueViolation(err: unknown, column: string): boolean {
    for (let e: unknown = err, depth = 0; e instanceof Error && depth < 4; e = e.cause, depth++) {
        if (/UNIQUE constraint failed/i.test(e.message) && e.message.includes(column)) return true;
    }
    return false;
}

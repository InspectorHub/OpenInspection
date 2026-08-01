/**
 * Replay the real migration SQL into a workerd test D1.
 *
 * Shared because three specs had their own copy of it and all three broke on the
 * same migration the same day — the duplication did not drift, it was uniformly
 * wrong, which is the harder kind to notice.
 *
 * `D1Database.exec()` treats each NEWLINE as a statement boundary, so a
 * multi-line statement has to be flattened onto one line before it is sent.
 * That flattening is what makes comment handling load-bearing: the old version
 * dropped only lines that START with `--`, so a TRAILING comment survived, and
 * once everything was joined onto a single line it commented out the remainder
 * of the statement. The migration was valid SQL; the replay was not.
 *
 *     INSERT INTO … SELECT
 *       'Licensed home inspector',   -- the string the old renderer hard-coded
 *       u.license_number, …
 *
 * flattened to `INSERT INTO … SELECT 'Licensed home inspector', -- the string …`
 * and D1 answered `incomplete input`.
 */

/**
 * Strip a `--` line comment, but only when the `--` is not inside a string
 * literal — `'has -- inside'` is data, not a comment. SQL escapes a quote by
 * doubling it, which needs no special case here: the second quote of a `''`
 * pair simply re-opens the string, leaving the in/out state correct.
 */
export function stripSqlLineComment(line: string): string {
    let inString = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === "'") inString = !inString;
        else if (!inString && ch === '-' && line[i + 1] === '-') return line.slice(0, i);
    }
    return line;
}

/** Flatten one migration statement into the single line `exec()` requires. */
export function flattenStatement(stmt: string): string {
    return stmt
        .split('\n')
        .map(stripSqlLineComment)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Apply every migration in filename order, exactly as production applies them.
 * `sqlByPath` comes from the caller's own `import.meta.glob('…/migrations/*.sql',
 * { query: '?raw', eager: true })` — the pool's bundler inlines the bodies, and
 * the glob has to be literal at each call site for that to happen.
 */
export async function applyMigrations(
    db: D1Database,
    sqlByPath: Record<string, string>,
): Promise<void> {
    for (const file of Object.keys(sqlByPath).sort()) {
        for (const stmt of sqlByPath[file]!.split('--> statement-breakpoint')) {
            const flattened = flattenStatement(stmt);
            if (flattened) await db.exec(flattened);
        }
    }
}

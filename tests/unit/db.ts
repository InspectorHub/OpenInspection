import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../server/lib/db/schema';
import * as path from 'path';

/**
 * Creates an in-memory SQLite database initialized with the latest migrations.
 * This provides a high-fidelity environment for testing business logic.
 */
export function createTestDb() {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema });
    
    // We can also run migrations here if we want to be 100% sure
    // For now, let's assume we can also just use the schema synchronization if needed.
    // However, Drizzle-kit push is better for dev. For tests, we'll manually execute 
    // the migration SQL files for maximum fidelity.
    
    return { sqlite, db };
}

/**
 * Helper to initialize the schema by executing migration files.
 */
export async function setupSchema(sqlite: any) {
    const migrationsDir = path.resolve(__dirname, '../../migrations');
    const fs = await import('node:fs');
    const migrationFiles = fs.readdirSync(migrationsDir).sort();
    
    for (const file of migrationFiles) {
        if (file.endsWith('.sql')) {
            const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
            sqlite.exec(sql);
        }
    }
}

/**
 * Wraps a better-sqlite3 instance in a minimal D1Database-shaped adapter,
 * for tests exercising code that calls `db.prepare(sql).bind(...).run()`
 * directly (raw D1 API) rather than through Drizzle. Only `prepare/bind/run`
 * are implemented — enough to cover D1's `?1`/`?2`/... numbered-parameter
 * SQL and the `res.meta.changes` result shape.
 *
 * better-sqlite3 binds numbered params (`?NNN`) via an object keyed by the
 * parameter index as a string, not by positional array — this adapter does
 * that translation so the same SQL text runs unmodified against D1 in
 * production and against better-sqlite3 in unit tests.
 */
export function toRawD1(sqlite: any): D1Database {
    return {
        prepare(query: string) {
            const stmt = sqlite.prepare(query);
            return {
                bind(...args: unknown[]) {
                    const indexed: Record<number, unknown> = {};
                    args.forEach((v, i) => { indexed[i + 1] = v; });
                    return {
                        run: async () => {
                            const info = stmt.run(indexed);
                            return { meta: { changes: info.changes } };
                        },
                    };
                },
            };
        },
    } as unknown as D1Database;
}

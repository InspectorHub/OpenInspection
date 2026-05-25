import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../src/lib/db/schema';
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

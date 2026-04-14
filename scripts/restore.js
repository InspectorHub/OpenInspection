import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// =============================================================================
// OpenInspection — Cloudflare Restore Script (D1 SQL + R2 Media)
// =============================================================================

// Argument Parsing Helper
const getArg = (key) => {
    const idx = process.argv.indexOf(key);
    return (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) ? process.argv[idx + 1] : null;
};

const TOML_PATH = getArg('--config') || getArg('--toml') || 'wrangler.toml';
const PROJECT_SLUG = 'openinspection';

// Dynamic Resource Naming
const DB_NAME = getArg('--db-name') || `${PROJECT_SLUG}-db`;
const BUCKETS = [`${PROJECT_SLUG}-photos`, `${PROJECT_SLUG}-photos-preview`];
const BACKUP_ROOT = 'backups';

const info = (msg) => console.log(`  ✓ ${msg}`);
const step = (msg) => { console.log(`\n▶ ${msg}`); };
const warn = (msg) => console.warn(`  ⚠ ${msg}`);
const die = (msg) => { console.error(`\n  ✗ ERROR: ${msg}`); process.exit(1); };

function run(cmd, options = {}) {
    try {
        return execSync(cmd, { encoding: 'utf8', stdio: options.silent ? 'pipe' : 'inherit', ...options });
    } catch (e) {
        if (options.ignoreError) return e.stdout || e.stderr;
        die(`Command failed: ${cmd}\n${e.message}`);
    }
}

const args = process.argv.slice(2);
const specifiedBackup = args.find(a => !a.startsWith('-') && args[args.indexOf(a) - 1] !== '--config' && args[args.indexOf(a) - 1] !== '--toml');

if (!fs.existsSync(BACKUP_ROOT)) {
    die(`Backup directory not found: ${BACKUP_ROOT}`);
}

// Determine which backup to use
let targetBackupDir;
if (specifiedBackup) {
    targetBackupDir = path.join(BACKUP_ROOT, specifiedBackup);
    if (!fs.existsSync(targetBackupDir)) {
        die(`Backup not found: ${targetBackupDir}`);
    }
} else {
    // Pick the latest backup by folder name (ISO timestamp sorts well)
    const backups = fs.readdirSync(BACKUP_ROOT).filter(f => fs.statSync(path.join(BACKUP_ROOT, f)).isDirectory()).sort();
    if (backups.length === 0) die("No backups found in backups/ directory.");
    targetBackupDir = path.join(BACKUP_ROOT, backups[backups.length - 1]);
}

console.log("\n╔══════════════════════════════════════════════════════╗");
console.log("║         OpenInspection — Cloudflare Restore          ║");
console.log("╚══════════════════════════════════════════════════════╝");
console.log(`\n  CONFIG: ${TOML_PATH}\n  SOURCE: ${targetBackupDir}\n  TARGET: Cloudflare Production (${DB_NAME})`);

const isForce = args.includes('--force') || args.includes('-y') || args.includes('--yes');

if (isForce) {
    info("Force mode enabled: Skipping confirmation.");
    executeRestore();
} else {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question("\n  WARNING: This will overwrite remote data. Type 'yes' to proceed: ", (answer) => {
        if (answer.toLowerCase() !== 'yes') {
            console.log("  Aborted.");
            process.exit(0);
        }
        rl.close();
        executeRestore();
    });
}

async function executeRestore() {
    // 0. Pre-restore: Drop existing tables to avoid CREATE TABLE collisions
    step(`Purging existing tables in ${DB_NAME} to ensure a clean restore...`);
    try {
        const tablesJson = run(`npx wrangler d1 execute ${DB_NAME} --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%';" --json -c ${TOML_PATH}`, { silent: true });
        
        // Wrangler JSON output can be nested or contain metadata
        const parsed = JSON.parse(tablesJson);
        const results = Array.isArray(parsed) ? (parsed[0].results || []) : (parsed.results || []);
        const tables = results.map(r => r.name);

        if (tables.length > 0) {
            info(`Found ${tables.length} tables. Dropping in dependency order...`);
            
            // Hardcoded order to handle foreign keys (Leaf to Root)
            const dropOrder = [
                'inspection_results', 
                'inspection_agreements',
                'availability_overrides',
                'availability',
                'inspections',
                'audit_logs',
                'templates',
                'tenant_invites',
                'agreements',
                'users',
                'tenants',
                'd1_migrations'
            ];

            const sortedTables = [
                ...tables.filter(t => !dropOrder.includes(t)), // Unknown tables first
                ...dropOrder.filter(t => tables.includes(t)).reverse() // Known tables in reverse order for dropping
            ];

            for (const table of sortedTables) {
                run(`npx wrangler d1 execute ${DB_NAME} --remote --command "DROP TABLE IF EXISTS \\"${table}\\";" --yes -c ${TOML_PATH}`, { silent: true });
                console.log(`    - Dropped: ${table}`);
            }
            info("Environment purged.");
        } else {
            info("Database is already empty.");
        }
    } catch (e) {
        warn(`Purge step encountered an issue: ${e.message}. Proceeding anyway...`);
    }

    // 1. Database Restore (D1)
    const sqlFile = path.join(targetBackupDir, 'database.sql');
    if (fs.existsSync(sqlFile)) {
        step(`Restoring D1 Database: ${DB_NAME}`);
        // Note: Batch mode is recommended for large imports
        run(`npx wrangler d1 execute ${DB_NAME} --remote --file "${sqlFile}" -c ${TOML_PATH}`);
        info("Database restored.");
    } else {
        warn("No database.sql found in backup folder. Skipping DB restore.");
    }

    // 2. Media Restore (R2)
    const mediaRootDir = path.join(targetBackupDir, 'media');
    if (fs.existsSync(mediaRootDir)) {
        for (const bucket of BUCKETS) {
            const bucketDir = path.join(mediaRootDir, bucket);
            if (!fs.existsSync(bucketDir)) continue;

            step(`Restoring R2 Bucket: ${bucket}`);
            
            // Function to recursively find files
            const getAllFiles = (dirPath, arrayOfFiles = []) => {
                const files = fs.readdirSync(dirPath);
                files.forEach(file => {
                    const fullPath = path.join(dirPath, file);
                    if (fs.statSync(fullPath).isDirectory()) {
                        arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
                    } else {
                        arrayOfFiles.push(fullPath);
                    }
                });
                return arrayOfFiles;
            };

            const filesToUpload = getAllFiles(bucketDir);
            if (filesToUpload.length === 0) {
                info(`No files to upload for ${bucket}.`);
                continue;
            }

            info(`Uploading ${filesToUpload.length} files...`);
            for (const filePath of filesToUpload) {
                // Determine the key by relative path
                const relativePath = path.relative(bucketDir, filePath);
                const key = relativePath.replace(/\\/g, '/'); // Ensure forward slashes for R2 keys
                
                run(`npx wrangler r2 object put "${bucket}/${key}" --file "${filePath}"`, { silent: true });
                console.log(`    - ${key}`);
            }
            info(`Bucket ${bucket} restored.`);
        }
    } else {
        warn("No media directory found in backup folder. Skipping media restore.");
    }

    console.log("\n╔══════════════════════════════════════════════════════╗");
    console.log("║  ✓ Restore complete!                                 ║");
    console.log("╚══════════════════════════════════════════════════════╝\n");
}

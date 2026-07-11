/**
 * Editor E2E seed handoff.
 *
 * The editor subsystem specs (subsystem-a-*, inspection-edit-hotkeys) need a
 * real inspection — with items — that a logged-in user can edit. That id is only
 * known at runtime (the API mints a fresh UUID), and Playwright worker processes
 * do NOT inherit `process.env` mutations made after they spawn. So a setup
 * project (`editor-seed.setup.ts`) creates the fixture via the API and writes the
 * handoff here; the dependent specs read it back synchronously at collection time
 * (the dependency guarantees the file exists before their workers import them).
 *
 * The file lives beside the specs and is a gitignored, per-run artifact —
 * `tests/global-setup.ts` deletes it on every run so a stale id from a previous
 * run (whose D1 rows were since wiped) can never leak into a run where the
 * seed project did not execute.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** `tests/e2e/.editor-seed.json` — a sibling of the spec directory. */
export const EDITOR_SEED_FILE = path.join(__dirname, '..', '.editor-seed.json');

export interface EditorSeed {
    /** Login email of a user allowed to edit `inspectionId` (the api admin). */
    email: string;
    password: string;
    /** UUID of an inspection whose template gives it at least one rich item. */
    inspectionId: string;
}

export function writeEditorSeed(seed: EditorSeed): void {
    writeFileSync(EDITOR_SEED_FILE, JSON.stringify(seed, null, 2));
}

/** Returns the seed, or null when the setup project has not run this session. */
export function readEditorSeed(): EditorSeed | null {
    if (!existsSync(EDITOR_SEED_FILE)) return null;
    try {
        return JSON.parse(readFileSync(EDITOR_SEED_FILE, 'utf8')) as EditorSeed;
    } catch {
        return null;
    }
}

export function clearEditorSeed(): void {
    rmSync(EDITOR_SEED_FILE, { force: true });
}

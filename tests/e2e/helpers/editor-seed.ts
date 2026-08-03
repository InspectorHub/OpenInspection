/**
 * Editor E2E seed handoff.
 *
 * The editor subsystem specs (subsystem-a-*, inspection-edit-hotkeys) need a
 * real inspection — with items — that a logged-in user can edit. That id is only
 * known at runtime (the API mints a fresh UUID), and Playwright worker processes
 * do NOT inherit `process.env` mutations made after they spawn. So a setup
 * project (`editor-seed.setup.ts`) creates the fixtures via the API and writes
 * the handoff here; the dependent specs read it back in their own hooks (the
 * dependency guarantees the file exists by then).
 *
 * ONE INSPECTION PER MUTATING PROJECT. The suite used to hand every dependant
 * the same inspection id, which was safe only while `workers: 1` made them run
 * one at a time. It does not survive real concurrency: SpeedMode's overlay opens
 * only while unrated items remain, and `inspection-edit-hotkeys` rates items on
 * the very same rows — so whichever ran second could find nothing to rate and
 * failed with "element(s) not found", a symptom naming neither the cause nor the
 * spec that caused it. `inspection-lifecycle-publish.spec.ts` had already hit
 * this and opted out by seeding its own; this generalises that fix rather than
 * leaving it as one file's private workaround.
 *
 * Specs that only need CREDENTIALS (never the inspection) keep sharing one
 * entry — they have nothing to corrupt.
 *
 * The file lives beside the specs and is a gitignored, per-run artifact —
 * `tests/global-setup.ts` deletes it on every run so a stale id from a previous
 * run (whose D1 rows were since wiped) can never leak into a run where the
 * seed project did not execute.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { test } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** `tests/e2e/.editor-seed.json` — a sibling of the spec directory. */
export const EDITOR_SEED_FILE = path.join(__dirname, '..', '.editor-seed.json');

/**
 * Projects that OPEN the seeded inspection and change it. Each gets its own.
 *
 * The test for membership is "does it write?", not "does it read the id?" — a
 * reader sharing an inspection with a writer is just as broken, it simply fails
 * later and less legibly. Adding a project here costs one API call in the setup
 * project; leaving one out costs an intermittent failure in whichever spec loses
 * the race.
 */
export const EXCLUSIVE_SEED_PROJECTS = [
    'subsystem-a-speed-mode',
    'subsystem-a-inspector-tools-dock',
    'inspection-edit-hotkeys',
    'batch-photo-upload',
    'address-autofill',
    'people-role-profiles',
    'inspection-lifecycle',
] as const;

/** Key for the entry handed to projects that need a login but no inspection. */
export const SHARED_SEED_KEY = 'shared';

export interface EditorSeed {
    /** Login email of a user allowed to edit `inspectionId` (the api admin). */
    email: string;
    password: string;
    /** UUID of an inspection whose template gives it at least one rich item. */
    inspectionId: string;
}

/** `{ shared: …, 'subsystem-a-speed-mode': …, … }` — one entry per key above. */
export type EditorSeedFile = Record<string, EditorSeed>;

export function writeEditorSeed(seeds: EditorSeedFile): void {
    writeFileSync(EDITOR_SEED_FILE, JSON.stringify(seeds, null, 2));
}

/**
 * The calling project's seed, or null when the setup project has not run.
 *
 * Resolves the project name from the running test so callers need no argument —
 * a spec cannot quietly read another project's inspection by forgetting to pass
 * its own name. Pass `projectName` explicitly only from outside a test.
 */
export function readEditorSeed(projectName?: string): EditorSeed | null {
    if (!existsSync(EDITOR_SEED_FILE)) return null;
    let seeds: EditorSeedFile;
    try {
        seeds = JSON.parse(readFileSync(EDITOR_SEED_FILE, 'utf8')) as EditorSeedFile;
    } catch {
        return null;
    }
    let key = projectName;
    if (key === undefined) {
        // Deliberately NOT a silent fallback to the shared entry. Handing an
        // exclusive project someone else's inspection is the exact failure this
        // file exists to prevent, and it would surface as an unrelated spec
        // flaking later. Unresolvable means the caller must say which it wants.
        try {
            key = test.info().project.name;
        } catch {
            throw new Error(
                'readEditorSeed() could not resolve the running project (called outside a ' +
                'test or hook). Pass the project name explicitly: readEditorSeed("my-project").',
            );
        }
    }
    // A project absent from the map is one that never edits an inspection, so
    // the shared entry IS its seed — that lookup is intended, unlike the above.
    return seeds[key] ?? seeds[SHARED_SEED_KEY] ?? null;
}

export function clearEditorSeed(): void {
    rmSync(EDITOR_SEED_FILE, { force: true });
}

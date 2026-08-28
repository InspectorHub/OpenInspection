import { rmSync } from 'node:fs';
import path from 'node:path';
import baseGlobalSetup from '../global-setup';
import { SHOT_ROOT } from './_harness';

/**
 * The capture run's globalSetup: clear last run's PNGs, then seed as usual.
 *
 * WHY THE CLEAR MOVED HERE, out of each guide's `test.beforeAll`.
 *
 * Playwright starts a NEW WORKER after a test fails, and `beforeAll` runs again
 * in that worker. So a file whose first test failed had its directory wiped a
 * second time — deleting the screenshots the failed test had already taken, and
 * every screenshot taken before the failure. The symptom was a capture run that
 * appeared to produce almost nothing: after a mid-walk failure, only the shots
 * taken by the LAST test to run survived, and the author went looking for a bug
 * in `shot()`.
 *
 * globalSetup runs exactly once per run, in one process, before any worker
 * exists. That is the only place a "start from nothing" step can live and mean
 * it.
 *
 * ⚠️ It clears EVERYTHING under `.docs-shots/`, so a `--grep` run of one guide
 * drops the others' captures too. That is the honest trade: the alternative is
 * a stale PNG from a step that has since been renamed, which the prose/capture
 * gate reports as "a capture with no marker" and which nobody can date. Run the
 * whole set before publishing — which is what the plan asks for anyway.
 */
export default async function docsShotsGlobalSetup() {
    rmSync(path.resolve(SHOT_ROOT), { recursive: true, force: true });
    return baseGlobalSetup();
}

// @vitest-environment happy-dom
/**
 * The Automations editor must offer every value the schema accepts.
 *
 * This is the executable form of a "keep these in sync" comment, and it exists
 * because the prose version already failed once. B1 added the `in_app` channel
 * and B2 added the `staff` recipient kind at the schema and engine layers; the
 * settings UI kept a hand-written list of the OLD values, and the failure was
 * silent in the worst way:
 *
 *   - the save action filtered submitted channels to `email | sms`, so opening
 *     an in-app rule and pressing Save dropped its only channel, fell through
 *     to the email default, and turned an office alert into a template-less
 *     email rule that skips at flush — the alerts just stopped;
 *   - the recipient <select> had no `staff` option, so a staff rule rendered
 *     with nothing selected and could be saved as something else entirely.
 *
 * Neither is caught by type-checking, because both lists were plain string
 * literals. So the lists are asserted against the DRIZZLE COLUMN ENUMS here,
 * which is the one place the accepted values are actually defined.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { automations, automationLogs } from '../../server/lib/db/schema';

/** The enum a drizzle text column declares, or [] when it declares none. */
function columnEnum(column: unknown): string[] {
    return ((column as { enumValues?: string[] }).enumValues ?? []).slice();
}

/**
 * Loaded ONCE, in `beforeAll`, and not inside an `it()` — #88/#89.
 *
 * This module's import graph reaches `~/paraglide/messages`, whose generated
 * `_index.js` is ~3.7 MB and is transformed on the single main thread every
 * vitest worker shares. Inside a test body that wait is billed against the
 * 5000 ms `testTimeout`, so the FIRST test of the file becomes the victim
 * whenever the machine is busy: measured 2774 ms solo and an outright timeout
 * under `--maxWorkers=16`. `beforeAll` has no such budget, and loading a
 * fixture is what it is for.
 */
let RECIPIENT_KIND_LABELS: Record<string, unknown>;
let TRIGGER_LABELS: Record<string, unknown>;

beforeAll(async () => {
    ({ RECIPIENT_KIND_LABELS, TRIGGER_LABELS } = await import('./settings-automations'));
});

describe('Automations editor covers the schema', () => {
    it('every recipient kind the column accepts has a label', () => {
        const schemaKinds = columnEnum(getTableColumns(automations).recipientKind);
        expect(schemaKinds.length).toBeGreaterThan(0);
        for (const kind of schemaKinds) {
            expect(Object.keys(RECIPIENT_KIND_LABELS), `no label for recipientKind "${kind}"`)
                .toContain(kind);
        }
    });

    it('every trigger the column accepts has a label', () => {
        const schemaTriggers = columnEnum(getTableColumns(automations).trigger);
        expect(schemaTriggers.length).toBeGreaterThan(0);
        for (const trigger of schemaTriggers) {
            expect(Object.keys(TRIGGER_LABELS), `no label for trigger "${trigger}"`)
                .toContain(trigger);
        }
    });

    it('the save action accepts every channel the column accepts', async () => {
        // The filter lives inline in the action, so assert on its source rather
        // than pretend a unit boundary exists. Crude, and it fails loudly the
        // next time a channel is added without touching the UI — which is the
        // whole point.
        const { readFileSync } = await import('node:fs');
        const src = readFileSync('app/routes/settings-automations.tsx', 'utf8');
        const filterLine = src.split('\n').find((l) => l.includes('form.getAll("channels")')
            || (l.includes('.filter((c) =>') && l.includes('"email"')));
        expect(filterLine, 'could not locate the channels filter').toBeTruthy();
        const region = src.slice(src.indexOf('form.getAll("channels")'));
        for (const channel of columnEnum(getTableColumns(automationLogs).channel)) {
            expect(region.slice(0, 400), `save action drops channel "${channel}"`)
                .toContain(`"${channel}"`);
        }
    });
});

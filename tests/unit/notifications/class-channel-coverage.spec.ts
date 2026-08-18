/**
 * A class's `channels` is the truth about what the code can send. Five of them
 * were lying.
 *
 * Nine seeded automations carry an `smsBody`. Five map to classes declaring
 * `channels: ['email']` — so the vocabulary says "email only" about texts the
 * product sends today.
 *
 * ── What the disagreement actually costs, corrected ─────────────────────────
 * The obvious reading is "no SMS switch is shown, so the recipient cannot turn
 * it off". That is NOT true, and it is worth writing down because it is the
 * reading a future editor will reach for. `screen-model.ts` renders EVERY
 * channel for every non-required class and deliberately does not read
 * `channels` — its own comment says so, and the reason is sound: a preference
 * is a statement of intent worth storing before the text exists, and the
 * switch's meaningful direction is OFF, which always works. So for the four
 * non-required report classes the SMS switch is already on screen and already
 * functions.
 *
 * The cost is real but different, and it lands in two places:
 *
 *  1. `alwaysSent` — the REQUIRED half of the screen — DOES read `c.channels`,
 *     verbatim. So `report-ready`, which is required, tells its recipient "we
 *     always send you this by email" while the product also texts them. That is
 *     a false statement made to a data subject about their own notifications,
 *     and it is the half no preference can compensate for, because a required
 *     class has no switch at all.
 *  2. `channels` is what the send path and every compliance answer read. A
 *     vocabulary that under-reports a channel makes "which channels do we use
 *     to contact people" unanswerable from the code.
 *
 * Both are fixed by the same one-word change, and both are asserted here.
 */
import { describe, it, expect } from 'vitest';
import { NOTIFICATION_CLASSES } from '../../../server/lib/notifications/classes';
import { AUTOMATION_SEEDS } from '../../../server/data/automation-seeds';
import { automationClassId } from '../../../server/lib/notifications/automation-classes';
import { buildScreenModel } from '../../../server/lib/notifications/screen-model';

const seedsWithSms = () => AUTOMATION_SEEDS.filter((s) => 'smsBody' in s && s.smsBody);

describe('a seeded SMS body implies an SMS channel on its class', () => {
    it('every seed carrying smsBody maps to a class that declares sms', () => {
        const offenders: string[] = [];
        for (const seed of seedsWithSms()) {
            const id = automationClassId(seed);
            const cls = NOTIFICATION_CLASSES.find((c) => c.id === id);
            if (!cls) { offenders.push(`${seed.name}: no class`); continue; }
            if (!cls.channels.includes('sms')) offenders.push(`${seed.name} -> ${id}`);
        }
        expect(offenders).toEqual([]);
    });

    it('scans a plausible number of seeds — an empty scan is not a pass', () => {
        // A refactor that emptied AUTOMATION_SEEDS would otherwise turn the
        // assertion above green by having nothing to check.
        expect(seedsWithSms().length).toBeGreaterThanOrEqual(9);
    });
});

describe('the always-sent list does not understate how it reaches you', () => {
    it('a required class reports every channel it can actually be sent on', () => {
        // This is the half a preference cannot compensate for. `alwaysSent`
        // reads `c.channels` verbatim, and a required class has no switch — so
        // an under-reported channel here is a statement to a data subject about
        // their own notifications that is simply untrue.
        const model = buildScreenModel('client', new Map());
        const reportReady = model.alwaysSent.find((r) => r.id === 'report-ready');
        expect(reportReady, 'report-ready should be in the always-sent list').toBeTruthy();
        expect(reportReady!.channels).toContain('email');
        expect(reportReady!.channels).toContain('sms');
    });

    it('every always-sent row agrees with its class vocabulary', () => {
        // Generalised, so the next required class that gains a channel cannot
        // quietly under-report it.
        const model = buildScreenModel('client', new Map());
        for (const row of model.alwaysSent) {
            const cls = NOTIFICATION_CLASSES.find((c) => c.id === row.id);
            expect(cls, `class ${row.id} is on screen but not in the vocabulary`).toBeTruthy();
            expect([...row.channels].sort()).toEqual([...cls!.channels].sort());
        }
    });
});

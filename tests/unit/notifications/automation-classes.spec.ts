/**
 * Every seeded rule is a notification someone receives, so every seeded rule
 * must be able to say what it is.
 *
 * The map and the seed list are two files that have to agree, which is the
 * shape this codebase keeps finding bugs in. Asserted, not described.
 */
import { describe, it, expect } from 'vitest';
import { AUTOMATION_SEEDS } from '../../../server/data/automation-seeds';
import { automationClassId, SEED_CLASS_KEYS, SEED_CLASS_IDS } from '../../../server/lib/notifications/automation-classes';
import { notificationClass } from '../../../server/lib/notifications/classes';

/**
 * Classes that ALSO have a non-automation sender, so the seed is not the only
 * thing that decides which channels are possible.
 */
const SHARED_WITH_OTHER_PATHS = new Set([
    'booking-confirmation', 'report-ready', 'payment-request',
    'agreement-request', 'agreement-signed', 'agent-report-ready',
]);

describe('automation seed classes', () => {
    it('gives every seeded rule a class — a new seed cannot arrive unnamed', () => {
        const unnamed = AUTOMATION_SEEDS
            .filter((s) => !automationClassId(s))
            .map((s) => `${s.trigger}::${s.name}`);
        expect(unnamed, 'add these to CLASS_BY_SEED in automation-classes.ts').toEqual([]);
    });

    it('maps only to classes that exist', () => {
        const unknown = SEED_CLASS_IDS.filter((id) => !notificationClass(id));
        expect(unknown).toEqual([]);
    });

    it('has no entry for a seed that no longer exists', () => {
        // A stale entry is how a map starts describing a system that changed
        // underneath it. Cheap to catch, invisible otherwise.
        const live = new Set(AUTOMATION_SEEDS.map((s) => `${s.trigger}::${s.name}`));
        expect(SEED_CLASS_KEYS.filter((k) => !live.has(k))).toEqual([]);
    });

    it('keeps the three report.published client seeds apart', () => {
        // The whole reason the key is the seed and not the trigger. These three
        // go to the same person off the same event and say different things,
        // and spec §5.3 gives them different answers about muting.
        const ids = ['Report Ready', 'Post-inspection follow-up', 'Review request']
            .map((name) => automationClassId({ name, trigger: 'report.published' }));
        expect(new Set(ids).size).toBe(3);
        expect(notificationClass(ids[0]!)!.required).toBe(true);
        expect(notificationClass(ids[1]!)!.required).toBe(false);
        expect(notificationClass(ids[2]!)!.required).toBe(false);
    });

    it('declares only channels the seed can actually deliver on', () => {
        // A class's `channels` is what the preferences screen renders a control
        // for. Promising SMS for a seed with no `smsBody` puts a switch in
        // front of someone for a message that can never be sent — and the
        // §2 table, which is where these were transcribed from, lists channels
        // the product INTENDS, not the ones it has content for.
        const wrong: string[] = [];
        for (const seed of AUTOMATION_SEEDS) {
            const id = automationClassId(seed);
            if (!id) continue;
            const cls = notificationClass(id)!;
            const s = seed as { smsBody?: string; channels?: string[]; inAppTitle?: string };
            const deliverable = new Set<string>();
            const seedChannels = s.channels ?? ['email'];
            if (seedChannels.includes('email')) deliverable.add('email');
            if (s.smsBody) deliverable.add('sms');
            if (seedChannels.includes('in_app') || s.inAppTitle) deliverable.add('in_app');
            for (const ch of cls.channels) {
                // A class may be shared with a non-automation path that has the
                // channel, so only flag a channel NO path can deliver.
                if (!deliverable.has(ch) && !SHARED_WITH_OTHER_PATHS.has(id)) {
                    wrong.push(`${id} declares ${ch}, but "${seed.name}" cannot send it`);
                }
            }
        }
        expect(wrong).toEqual([]);
    });

    it('agrees with the seed about WHOSE notification it is', () => {
        // §2's "Who" column, made executable — the same treatment "Off?" got.
        // The screen filters on `audience`, so a class that disagrees with the
        // rule that sends it shows a client an office alert, or hides an agent
        // notification from the agent.
        const audienceOf = (seed: { recipientKind?: string; recipientRoleKey?: string | null }) => {
            if (seed.recipientKind === 'staff' || seed.recipientKind === 'inspector') return 'staff';
            if (seed.recipientRoleKey === 'buyer_agent' || seed.recipientRoleKey === 'listing_agent') return 'agent';
            return 'client';
        };
        const wrong: string[] = [];
        for (const seed of AUTOMATION_SEEDS) {
            const id = automationClassId(seed);
            if (!id) continue;
            const expected = audienceOf(seed);
            const cls = notificationClass(id)!;
            if (!cls.audience.includes(expected)) {
                wrong.push(`${id} sends to ${expected} but its audience is [${cls.audience.join(', ')}]`);
            }
        }
        expect(wrong).toEqual([]);
    });

    it('returns undefined for a rule the tenant wrote', () => {
        // Unclassified, therefore unmutable by a recipient — the operator can
        // still disable the rule. Never a guess.
        expect(automationClassId({ name: 'My own rule', trigger: 'report.published' })).toBeUndefined();
        expect(automationClassId(null)).toBeUndefined();
    });
});

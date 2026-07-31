/**
 * §4 says the screen must let a reader answer two questions without help:
 * *what will you send me* and *what can I stop*. These assert the answers.
 *
 * Three surfaces render this model. The reason it is one function is that the
 * filtering — audience, recipient-facing, which channels a class can even use —
 * would otherwise be decided three times, and a class added later would appear
 * on two screens out of three with nothing to say which was right.
 */
import { describe, it, expect } from 'vitest';
import { buildScreenModel, classesFor } from '../../../server/lib/notifications/screen-model';

const noMutes = new Set<string>();

describe('notifications screen model', () => {
    it('never shows a reader something they cannot receive', () => {
        const clientIds = classesFor('client').map((c) => c.id);
        expect(clientIds).not.toContain('office-alert-new-booking');
        expect(clientIds).not.toContain('agent-new-referral');

        const staffIds = classesFor('staff').map((c) => c.id);
        expect(staffIds).toContain('office-alert-new-booking');
        expect(staffIds).not.toContain('review-request');
    });

    it('leaves the non-recipient-facing classes off every screen', () => {
        for (const a of ['client', 'agent', 'staff'] as const) {
            expect(classesFor(a).map((c) => c.id)).not.toContain('admin-test-send');
        }
    });

    it('leaves off the one class that belongs to nobody', () => {
        // A repair-request share goes to an address someone typed. There is no
        // account to show it on, which is the same fact that makes it required.
        for (const a of ['client', 'agent', 'staff'] as const) {
            expect(classesFor(a).map((c) => c.id)).not.toContain('repair-request-share');
        }
    });

    it('splits into what we always send and what you choose, with nothing in both', () => {
        const m = buildScreenModel('client', noMutes);
        const always = new Set(m.alwaysSent.map((r) => r.id));
        const choose = new Set(m.youChoose.map((r) => r.id));
        expect([...always].filter((id) => choose.has(id))).toEqual([]);
        // The reader must be able to see BOTH questions answered.
        expect(m.alwaysSent.length).toBeGreaterThan(0);
        expect(m.youChoose.length).toBeGreaterThan(0);
    });

    it('marks a channel the class never uses as unavailable, not as off', () => {
        // §4: `—` is distinct from "off". A review request has no in-app form;
        // an off-switch for it would be a lie about what exists, and a reader
        // who turned it on would be right to expect something.
        const row = buildScreenModel('client', noMutes).youChoose.find((r) => r.id === 'review-request')!;
        expect(row.channels.email).toBe('on');
        expect(row.channels.in_app).toBe('unavailable');
        expect(row.channels.sms).toBe('unavailable');
    });

    it('reads absence as ON, and only an explicit row as off', () => {
        const on = buildScreenModel('client', noMutes).youChoose.find((r) => r.id === 'booking-confirmation')!;
        expect(on.channels.email).toBe('on');

        const off = buildScreenModel('client', new Set(['booking-confirmation:email']))
            .youChoose.find((r) => r.id === 'booking-confirmation')!;
        expect(off.channels.email).toBe('off');
        // A mute is per CHANNEL — muting email must not silence the text.
        expect(off.channels.sms).toBe('on');
    });

    it('cannot be talked into switching off something required', () => {
        // Even with a mute row present. `alwaysSent` carries no state at all,
        // so there is nothing for a stale row to flip.
        const m = buildScreenModel('client', new Set(['report-ready:email']));
        expect(m.alwaysSent.map((r) => r.id)).toContain('report-ready');
        expect(m.youChoose.map((r) => r.id)).not.toContain('report-ready');
    });
});

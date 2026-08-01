/**
 * The send boundary has to know WHAT it is sending.
 *
 * `sendEmail(to, subject, html)` carries an address and a rendered string. That
 * is enough to deliver and not enough to decide: "an email to jane@x.com"
 * cannot be matched against "Jane muted review requests", so a preference check
 * placed at the boundary would have nothing to check. Enforcement lands with
 * the preference table; this spec pins the seam that makes it possible.
 *
 * The risk being designed out is not "someone forgets to pass a class" — it is
 * "someone passes the WRONG one". ~20 mixin call sites each render a trigger
 * and then send; if the class were a separate argument, each site could name a
 * template it did not render, and nothing would catch it. `sendRendered()`
 * derives the class from the same trigger that produced the body, so the two
 * cannot disagree.
 */
import { describe, it, expect } from 'vitest';
import { EmailBaseService } from '../../../server/services/email/base';
import type { RenderResult } from '../../../server/lib/email-templates/types';

type Captured = { to: string[]; subject: string; html: string; classId?: string };

/** Exposes the protected seam and records what reached `sendEmail`. */
class Probe extends EmailBaseService {
    captured: Captured[] = [];

    constructor() {
        super('a_real_key', 'from@x.com', 'Acme');
    }

    override async sendEmail(
        to: string[], subject: string, html: string,
        _attachments?: Array<{ filename: string; content: ArrayBuffer | string; contentType?: string }>,
        opts?: { classId?: string },
    ): Promise<{ delivered: boolean }> {
        this.captured.push({ to, subject, html, classId: opts?.classId });
        return { delivered: true };
    }

    send(rendered: RenderResult) {
        return this.sendRendered(rendered, ['jane@x.com']);
    }
}

const rendered = (trigger: string, over: Partial<RenderResult> = {}): RenderResult =>
    ({ trigger, subject: 'Your report is ready', html: '<p>hi</p>', enabled: true, ...over });

describe('class-carrying send boundary', () => {
    it('carries the class to the boundary, not just an address and a string', () => {
        const p = new Probe();
        p.send(rendered('report-ready'));
        expect(p.captured[0].classId).toBe('report-ready');
    });

    it('takes the class from the render result, so it cannot name a template it did not render', () => {
        // The trigger is not a parameter of sendRendered — it rides inside the
        // RenderResult. A caller has no argument through which to declare a
        // different class from the one that produced the body.
        const p = new Probe();
        p.send(rendered('payment-request', { subject: 'Invoice' }));
        expect(p.captured[0].classId).toBe('payment-request');
        expect(p.captured[0].subject).toBe('Invoice');
    });

    it('keeps the class when a caller appends to the body', () => {
        // booking-confirmation spreads its result to append the SMS opt-in block.
        // Rebuilding the object instead of spreading would silently drop the
        // trigger and turn a classified send into an unclassified one.
        const p = new Probe();
        const base = rendered('booking-confirmation');
        p.send({ ...base, html: `${base.html}<p>opt in</p>` });
        expect(p.captured[0].classId).toBe('booking-confirmation');
        expect(p.captured[0].html).toContain('opt in');
    });

    it('still delivers subject, body and recipients unchanged', () => {
        const p = new Probe();
        p.send(rendered('booking-confirmation', { subject: 'S', html: '<b>B</b>' }));
        expect(p.captured[0]).toMatchObject({ to: ['jane@x.com'], subject: 'S', html: '<b>B</b>' });
    });

    it('leaves the class absent for a caller that did not name one — unclassified, never silently muted', () => {
        // An unclassified send must remain SENDABLE (it goes out) while being
        // un-mutable, per `isSuppressible`'s fail-closed default. A boundary that
        // dropped unclassified mail would turn a missing annotation into lost
        // notifications.
        const p = new Probe();
        p.sendEmail(['jane@x.com'], 'Ad-hoc', '<p>x</p>');
        expect(p.captured[0].classId).toBeUndefined();
    });
});

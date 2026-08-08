// @vitest-environment happy-dom
/**
 * OI #271 condition 6 — what the inspector sees, and the two sentences the
 * product must never say.
 *
 * The regressions these guard are behavioural, not cosmetic:
 *
 *  1. **"Not yet opened" on a notice that has not been sent.** The automation
 *     ledger hides future-dated rows, so a two-state UI has no way to tell
 *     "sent and unread" from "not sent yet" and picks the accusatory one. A
 *     queued row must show a send TIME and no open status at all.
 *  2. **"Opened" presented as proof.** LIA §3.4(a): a mail-security gateway
 *     issuing a plain GET is indistinguishable from a reader, so the surface
 *     carries the caveat rather than letting a number speak for itself.
 *  3. **A chart.** The LIA's purpose test passes for the delivery question and
 *     for nothing else; a visualisation is a different purpose needing its own
 *     assessment. Asserted as an absence, because "we decided not to" is
 *     exactly the kind of decision a later redesign reverses by accident.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ReportDeliveryList } from './ReportDeliveryList';
import type { ReportLinkRow } from '~/lib/communication-view';

const AUG7 = Date.parse('2026-08-07T15:00:00Z');
const HOUR = 3_600_000;

function row(over: Partial<ReportLinkRow> = {}): ReportLinkRow {
    return {
        accessTokenId: 't1',
        recipient: 'client@x.com',
        roleKey: 'client',
        roleLabel: 'Client',
        state: 'delivered',
        scheduledAt: null,
        sentAt: AUG7 - 2 * HOUR,
        viewCount: 0,
        firstViewedAt: null,
        lastViewedAt: null,
        trackingObjected: false,
        ...over,
    };
}

const mount = (rows: ReportLinkRow[]) =>
    render(<ReportDeliveryList rows={rows} timeZone="UTC" locale="en-US" />);

describe('<ReportDeliveryList>', () => {
    it('renders nothing when no report has been sent or opened', () => {
        expect(mount([]).container.firstChild).toBeNull();
    });

    it('a QUEUED notice says when it will send, and claims nothing about opening', () => {
        const text = mount([row({ state: 'queued', sentAt: null, scheduledAt: AUG7 + 5 * HOUR })])
            .container.textContent ?? '';
        expect(text).toMatch(/Scheduled to send/i);
        // The whole reason the third state exists.
        expect(text).not.toMatch(/opened/i);
    });

    it('a DELIVERED, unopened notice pairs the two facts in one line', () => {
        const text = mount([row()]).container.textContent ?? '';
        expect(text).toMatch(/Delivered/i);
        expect(text).toMatch(/not yet opened/i);
    });

    it('an OPENED report reports the count and both timestamps', () => {
        const text = mount([row({
            state: 'opened', viewCount: 3,
            firstViewedAt: AUG7 - HOUR, lastViewedAt: AUG7,
        })]).container.textContent ?? '';
        expect(text).toMatch(/Opened 3 times/i);
        expect(text).toMatch(/first/i);
        expect(text).toMatch(/last/i);
    });

    it('says "once" rather than "1 times", and drops the redundant second date', () => {
        const text = mount([row({
            state: 'opened', viewCount: 1,
            firstViewedAt: AUG7 - HOUR, lastViewedAt: AUG7 - HOUR,
        })]).container.textContent ?? '';
        expect(text).toMatch(/Opened once/i);
        expect(text).not.toMatch(/last/i);
    });

    it('never lets a zero read as a fact about a recipient who objected', () => {
        // Art. 21 suppression: the count is zero because we stopped counting.
        const text = mount([row({ trackingObjected: true })]).container.textContent ?? '';
        expect(text).toMatch(/asked not to be counted/i);
    });

    it('carries the "signal, not proof" caveat whenever it shows an open', () => {
        const text = mount([row({ state: 'opened', viewCount: 2, firstViewedAt: AUG7, lastViewedAt: AUG7 })])
            .container.textContent ?? '';
        expect(text).toMatch(/not proof/i);
    });

    it('draws no chart', () => {
        const { container } = mount([
            row({ state: 'opened', viewCount: 9, firstViewedAt: AUG7, lastViewedAt: AUG7 }),
            row({ accessTokenId: 't2', recipient: 'agent@x.com', state: 'delivered' }),
        ]);
        expect(container.querySelector('svg')).toBeNull();
        expect(container.querySelector('canvas')).toBeNull();
        // No bar/meter either — a width-driven div is a chart with extra steps.
        expect(container.querySelector('[role="progressbar"]')).toBeNull();
    });

    it('names the recipient and their role, so two people are two lines', () => {
        const text = mount([
            row(),
            row({ accessTokenId: 't2', recipient: 'agent@x.com', roleKey: 'buyer_agent', roleLabel: "Buyer's Agent" }),
        ]).container.textContent ?? '';
        expect(text).toContain('client@x.com');
        expect(text).toContain('agent@x.com');
        expect(text).toContain("Buyer's Agent");
    });
});

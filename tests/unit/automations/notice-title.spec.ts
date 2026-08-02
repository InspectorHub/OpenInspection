/**
 * The stored notice titles are the last user-facing English literals in
 * `server/`. This spec is what stops them being re-hardcoded: it asserts the
 * CATALOG holds them, so a future edit that inlines a string again fails here
 * rather than silently removing a translatable key.
 *
 * Note the two families in `messages/en/communication.json`, which look like
 * duplicates and are not:
 *   `notice_title_*`      — recipient voice, no address ("Your inspection
 *                           report is ready"). Rendered by `noticeTitle()` in
 *                           `app/lib/notice-view.ts` for types it recognises.
 *   `comm_notice_title_*` — staff/ledger voice, address included ("Report
 *                           published — 12 Oak St"). What `titleFor` STORES on
 *                           the row, and what the Outbox shows.
 * The same `comm_` / `notice_` split already distinguishes
 * `comm_reason_sms_opt_out` from `notice_reason_sms_opt_out`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { m } from '../../../server/lib/i18n/messages';

describe('notice titles come from the message catalog', () => {
    const address = '12 Oak St';

    it('renders each event title from a message key', () => {
        expect(m.comm_notice_title_inspection_created({ address }))
            .toBe(`New inspection scheduled — ${address}`);
        expect(m.comm_notice_title_inspection_confirmed({ address }))
            .toBe(`Inspection confirmed — ${address}`);
        expect(m.comm_notice_title_inspection_cancelled({ address }))
            .toBe(`Inspection cancelled — ${address}`);
        expect(m.comm_notice_title_report_published({ address }))
            .toBe(`Report published — ${address}`);
        expect(m.comm_notice_title_invoice_created({ address }))
            .toBe(`Invoice created — ${address}`);
        expect(m.comm_notice_title_payment_received({ address }))
            .toBe(`Payment received — ${address}`);
    });

    it('renders the unknown-event fallback from a message key', () => {
        expect(m.comm_notice_title_generic({ event: 'report.amended', address }))
            .toBe(`report.amended — ${address}`);
    });

    it('trigger.ts holds no bare notice-title literal', () => {
        const src = readFileSync(
            new URL('../../../server/services/automation/trigger.ts', import.meta.url),
            'utf8',
        );
        // The em dash is the tell: every stored notice title is
        // "<something> — <address>".
        const bare = src.match(/return\s+`[^`]*—[^`]*`/g) ?? [];
        expect(bare).toEqual([]);
    });
});

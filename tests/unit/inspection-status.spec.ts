import { describe, it, expect } from 'vitest';
import { getInspectionStatusIcons } from '../../server/lib/inspection-status';

describe('Round-2 F2 — getInspectionStatusIcons', () => {
    it('returns all-false for a draft inspection with no flags', () => {
        const icons = getInspectionStatusIcons({ status: 'draft' });
        expect(icons).toEqual({
            reportReady:     false,
            agreementSigned: false,
            sent:            false,
            flagged:         false,
        });
    });

    it('marks reportReady when status is completed (not yet sent)', () => {
        const icons = getInspectionStatusIcons({ status: 'completed' });
        expect(icons.reportReady).toBe(true);
        expect(icons.sent).toBe(false);
    });

    it('marks both reportReady and sent when status is delivered', () => {
        const icons = getInspectionStatusIcons({ status: 'delivered' });
        expect(icons.reportReady).toBe(true);
        expect(icons.sent).toBe(true);
    });

    it('agreementSigned + flagged independent of status', () => {
        const icons = getInspectionStatusIcons({
            status: 'in_progress',
            agreementSigned: true,
            flagged: true,
        });
        expect(icons.agreementSigned).toBe(true);
        expect(icons.flagged).toBe(true);
        expect(icons.reportReady).toBe(false);
        expect(icons.sent).toBe(false);
    });

    it('treats missing fields as false (defensive)', () => {
        const icons = getInspectionStatusIcons({});
        expect(icons).toEqual({
            reportReady:     false,
            agreementSigned: false,
            sent:            false,
            flagged:         false,
        });
    });

    it('handles cancelled status — no green flags', () => {
        const icons = getInspectionStatusIcons({ status: 'cancelled' });
        expect(icons.reportReady).toBe(false);
        expect(icons.sent).toBe(false);
    });

    it('case-insensitive status matching', () => {
        const icons = getInspectionStatusIcons({ status: 'DELIVERED' });
        expect(icons.reportReady).toBe(true);
        expect(icons.sent).toBe(true);
    });

    it('matrix — every status combination', () => {
        const cases: Array<[string, boolean, boolean]> = [
            // status, expected reportReady, expected sent
            ['draft',       false, false],
            ['scheduled',   false, false],
            ['confirmed',   false, false],
            ['in_progress', false, false],
            ['completed',   true,  false],
            ['delivered',   true,  true ],
            ['cancelled',   false, false],
        ];
        for (const [status, ready, sent] of cases) {
            const icons = getInspectionStatusIcons({ status });
            expect(icons.reportReady, `${status} reportReady`).toBe(ready);
            expect(icons.sent, `${status} sent`).toBe(sent);
        }
    });
});

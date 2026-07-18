/**
 * A-polish 10b.2 — googleCalendarProvider.listCalendars maps the Google
 * calendarList into the { id, summary, accessRole, primary } shape the read-set
 * picker consumes, dropping malformed entries.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../server/lib/google-calendar', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/google-calendar')>();
    return { ...actual, refreshAccessToken: vi.fn().mockResolvedValue('access-token') };
});

import { googleCalendarProvider } from '../../../server/lib/calendar/google';

describe('googleCalendarProvider.listCalendars', () => {
    afterEach(() => vi.restoreAllMocks());

    it('maps calendarList items and drops entries without an id', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({
                items: [
                    { id: 'primary', summary: 'Me', accessRole: 'owner', primary: true },
                    { id: 'work@grp', summary: 'Work', accessRole: 'writer' },
                    { id: 'shared@grp', summary: 'Shared', accessRole: 'reader' },
                    { summary: 'no-id-dropped' },
                ],
            }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        const cals = await googleCalendarProvider.listCalendars({
            clientId: 'c', clientSecret: 's', refreshToken: 'r',
        });

        expect(cals).toEqual([
            { id: 'primary', summary: 'Me', accessRole: 'owner', primary: true },
            { id: 'work@grp', summary: 'Work', accessRole: 'writer', primary: false },
            { id: 'shared@grp', summary: 'Shared', accessRole: 'reader', primary: false },
        ]);
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/users/me/calendarList'),
            expect.anything(),
        );
    });

    it('throws on a non-ok response', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 401 } as any);
        await expect(
            googleCalendarProvider.listCalendars({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }),
        ).rejects.toThrow(/Failed to fetch Google calendar list/);
    });
});

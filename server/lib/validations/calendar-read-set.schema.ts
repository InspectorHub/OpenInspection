import { z } from '@hono/zod-openapi';

/** A-polish 10b.3 — body for PUT /api/calendar/connections/:id/calendars. */
export const SaveReadSetSchema = z.object({
    readCalendarIds: z.array(z.string().min(1)).min(1),
    writeCalendarId: z.string().min(1),
});

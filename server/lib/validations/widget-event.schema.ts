import { z } from '@hono/zod-openapi';

/**
 * The details a widget event may carry. The beacon is public, so what it can store is bounded: a few keys, short keys, and scalar values
 * of limited length. Nested objects and arrays are not accepted; a widget that wants more should send fewer, clearer events.
 */
export const WIDGET_EVENT_MAX_KEYS = 10;

export const WidgetEventMetadataSchema = z
    .record(z.string().max(64), z.union([z.string().max(200), z.number(), z.boolean(), z.null()]))
    .refine((value) => Object.keys(value).length <= WIDGET_EVENT_MAX_KEYS, { message: `At most ${WIDGET_EVENT_MAX_KEYS} keys.` });

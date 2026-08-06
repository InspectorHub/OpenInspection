import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { checkRateLimit } from '../../lib/rate-limit';
import { logger } from '../../lib/logger';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

// Public address autocomplete sub-router. Extracted from bookings.ts
// unchanged, to make room in that file for the propertyZip query param the
// slots route now forwards — the two are the same feature seen from both
// ends: this route hands the browser a placeId + ZIP, and the slots route
// is where that ZIP finally does something.

/**
 * Sprint 1 C-5 — Public address autocomplete proxy for the unauthenticated
 * /book page. The internal `/api/places/autocomplete` endpoint is JWT-gated,
 * so we expose a thin public forwarder here with three guarantees:
 *
 *   1. Token never leaves the worker (kept off the wire entirely).
 *   2. If no token is configured, returns `{ data: [], reason: 'NO_API_KEY' }`
 *      and the client falls back silently to plain-text input.
 *   3. Rate-limited via the shared booking rate limiter to deter scraping.
 *
 * This implementation uses Google Places (existing `GOOGLE_PLACES_API_KEY`
 * binding) — same upstream that powers the dashboard's authenticated
 * autocomplete. The plan language uses "Mapbox" as a placeholder for any
 * geocoder; we align with the existing infrastructure.
 */
const publicGeocodeRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/geocode',
    tags: ["bookings", "public"],
    summary: 'Address autocomplete proxy (public, rate-limited)',
    request: {
        query: z.object({
            q: z.string().min(1).max(200).openapi({ example: '1005 S Gay' }).describe('TODO describe q field for the OpenInspection MCP integration'),
        }).describe('TODO describe query field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        data: z.array(z.object({
                            label:   z.string().describe('TODO describe label field for the OpenInspection MCP integration'),
                            line1:   z.string().describe('TODO describe line1 field for the OpenInspection MCP integration'),
                            city:    z.string().nullable().describe('TODO describe city field for the OpenInspection MCP integration'),
                            state:   z.string().nullable().describe('TODO describe state field for the OpenInspection MCP integration'),
                            zip:     z.string().nullable().describe('TODO describe zip field for the OpenInspection MCP integration'),
                            placeId: z.string().describe('TODO describe placeId field for the OpenInspection MCP integration'),
                        })).describe('TODO describe data field for the OpenInspection MCP integration'),
                        reason: z.enum(['NO_API_KEY', 'UPSTREAM_ERROR']).optional().describe('TODO describe reason field for the OpenInspection MCP integration'),
                    }),
                },
            },
            description: 'Autocomplete suggestions or fallback reason',
        },
    },
    operationId: "geocodeBooking",
    description: "Auto-generated placeholder for geocodeBooking (GET /geocode, bookings domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

const publicGeocodeRoutes = createApiRouter()
    .openapi(publicGeocodeRoute, async (c) => {
        await checkRateLimit(c, 'book');
        const { q } = c.req.valid('query');
        if (q.length < 3) {
            return c.json({ success: true, data: [] }, 200);
        }
        const apiKey = c.env.GOOGLE_PLACES_API_KEY;
        if (!apiKey) {
            return c.json({ success: true, data: [], meta: { reason: 'NO_API_KEY' as const } }, 200);
        }

        try {
            const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
            url.searchParams.set('input', q);
            url.searchParams.set('types', 'address');
            url.searchParams.set('components', 'country:us');
            url.searchParams.set('key', apiKey);
            const res = await fetch(url.toString());
            if (!res.ok) {
                logger.warn('[public.geocode] upstream error', { status: res.status });
                return c.json({ success: true, data: [], meta: { reason: 'UPSTREAM_ERROR' as const } }, 200);
            }
            const j = await res.json() as {
                status: string;
                predictions?: Array<{
                    place_id: string;
                    description: string;
                    terms?: Array<{ value: string }>;
                    structured_formatting?: { main_text?: string; secondary_text?: string };
                }>;
            };
            if (j.status !== 'OK' && j.status !== 'ZERO_RESULTS') {
                logger.warn('[public.geocode] upstream status', { status: j.status });
                return c.json({ success: true, data: [], meta: { reason: 'UPSTREAM_ERROR' as const } }, 200);
            }
            // Best-effort split of secondary_text into city / state / zip — Google
            // Places returns "City, ST 12345" for US addresses. We do a lenient
            // regex split; clients should treat these as hints, not authoritative.
            const data = (j.predictions ?? []).slice(0, 5).map(p => {
                const main = p.structured_formatting?.main_text || p.description;
                const secondary = p.structured_formatting?.secondary_text || '';
                const m = secondary.match(/^([^,]+),\s*([A-Z]{2})\s*(\d{5})?/);
                return {
                    label:   p.description,
                    line1:   main,
                    city:    m?.[1] ?? null,
                    state:   m?.[2] ?? null,
                    zip:     m?.[3] ?? null,
                    placeId: p.place_id,
                };
            });
            return c.json({ success: true, data }, 200);
        } catch (e) {
            logger.error('[public.geocode] exception', {}, e instanceof Error ? e : undefined);
            return c.json({ success: true, data: [], meta: { reason: 'UPSTREAM_ERROR' as const } }, 200);
        }
    })
;

export default publicGeocodeRoutes;

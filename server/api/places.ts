import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import { fetchPlaceDetails, placeDetailsCacheKey, type ResolvedPlace } from '../lib/places/geocode';

/**
 * Spec 5D — Address Autofill (Phase 1) — server-side proxy for the
 * Google Places API.
 *
 * Why proxy: keeps GOOGLE_PLACES_API_KEY off the client where it would
 * be visible in DevTools / scrapers. Worker holds the secret; browser
 * only ever talks to /api/places/*.
 *
 * Caching: TENANT_CACHE KV. Autocomplete by sha256 of query (1h TTL —
 * suggestion list churn is fine on the hour). Details by placeId
 * (60d TTL — place metadata is stable).
 *
 * Session-token billing optimization: client generates a UUID on
 * modal-open, sends it as `session` on every keystroke autocomplete +
 * the final details fetch. Google bills the whole sequence as ONE
 * Autocomplete session (~$0.017) instead of one per keystroke. The
 * proxy passes the `sessiontoken` straight through to Google.
 */
const GOOGLE_BASE = 'https://maps.googleapis.com/maps/api/place';

async function sha256Hex(input: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── GET /api/places/autocomplete ───────────────────────────────────────────
const autocompleteRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/autocomplete',
    tags: ["bookings"],
    summary: 'Address autocomplete (Google Places proxy)',
    request: {
        query: z.object({
            q: z.string().min(2).max(200).openapi({ example: '1005 S Gay' }).describe('TODO describe q field for the OpenInspection MCP integration'),
            session: z.string().min(8).max(128).openapi({ example: '550e8400-e29b-41d4-a716-446655440099' }).describe('TODO describe session field for the OpenInspection MCP integration'),
        }).describe('TODO describe query field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.literal(true),
                data: z.array(z.object({
                    placeId: z.string().describe('TODO describe placeId field for the OpenInspection MCP integration'),
                    description: z.string().describe('TODO describe description field for the OpenInspection MCP integration'),
                    mainText: z.string().describe('TODO describe mainText field for the OpenInspection MCP integration'),
                    secondaryText: z.string().describe('TODO describe secondaryText field for the OpenInspection MCP integration'),
                })).describe('TODO describe data field for the OpenInspection MCP integration'),
                meta: z.object({
                    cached: z.boolean().describe('TODO describe cached field for the OpenInspection MCP integration'),
                }),
            }) } },
            description: 'Autocomplete suggestions',
        },
    },
    operationId: "autocompletePlace",
    description: "Auto-generated placeholder for autocompletePlace (GET /autocomplete, bookings domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

// ── GET /api/places/details ────────────────────────────────────────────────
const detailsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/details',
    tags: ["bookings"],
    summary: 'Address details (Google Places Details proxy)',
    request: {
        query: z.object({
            placeId: z.string().min(8).max(200).openapi({ example: 'ChIJxxx' }).describe('TODO describe placeId field for the OpenInspection MCP integration'),
            session: z.string().min(8).max(128).openapi({ example: '550e8400-e29b-41d4-a716-446655440099' }).describe('TODO describe session field for the OpenInspection MCP integration'),
        }).describe('TODO describe query field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.literal(true),
                data: z.object({
                    placeId: z.string().describe('TODO describe placeId field for the OpenInspection MCP integration'),
                    formatted: z.string().describe('TODO describe formatted field for the OpenInspection MCP integration'),
                    street: z.string().nullable().describe('TODO describe street field for the OpenInspection MCP integration'),
                    city: z.string().nullable().describe('TODO describe city field for the OpenInspection MCP integration'),
                    state: z.string().nullable().describe('TODO describe state field for the OpenInspection MCP integration'),
                    zip: z.string().nullable().describe('TODO describe zip field for the OpenInspection MCP integration'),
                    county: z.string().nullable().describe('TODO describe county field for the OpenInspection MCP integration'),
                    lat: z.number().describe('TODO describe lat field for the OpenInspection MCP integration'),
                    lng: z.number().describe('TODO describe lng field for the OpenInspection MCP integration'),
                }),
                meta: z.object({
                    cached: z.boolean().describe('TODO describe cached field for the OpenInspection MCP integration'),
                }),
            }).describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Place details',
        },
    },
    operationId: "listPlaceDetails",
    description: "Auto-generated placeholder for listPlaceDetails (GET /details, bookings domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

const placesRoutes = createApiRouter()
    .openapi(autocompleteRoute, async (c) => {
    const apiKey = c.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw Errors.BadRequest('Address autocomplete unavailable: GOOGLE_PLACES_API_KEY not configured');

    const { q, session } = c.req.valid('query');
    const cacheKey = `places:auto:${await sha256Hex(q.toLowerCase().trim())}`;

    if (c.env.TENANT_CACHE) {
        const cached = await c.env.TENANT_CACHE.get(cacheKey, 'json') as {
            results: Array<{ placeId: string; description: string; mainText: string; secondaryText: string }>
        } | null;
        if (cached) {
            return c.json({ success: true, data: cached.results, meta: { cached: true } }, 200);
        }
    }

    const url = new URL(`${GOOGLE_BASE}/autocomplete/json`);
    url.searchParams.set('input', q);
    url.searchParams.set('sessiontoken', session);
    url.searchParams.set('types', 'address');
    url.searchParams.set('components', 'country:us');
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
        logger.error('[places.autocomplete] google api error', { status: res.status });
        throw Errors.BadRequest('Autocomplete temporarily unavailable');
    }
    const data = await res.json() as {
        status: string;
        predictions?: Array<{
            place_id: string;
            description: string;
            structured_formatting?: { main_text?: string; secondary_text?: string };
        }>;
    };

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        logger.error('[places.autocomplete] google api status', { status: data.status });
        throw Errors.BadRequest('Autocomplete failed');
    }

    const results = (data.predictions || []).map(p => ({
        placeId: p.place_id,
        description: p.description,
        mainText: p.structured_formatting?.main_text || p.description,
        secondaryText: p.structured_formatting?.secondary_text || '',
    }));

    if (c.env.TENANT_CACHE) {
        await c.env.TENANT_CACHE.put(cacheKey, JSON.stringify({ results }), { expirationTtl: 60 * 60 });
    }

    return c.json({ success: true, data: results, meta: { cached: false } }, 200);
})
    .openapi(detailsRoute, async (c) => {
    const apiKey = c.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw Errors.BadRequest('Address details unavailable: GOOGLE_PLACES_API_KEY not configured');

    const { placeId, session } = c.req.valid('query');
    const cacheKey = placeDetailsCacheKey(placeId);

    if (c.env.TENANT_CACHE) {
        const cached = await c.env.TENANT_CACHE.get(cacheKey, 'json') as ResolvedPlace | null;
        if (cached) {
            return c.json({ success: true, data: cached, meta: { cached: true } }, 200);
        }
    }

    // The fetch + field mask + component mapping live in lib/places/geocode.ts
    // so booking fulfilment and Settings can geocode too — this route was the
    // only way to reach that logic, which is exactly why nothing else did.
    const payload = await fetchPlaceDetails(apiKey, placeId, session);
    if (!payload) throw Errors.BadRequest('Address details temporarily unavailable');

    if (c.env.TENANT_CACHE) {
        await c.env.TENANT_CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: 60 * 24 * 60 * 60 });
    }

    return c.json({ success: true, data: payload, meta: { cached: false } }, 200);
});

export type PlacesApi = typeof placesRoutes;

export default placesRoutes;

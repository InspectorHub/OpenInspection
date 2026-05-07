import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HonoConfig } from '../types/hono';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';

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
const placesRoutes = new OpenAPIHono<HonoConfig>();

const GOOGLE_BASE = 'https://maps.googleapis.com/maps/api/place';

async function sha256Hex(input: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── GET /api/places/autocomplete ───────────────────────────────────────────
const autocompleteRoute = createRoute({
    method: 'get',
    path: '/autocomplete',
    tags: ['Places'],
    summary: 'Address autocomplete (Google Places proxy)',
    request: {
        query: z.object({
            q: z.string().min(2).max(200).openapi({ example: '1005 S Gay' }),
            session: z.string().min(8).max(128).openapi({ example: '550e8400-e29b-41d4-a716-446655440099' }),
        }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                results: z.array(z.object({
                    placeId: z.string(),
                    description: z.string(),
                    mainText: z.string(),
                    secondaryText: z.string(),
                })),
                cached: z.boolean(),
            }) } },
            description: 'Autocomplete suggestions',
        },
    },
});

placesRoutes.openapi(autocompleteRoute, async (c) => {
    const apiKey = c.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw Errors.BadRequest('Address autocomplete unavailable: GOOGLE_PLACES_API_KEY not configured');

    const { q, session } = c.req.valid('query');
    const cacheKey = `places:auto:${await sha256Hex(q.toLowerCase().trim())}`;

    if (c.env.TENANT_CACHE) {
        const cached = await c.env.TENANT_CACHE.get(cacheKey, 'json') as {
            results: Array<{ placeId: string; description: string; mainText: string; secondaryText: string }>
        } | null;
        if (cached) {
            return c.json({ results: cached.results, cached: true }, 200);
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

    return c.json({ results, cached: false }, 200);
});

// ── GET /api/places/details ────────────────────────────────────────────────
const detailsRoute = createRoute({
    method: 'get',
    path: '/details',
    tags: ['Places'],
    summary: 'Address details (Google Places Details proxy)',
    request: {
        query: z.object({
            placeId: z.string().min(8).max(200).openapi({ example: 'ChIJxxx' }),
            session: z.string().min(8).max(128).openapi({ example: '550e8400-e29b-41d4-a716-446655440099' }),
        }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                placeId: z.string(),
                formatted: z.string(),
                street: z.string().nullable(),
                city: z.string().nullable(),
                state: z.string().nullable(),
                zip: z.string().nullable(),
                county: z.string().nullable(),
                lat: z.number(),
                lng: z.number(),
                cached: z.boolean(),
            }) } },
            description: 'Place details',
        },
    },
});

placesRoutes.openapi(detailsRoute, async (c) => {
    const apiKey = c.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw Errors.BadRequest('Address details unavailable: GOOGLE_PLACES_API_KEY not configured');

    const { placeId, session } = c.req.valid('query');
    const cacheKey = `places:detail:${placeId}`;

    if (c.env.TENANT_CACHE) {
        const cached = await c.env.TENANT_CACHE.get(cacheKey, 'json') as {
            placeId: string; formatted: string;
            street: string | null; city: string | null; state: string | null;
            zip: string | null; county: string | null;
            lat: number; lng: number;
        } | null;
        if (cached) {
            return c.json({ ...cached, cached: true }, 200);
        }
    }

    const url = new URL(`${GOOGLE_BASE}/details/json`);
    url.searchParams.set('place_id', placeId);
    url.searchParams.set('sessiontoken', session);
    // Tight field mask — billed per-field-per-call.
    url.searchParams.set('fields', 'place_id,formatted_address,address_components,geometry/location');
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
        logger.error('[places.details] google api error', { status: res.status });
        throw Errors.BadRequest('Address details temporarily unavailable');
    }
    const data = await res.json() as {
        status: string;
        result?: {
            place_id: string;
            formatted_address: string;
            address_components: Array<{ long_name: string; short_name: string; types: string[] }>;
            geometry: { location: { lat: number; lng: number } };
        };
    };

    if (data.status !== 'OK' || !data.result) {
        logger.error('[places.details] google api status', { status: data.status });
        throw Errors.BadRequest('Address details failed');
    }

    const r = data.result;
    const partOf = (type: string, useShort = false): string | null => {
        const c = r.address_components.find(x => x.types.includes(type));
        return c ? (useShort ? c.short_name : c.long_name) : null;
    };

    const streetNumber = partOf('street_number');
    const route = partOf('route');
    const street = streetNumber && route ? `${streetNumber} ${route}` : (route || null);

    const payload = {
        placeId: r.place_id,
        formatted: r.formatted_address,
        street,
        city: partOf('locality') || partOf('sublocality') || partOf('administrative_area_level_3'),
        state: partOf('administrative_area_level_1', true),
        zip: partOf('postal_code'),
        county: partOf('administrative_area_level_2'),
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
    };

    if (c.env.TENANT_CACHE) {
        await c.env.TENANT_CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: 60 * 24 * 60 * 60 });
    }

    return c.json({ ...payload, cached: false }, 200);
});

export default placesRoutes;

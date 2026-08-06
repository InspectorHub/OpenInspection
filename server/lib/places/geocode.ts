import { logger } from '../logger';

/**
 * Server-side Google Places resolution, shared by everything that needs
 * coordinates rather than a string.
 *
 * This used to exist ONLY inside the `/api/places/details` route handler, and
 * that is the whole reason the booking pipeline had no geocode: the capability
 * was built, it was correct, and nothing outside one JWT-gated HTTP route
 * could reach it. Three callers now do — the details route itself, public
 * booking fulfilment (placeId -> the property's coordinates), and Settings
 * (company address text -> the workspace's coordinates).
 *
 * Every function here is FAIL-SOFT and returns null on any failure. A geocode
 * is an enrichment: a booking that cannot be located must still be a booking.
 * The callers turn a null into a NAMED, logged outcome rather than into a
 * zeroed coordinate.
 */
const GOOGLE_BASE = 'https://maps.googleapis.com/maps/api/place';

export interface ResolvedPlace {
    placeId: string;
    formatted: string;
    street: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    county: string | null;
    lat: number;
    lng: number;
}

interface GoogleDetailsResult {
    place_id: string;
    formatted_address: string;
    address_components: Array<{ long_name: string; short_name: string; types: string[] }>;
    geometry: { location: { lat: number; lng: number } };
}

/** Shape the Google details payload into our stored fields. */
function toResolvedPlace(r: GoogleDetailsResult): ResolvedPlace {
    const partOf = (type: string, useShort = false): string | null => {
        const c = r.address_components.find(x => x.types.includes(type));
        return c ? (useShort ? c.short_name : c.long_name) : null;
    };
    const streetNumber = partOf('street_number');
    const route = partOf('route');
    return {
        placeId: r.place_id,
        formatted: r.formatted_address,
        street: streetNumber && route ? `${streetNumber} ${route}` : (route || null),
        city: partOf('locality') || partOf('sublocality') || partOf('administrative_area_level_3'),
        state: partOf('administrative_area_level_1', true),
        zip: partOf('postal_code'),
        county: partOf('administrative_area_level_2'),
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
    };
}

/** Details cache key. Shared with the route so both sides hit the same entry. */
export function placeDetailsCacheKey(placeId: string): string {
    return `places:detail:${placeId}`;
}

/**
 * Resolve one placeId to a full structured address.
 *
 * @param session Google session token. Optional: the booking/settings callers
 *                have no typing session to bill against and pass nothing,
 *                which Google treats as a standalone Details call.
 * @throws never — returns null and logs.
 */
export async function fetchPlaceDetails(
    apiKey: string,
    placeId: string,
    session?: string,
): Promise<ResolvedPlace | null> {
    try {
        const url = new URL(`${GOOGLE_BASE}/details/json`);
        url.searchParams.set('place_id', placeId);
        if (session) url.searchParams.set('sessiontoken', session);
        // Tight field mask — billed per-field-per-call.
        url.searchParams.set('fields', 'place_id,formatted_address,address_components,geometry/location');
        url.searchParams.set('key', apiKey);

        const res = await fetch(url.toString());
        if (!res.ok) {
            logger.warn('[places.geocode] details upstream error', { status: res.status });
            return null;
        }
        const data = await res.json() as { status: string; result?: GoogleDetailsResult };
        if (data.status !== 'OK' || !data.result) {
            logger.warn('[places.geocode] details upstream status', { status: data.status });
            return null;
        }
        return toResolvedPlace(data.result);
    } catch (e) {
        logger.error('[places.geocode] details exception', {}, e instanceof Error ? e : undefined);
        return null;
    }
}

/**
 * Resolve free-text address to coordinates: autocomplete for a placeId, then
 * details for the geometry. Used for the company address, which a workspace
 * types as prose in Settings and has done for as long as the field existed.
 *
 * The FIRST prediction is taken. That is a real limitation and it is stated in
 * the UI rather than hidden: Settings shows the formatted address that was
 * resolved, so an owner can see when Google picked the wrong "Main St".
 */
export async function geocodeAddressText(
    apiKey: string,
    text: string,
): Promise<ResolvedPlace | null> {
    const q = text.trim();
    if (q.length < 5) return null;
    try {
        const url = new URL(`${GOOGLE_BASE}/autocomplete/json`);
        url.searchParams.set('input', q);
        url.searchParams.set('types', 'address');
        url.searchParams.set('key', apiKey);
        const res = await fetch(url.toString());
        if (!res.ok) {
            logger.warn('[places.geocode] autocomplete upstream error', { status: res.status });
            return null;
        }
        const j = await res.json() as { status: string; predictions?: Array<{ place_id: string }> };
        const placeId = j.predictions?.[0]?.place_id;
        if (!placeId) {
            logger.info('[places.geocode] no prediction for address text', { status: j.status });
            return null;
        }
        return await fetchPlaceDetails(apiKey, placeId);
    } catch (e) {
        logger.error('[places.geocode] autocomplete exception', {}, e instanceof Error ? e : undefined);
        return null;
    }
}

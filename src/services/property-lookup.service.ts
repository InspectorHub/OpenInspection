/**
 * Sprint 3 S3-1 — PropertyLookupService.
 *
 * Server-side proxy for Estated.io public-records API. Fetches property
 * facts (year built, sqft, foundation, lot size, bedrooms, bathrooms)
 * by address. Maps the provider response into the existing
 * PropertyFactsSchema so the inline-save handler in
 * inspection-settings.js can patch the inspection without translation.
 *
 * Graceful degrade pattern (matches GooglePlacesService): when
 * `ESTATED_API_KEY` is absent, returns `{ data: null, reason: 'NO_API_KEY' }`
 * and the UI prompts manual entry. We never bubble a 5xx — the user
 * always sees a clean "couldn't auto-fill" state.
 *
 * Provider docs: https://estated.com/docs (Property API v4)
 */
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';

export type FoundationType = 'basement' | 'slab' | 'crawlspace' | 'other';

export interface PropertyFacts {
    yearBuilt?:      number;
    sqft?:           number;
    foundationType?: FoundationType;
    lotSize?:        string;
    bedrooms?:       number;
    bathrooms?:      number;
}

export type LookupReason = 'NO_API_KEY' | 'NOT_FOUND' | 'PROVIDER_ERROR';

export interface LookupResult {
    data:   PropertyFacts | null;
    reason?: LookupReason;
    source?: 'estated';
}

interface PropertyLookupEnv {
    ESTATED_API_KEY?: string | undefined;
}

const ESTATED_API_BASE = 'https://apis.estated.com/v4/property';

const FOUNDATION_MAP: Record<string, FoundationType> = {
    basement:    'basement',
    slab:        'slab',
    crawlspace:  'crawlspace',
    'crawl space': 'crawlspace',
    pier:        'other',
    'pier and beam': 'other',
    other:       'other',
};

function normaliseFoundation(raw: unknown): FoundationType | undefined {
    if (typeof raw !== 'string' || !raw) return undefined;
    const key = raw.trim().toLowerCase();
    return FOUNDATION_MAP[key];
}

interface EstatedV4Response {
    data?: {
        structure?: {
            year_built?:       number | null;
            total_area_sq_ft?: number | null;
            beds_count?:       number | null;
            baths?:            number | null;
            foundation_type?:  string | null;
        };
        parcel?: {
            area_sq_ft?: number | null;
        };
    };
}

/** Format an Estated parcel area into the free-text "lot size" string. */
function formatLotSize(parcelSqFt: number | null | undefined): string | undefined {
    if (typeof parcelSqFt !== 'number' || parcelSqFt <= 0) return undefined;
    // Single-decimal acre conversion when over ~10k sqft (matches inspector
    // mental model — small lots stay in sqft, large lots flip to acres).
    if (parcelSqFt >= 10000) {
        const acres = parcelSqFt / 43560;
        return `${acres.toFixed(2)} acres`;
    }
    return `${parcelSqFt} sqft`;
}

export class PropertyLookupService {
    constructor(private env: PropertyLookupEnv) {}

    /**
     * Resolve property facts for a free-text address. Never throws on
     * provider errors — failures surface via the `reason` field.
     */
    async lookup(addressString: string): Promise<LookupResult> {
        const address = (addressString ?? '').trim();
        if (address.length < 5) throw Errors.BadRequest('Address is too short');

        const apiKey = this.env.ESTATED_API_KEY;
        if (!apiKey) return { data: null, reason: 'NO_API_KEY' };

        let res: Response;
        try {
            const url = `${ESTATED_API_BASE}?token=${encodeURIComponent(apiKey)}&combined_address=${encodeURIComponent(address)}`;
            res = await fetch(url, { method: 'GET' });
        } catch (e) {
            logger.warn('property-lookup.fetch-failed', { error: (e as Error).message });
            return { data: null, reason: 'PROVIDER_ERROR' };
        }

        if (res.status === 404) return { data: null, reason: 'NOT_FOUND' };
        if (!res.ok) {
            logger.warn('property-lookup.provider-error', { status: res.status });
            return { data: null, reason: 'PROVIDER_ERROR' };
        }

        let body: EstatedV4Response;
        try {
            body = await res.json() as EstatedV4Response;
        } catch (e) {
            logger.warn('property-lookup.parse-failed', { error: (e as Error).message });
            return { data: null, reason: 'PROVIDER_ERROR' };
        }

        const structure = body?.data?.structure;
        if (!structure) return { data: null, reason: 'NOT_FOUND' };

        const facts: PropertyFacts = {};
        if (typeof structure.year_built       === 'number') facts.yearBuilt = structure.year_built;
        if (typeof structure.total_area_sq_ft === 'number') facts.sqft      = structure.total_area_sq_ft;
        if (typeof structure.beds_count       === 'number') facts.bedrooms  = structure.beds_count;
        if (typeof structure.baths            === 'number') facts.bathrooms = structure.baths;
        const foundation = normaliseFoundation(structure.foundation_type);
        if (foundation) facts.foundationType = foundation;
        const lotSize = formatLotSize(body.data?.parcel?.area_sq_ft ?? null);
        if (lotSize) facts.lotSize = lotSize;

        // If absolutely nothing was extractable, treat as NOT_FOUND so the
        // UI doesn't claim success on an empty payload.
        if (Object.keys(facts).length === 0) return { data: null, reason: 'NOT_FOUND' };

        return { data: facts, source: 'estated' };
    }
}

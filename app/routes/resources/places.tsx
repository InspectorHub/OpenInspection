import type { Route } from "./+types/places";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

/**
 * BFF resource route for Google Places (Spec 5D B4, #198).
 *
 * The browser must never call `/api/places/*` directly — those endpoints require
 * the session JWT and would 401 (feedback_core_bff_no_client_fetch). This loader
 * holds the token relay and proxies to the in-process API:
 *   - `?q=<text>&session=<tok>`      → `{ suggestions: PlaceSuggestion[] }`
 *   - `?placeId=<id>&session=<tok>`  → `{ address: AddressSelection | null }`
 *
 * The `session` token is a per-typing-session UUID minted client-side; it flows
 * autocomplete → details unchanged so Google bills the whole sequence as ONE
 * Autocomplete session. The upstream `/api/places/*` handlers throw HTTP 400
 * when GOOGLE_PLACES_API_KEY is unset, so we degrade to an empty result (the
 * address input stays usable as free text).
 */

export type PlaceSuggestion = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
};

/** Normalized address emitted when a suggestion is resolved to its details. */
export type AddressSelection = {
  placeId: string;
  formatted: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  lat: number;
  lng: number;
};

const RELAY = { headers: { "x-token-relay": "1" } } as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await getToken(context, request);
  if (!token) return { suggestions: [] as PlaceSuggestion[], address: null };

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const placeId = url.searchParams.get("placeId") ?? "";
  const session = url.searchParams.get("session") ?? "";

  // A valid session token is required by the upstream schema (min 8 chars).
  if (session.length < 8) return { suggestions: [] as PlaceSuggestion[], address: null };

  const api = createApi(context, { token });

  // Details branch — resolve a chosen suggestion to a structured address.
  if (placeId) {
    const res = await api.places.details
      .$get({ query: { placeId, session } }, RELAY)
      .catch(() => null);
    if (!res?.ok) return { suggestions: [] as PlaceSuggestion[], address: null };
    const body = (await res.json()) as { data?: AddressSelection };
    return { suggestions: [] as PlaceSuggestion[], address: body.data ?? null };
  }

  // Autocomplete branch — needs at least 2 chars (upstream min(2)).
  if (q.trim().length < 2) return { suggestions: [] as PlaceSuggestion[], address: null };

  const res = await api.places.autocomplete
    .$get({ query: { q, session } }, RELAY)
    .catch(() => null);
  if (!res?.ok) return { suggestions: [] as PlaceSuggestion[], address: null };
  const body = (await res.json()) as { data?: PlaceSuggestion[] };
  return { suggestions: body.data ?? [], address: null };
}

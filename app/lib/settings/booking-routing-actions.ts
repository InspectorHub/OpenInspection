import { m } from "~/paraglide/messages";

/**
 * The four routing / territory intents of `/settings/booking`.
 *
 * Extracted from the route because that file crossed the 400-line size gate
 * when they landed, and these four are the cohesive unit: all of them talk to
 * one admin sub-router, and three of them share the same "a lookup that
 * resolved nothing must say WHICH nothing" post-processing.
 *
 * Returns `null` for an intent it does not own, so the route keeps its
 * existing if-chain shape and the ownership stays obvious at the call site.
 */

export interface BookingActionResult {
  ok: boolean;
  intent: string;
  message?: string | undefined;
  // The route's other intents return `holiday` / `deletedId`. TypeScript
  // normalizes a union of object LITERALS by adding `prop?: undefined` to the
  // members that lack each key — but a declared interface gets no such
  // treatment, so without these two the union stops exposing `.message` to
  // every panel on the page. Declared here rather than fixed at eight call
  // sites.
  holiday?: undefined;
  deletedId?: undefined;
}

/** hono/client returns a ClientResponse, which is not assignable to Response. */
interface JsonReadable {
  ok: boolean;
  json: () => Promise<unknown>;
}

interface GeocodeBody {
  data?: { resolved?: boolean; formatted?: string | null; reason?: string | null };
}

async function errorMessage(res: JsonReadable): Promise<string | undefined> {
  const err = await res.json().catch(() => null);
  return ((err as Record<string, Record<string, unknown>> | null)?.error?.message) as string | undefined;
}

/** A geocode that resolved nothing always says WHICH nothing. */
function geocodeFailureMessage(reason: string | null): string {
  if (reason === "no_api_key") return m.settings_routing_geocode_no_key();
  if (reason === "no_address") return m.settings_routing_geocode_no_address();
  return m.settings_routing_geocode_not_found();
}

/** The subset of the typed API client these intents use. */
interface RoutingApi {
  admin: {
    "booking-routing": {
      $patch: (args: { json: Record<string, unknown> }) => Promise<JsonReadable>;
      "geocode-company": { $post: () => Promise<JsonReadable> };
      "service-origin": { $put: (args: { json: Record<string, unknown> }) => Promise<JsonReadable> };
    };
    "service-areas": {
      $put: (args: { json: Record<string, unknown> }) => Promise<JsonReadable>;
    };
  };
}

export async function handleBookingRoutingIntent(
  api: unknown,
  form: FormData,
  intent: string,
): Promise<BookingActionResult | null> {
  const client = api as RoutingApi;

  if (intent === "routing-save") {
    const cutoffRaw = String(form.get("sameDayCutoffTime") ?? "").trim();
    const res = await client.admin["booking-routing"].$patch({
      json: {
        routingStrategy: String(form.get("routingStrategy") ?? "first_available"),
        minLeadHours: Math.max(0, Number(form.get("minLeadHours") ?? 0) || 0),
        // An empty box is an explicit CLEAR here, because the panel always
        // sends the field. Omitting it would mean "leave alone", which is not
        // what a user who just emptied the input asked for.
        sameDayCutoffTime: cutoffRaw === "" ? null : cutoffRaw,
      },
    });
    return { ok: res.ok, intent, message: res.ok ? undefined : await errorMessage(res) };
  }

  if (intent === "routing-geocode-company") {
    const res = await client.admin["booking-routing"]["geocode-company"].$post();
    if (!res.ok) return { ok: false, intent, message: await errorMessage(res) };
    const body = (await res.json()) as GeocodeBody;
    // A lookup that found nothing is a 200 with a reason — the outcome belongs
    // on the page, not swallowed into a generic success.
    if (!body.data?.resolved) {
      return { ok: false, intent, message: geocodeFailureMessage(body.data?.reason ?? null) };
    }
    return { ok: true, intent, message: m.settings_routing_located({ address: body.data.formatted ?? "" }) };
  }

  if (intent === "service-areas-save") {
    const zipPrefixes = String(form.get("zipPrefixes") ?? "")
      .split(",").map((z) => z.trim().toUpperCase()).filter(Boolean);
    const res = await client.admin["service-areas"].$put({
      json: { userId: String(form.get("userId") ?? ""), zipPrefixes },
    });
    return { ok: res.ok, intent, message: res.ok ? undefined : await errorMessage(res) };
  }

  if (intent === "service-origin-save") {
    const address = String(form.get("address") ?? "").trim();
    const res = await client.admin["booking-routing"]["service-origin"].$put({
      json: { userId: String(form.get("userId") ?? ""), address: address === "" ? null : address },
    });
    if (!res.ok) return { ok: false, intent, message: await errorMessage(res) };
    const body = (await res.json()) as GeocodeBody;
    if (address === "") return { ok: true, intent, message: m.settings_serviceareas_origin_cleared() };
    return body.data?.resolved
      ? { ok: true, intent, message: m.settings_routing_located({ address: body.data.formatted ?? "" }) }
      : { ok: false, intent, message: geocodeFailureMessage(body.data?.reason ?? null) };
  }

  return null;
}

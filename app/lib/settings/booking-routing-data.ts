import type { BookingRoutingConfig, RoutingStrategy } from "~/components/settings/BookingRoutingPanel";
import type { ServiceAreaMember } from "~/components/settings/InspectorServiceAreasPanel";

/**
 * Reading the routing surface: the loader's parse of `GET /booking-routing`
 * and `GET /service-areas/all`, plus the derivation the page needs from both.
 *
 * Lives beside `booking-routing-actions` (the write half) and out of the route
 * file, which crossed the 400-line size gate when this feature landed.
 */

/** Per-inspector service-origin override as the routing endpoint returns it. */
export interface RoutingOrigin {
  userId: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

export const EMPTY_ROUTING: BookingRoutingConfig = {
  routingStrategy: "first_available",
  minLeadHours: 0,
  sameDayCutoffTime: null,
  companyAddress: null,
  companyLat: null,
  companyLng: null,
  geocodeAvailable: false,
  originCount: 0,
};

function parseStrategy(raw: unknown): RoutingStrategy {
  return raw === "least_loaded" || raw === "closest" ? raw : "first_available";
}

/** Shape one `GET /booking-routing` body. Anything unreadable stays default. */
export function parseRoutingBody(
  raw: unknown,
): { routing: BookingRoutingConfig; origins: RoutingOrigin[] } {
  const d = ((raw as { data?: Record<string, unknown> } | null)?.data) ?? {};
  const origins = (d.origins as RoutingOrigin[] | undefined) ?? [];
  return {
    origins,
    routing: {
      routingStrategy: parseStrategy(d.routingStrategy),
      minLeadHours: Number(d.minLeadHours ?? 0),
      sameDayCutoffTime: typeof d.sameDayCutoffTime === "string" ? d.sameDayCutoffTime : null,
      companyAddress: typeof d.companyAddress === "string" ? d.companyAddress : null,
      companyLat: typeof d.companyLat === "number" ? d.companyLat : null,
      companyLng: typeof d.companyLng === "number" ? d.companyLng : null,
      geocodeAvailable: Boolean(d.geocodeAvailable),
      // Only a resolved override counts. A stored address that never geocoded
      // is not an anchor, and counting it here would make the panel claim
      // `closest` is ready when the strategy would report otherwise.
      originCount: origins.filter((o) => o.lat !== null).length,
    },
  };
}

/** Shape one `GET /service-areas/all` body into userId -> prefixes. */
export function parseServiceAreaBody(raw: unknown): Record<string, string[]> {
  const rows = ((raw as { data?: Array<{ userId: string; zipPrefixes: string[] }> } | null)?.data) ?? [];
  return Object.fromEntries(rows.map((r) => [r.userId, r.zipPrefixes]));
}

/** Join members with their territory and origin for the panel. */
export function buildServiceAreaMembers(
  members: Array<{ id: string; email: string }>,
  areasByUser: Record<string, string[]>,
  origins: RoutingOrigin[],
): ServiceAreaMember[] {
  const byUser = new Map(origins.map((o) => [o.userId, o]));
  return members.map((x) => {
    const origin = byUser.get(x.id);
    return {
      id: x.id,
      email: x.email,
      zipPrefixes: areasByUser[x.id] ?? [],
      originAddress: origin?.address ?? null,
      originLocated: origin?.lat !== null && origin?.lat !== undefined,
    };
  });
}

/**
 * How many inspectors `closest` could actually measure from — their own
 * resolved origin, or the company one they inherit. Fewer than two and the
 * strategy has nothing to compare, which the panel says out loud instead of
 * letting the radio look live.
 */
export function countAnchoredInspectors(
  members: ServiceAreaMember[],
  routing: BookingRoutingConfig,
): number {
  const companyAnchored = routing.companyLat !== null && routing.companyLng !== null;
  return members.filter((x) => x.originLocated || companyAnchored).length;
}

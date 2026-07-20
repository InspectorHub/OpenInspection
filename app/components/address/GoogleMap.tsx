import { useEffect, useRef } from "react";
import { useRouteLoaderData } from "react-router";
import { Loader } from "@googlemaps/js-api-loader";

/**
 * Interactive Google Maps marker (Spec 5D B4, #198). Fail-closed: renders
 * nothing when the browser-side Maps key is unset (root loader → null) or when
 * no coordinates are available, so address entry works with or without a map.
 *
 * The key is read from the root loader via useRouteLoaderData("root") — the same
 * pattern Sidebar/useTheme use — rather than a global, avoiding prop-drilling
 * through the wizard and editor trees.
 *
 * The Maps JS SDK is a deliberate CDN exception (see security-headers CSP); it
 * cannot be self-hosted. We keep it off the `google.maps` global types (the app
 * tsconfig restricts @types) by describing only the slice we use structurally.
 */

interface LatLng {
  lat: number;
  lng: number;
}
interface MapsMap {
  setCenter(pos: LatLng): void;
}
interface MapsLibrarySlice {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => MapsMap;
}
interface MarkerLibrarySlice {
  AdvancedMarkerElement: new (opts: { map: MapsMap; position: LatLng }) => unknown;
}

export function GoogleMap({
  lat,
  lng,
  className,
}: {
  lat?: number | null;
  lng?: number | null;
  className?: string;
}) {
  const root = useRouteLoaderData("root") as { mapsApiKey?: string | null } | undefined;
  const apiKey = root?.mapsApiKey ?? null;
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapsMap | null>(null);

  const hasCoords = typeof lat === "number" && typeof lng === "number";

  useEffect(() => {
    if (!apiKey || !hasCoords || !ref.current) return;
    const position: LatLng = { lat: lat as number, lng: lng as number };

    // If the map is already created, just recenter it (address changed).
    if (mapRef.current) {
      mapRef.current.setCenter(position);
      return;
    }

    let cancelled = false;
    // Local structural typing isolates us from the google.maps global namespace.
    const loader = new Loader({ apiKey, version: "weekly" }) as unknown as {
      importLibrary(name: "maps"): Promise<MapsLibrarySlice>;
      importLibrary(name: "marker"): Promise<MarkerLibrarySlice>;
    };

    void Promise.all([loader.importLibrary("maps"), loader.importLibrary("marker")])
      .then(([maps, markerLib]) => {
        if (cancelled || !ref.current) return;
        const map = new maps.Map(ref.current, {
          center: position,
          zoom: 17,
          // DEMO_MAP_ID lets AdvancedMarkerElement render with any platform key
          // without a cloud-configured map style.
          mapId: "DEMO_MAP_ID",
          disableDefaultUI: true,
          gestureHandling: "cooperative",
        });
        mapRef.current = map;
        new markerLib.AdvancedMarkerElement({ map, position });
      })
      .catch(() => {
        // Network/SDK failure — leave the placeholder div; address entry is
        // unaffected.
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey, hasCoords, lat, lng]);

  if (!apiKey || !hasCoords) return null;

  return (
    <div
      ref={ref}
      data-map
      className={className ?? "w-full h-48 rounded-md border border-ih-border bg-ih-bg-muted overflow-hidden"}
    />
  );
}

// Single source of truth for which R2 keys the public brand-asset route serves.
// The route (server/api/public/inspector-profile.ts) and its guard test both use
// this — the regex was previously duplicated between them. Public assets are
// tenant logos and inspector credential images only; everything else in the
// bucket stays scoped to its own authenticated routes.
export function isServableBrandAsset(key: string): boolean {
  return (
    /^[^/.][^/]*\/branding\/logo-[^/]+$/.test(key) ||        // new tenant-rooted logo
    /^branding\/[^/.][^/]*\/logo-[^/]+$/.test(key) ||         // legacy logo
    /^[^/.][^/]*\/credentials\/[^/]+\/logo-[^/]+$/.test(key)  // credential image
  );
}

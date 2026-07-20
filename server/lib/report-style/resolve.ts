// Three-tier appearance-profile resolution, mirroring resolvePdfSettings /
// derivePhotoMode (override-wins, ?? fallback). Pure; no DB.
import { BUILTIN_PROFILES, DEFAULT_PROFILE_ID, type StyleProfile } from './profiles';

export type ResolvedProfile = StyleProfile;

export function resolveProfile(
  inspection: {
    profileOverride?: string | null;
    badgeLayoutOverride?: string | null;
    reportPhotoColumns?: number | null;
  },
  template: { defaultProfileId?: string | null } | null | undefined,
  tenantConfig: { defaultProfileId?: string | null } | null | undefined,
): ResolvedProfile {
  const id =
    inspection.profileOverride ??
    template?.defaultProfileId ??
    tenantConfig?.defaultProfileId ??
    DEFAULT_PROFILE_ID;

  const profile = BUILTIN_PROFILES[id] ?? BUILTIN_PROFILES[DEFAULT_PROFILE_ID];
  // Phase 2: ?? (await tenantProfileTable.get(id)) before the signature fallback.

  const badgeLayout =
    inspection.badgeLayoutOverride === 'strip' || inspection.badgeLayoutOverride === 'inline'
      ? inspection.badgeLayoutOverride
      : profile.badgeLayout;

  const photoColumns =
    typeof inspection.reportPhotoColumns === 'number'
      ? inspection.reportPhotoColumns
      : profile.photoColumns;

  return { ...profile, badgeLayout, photoColumns };
}

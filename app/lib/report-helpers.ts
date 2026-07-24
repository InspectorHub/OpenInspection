/**
 * Pure report helpers — formatting / derivation only (no React, no hooks).
 *
 * Extracted from <ReportView> so the section-icon mapping, defect predicate,
 * signature/verification models and the two date formatters can be unit-tested
 * and reused without pulling in the component. Behavior-preserving: the bodies
 * are byte-identical to their former in-component definitions.
 */

import { formatDate } from "./format";

/* ------------------------------------------------------------------ */
/* Section icon mapping */
/* ------------------------------------------------------------------ */

const SECTION_ICONS: Record<string, string> = {
  roof: "🏠",
  exterior: "🏗️",
  electrical: "⚡",
  plumbing: "🔧",
  hvac: "❄️",
  interior: "🛋️",
  structural: "🏛️",
  appliances: "🔌",
};

export function getSectionIcon(title: string): string {
  const key = title.toLowerCase().replace(/[^a-z]/g, "");
  for (const [k, v] of Object.entries(SECTION_ICONS)) {
    if (key.includes(k)) return v;
  }
  return "📋";
}

/* ------------------------------------------------------------------ */
/* Filter helpers */
/* ------------------------------------------------------------------ */

/**
 * IA-66 — whether an item belongs in the "Defects Only" filter and shows the
 * "Add to repair request" checkbox. Both used to disagree (the filter ran a
 * severityBucket regex `/defect|safety|major/i` that dropped 'monitor' and never
 * matched a tenant custom category; the checkbox showed for defect OR monitor).
 * Now both read the same first-class, per-category switch the tenant configures:
 * defect_categories.drivesSummary, resolved server-side onto each ResolvedDefect.
 * An item drives the summary when it has at least one included defect whose
 * category drives the summary (unset → the server default of true).
 */
export function itemDrivesSummary(item: {
  resolvedTabs?: { defects?: Array<{ drivesSummary?: boolean }> };
}): boolean {
  return (item.resolvedTabs?.defects ?? []).some((d) => d.drivesSummary !== false);
}

/* ------------------------------------------------------------------ */
/* Signature + verification pure helpers (exported for tests) */
/* ------------------------------------------------------------------ */

export interface SignatureBlockResult {
  variant: "image" | "typed" | "draft";
  inspectorName?: string;
  license?: string | null;
  signedAt?: number | null;
  signatureBase64?: string | null;
  showNudge: boolean;
}

export function signatureBlockModel(d: {
  isPublished: boolean;
  signature: {
    signatureBase64: string | null;
    signedAt?: number | null;
    inspectorName: string;
    inspectorLicense?: string | null;
  } | null;
  ownerPreview: boolean;
}): SignatureBlockResult {
  if (!d.isPublished || !d.signature) return { variant: "draft", showNudge: false };
  const base = {
    inspectorName: d.signature.inspectorName,
    license: d.signature.inspectorLicense ?? null,
    signedAt: d.signature.signedAt ?? null,
  };
  if (d.signature.signatureBase64) {
    return { variant: "image", signatureBase64: d.signature.signatureBase64, showNudge: false, ...base };
  }
  return { variant: "typed", showNudge: d.ownerPreview, ...base };
}

export interface VerificationBlockResult {
  show: boolean;
  verifyUrl: string;
  shortHash: string;
  versionNumber: number;
  publishedAt: number;
}

export function verificationBlockModel(
  d: {
    verification: {
      versionNumber: number;
      contentHash: string;
      verifyToken: string;
      publishedAt: number;
    } | null;
  },
  baseUrl: string,
): VerificationBlockResult {
  if (!d.verification) return { show: false, verifyUrl: "", shortHash: "", versionNumber: 0, publishedAt: 0 };
  return {
    show: true,
    verifyUrl: `${baseUrl}/v/${d.verification.verifyToken}`,
    shortHash: d.verification.contentHash.slice(0, 8),
    versionNumber: d.verification.versionNumber,
    publishedAt: d.verification.publishedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Date formatting helpers for signature/verification blocks */
/* ------------------------------------------------------------------ */

// Report timestamps anchor to the tenant timezone + locale (passed by the caller).
// Defaults 'UTC'/'en-US' preserve behaviour when a caller has none to hand; the
// render goes through the shared formatter (month:'short', numeric day + year).
export function formatEpochMs(ms: number | null | undefined, timeZone = "UTC", locale = "en-US"): string {
  return formatDate(ms, { locale, timeZone, month: "short" });
}

export function formatUnixSeconds(sec: number, timeZone = "UTC", locale = "en-US"): string {
  return formatDate(sec * 1000, { locale, timeZone, month: "short" });
}

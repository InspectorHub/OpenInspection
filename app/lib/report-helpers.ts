/**
 * Pure report helpers — formatting / derivation only (no React, no hooks).
 *
 * Extracted from <ReportView> so the section-icon mapping, defect predicate,
 * signature/verification models and the two date formatters can be unit-tested
 * and reused without pulling in the component. Behavior-preserving: the bodies
 * are byte-identical to their former in-component definitions.
 */

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

export function isDefect(bucket: string): boolean {
  return /defect|safety|major/i.test(bucket);
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

export function formatEpochMs(ms: number | null | undefined): string {
  if (ms == null) return "";
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatUnixSeconds(sec: number): string {
  const d = new Date(sec * 1000);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

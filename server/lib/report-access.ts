// server/lib/report-access.ts
import { isReportPublished } from './status/report-status';

/**
 * Decide whether a PUBLIC report-access request may proceed.
 *
 * TWO gates, and this function takes both ON PURPOSE.
 *
 *  1. PUBLISHED. Client/token access is allowed only while the report is
 *     currently published. Reads CURRENT report_status, so re-publishing
 *     restores access automatically.
 *  2. RELEASED. A workspace may require a signed agreement or payment before
 *     the report is handed over. `releaseGate` is the outstanding reason from
 *     `InspectionPublishService.resolveReleaseGate`, or null when nothing is
 *     holding it back.
 *
 * ⚠️ `releaseGate` is a REQUIRED field with no default, and that is the whole
 * point of this change. Every public enforcement point checked gate 1 and none
 * of them checked gate 2, so a workspace that switched on "require payment"
 * got a client Hub correctly reporting the report as held back and an endpoint
 * beside it serving the report in full. Making the field required turns
 * "forgot the second gate" from a silent release into a type error. Do not give
 * it a default, and do not reintroduce a variant that omits it.
 *
 * Owner-preview and headless render-token access bypass BOTH (they must load
 * in-progress and gated reports for editing, preview and PDF rendering — the
 * renderer is how the gated report gets built in the first place).
 */
export function publicReportAccessAllowed(opts: {
  renderMode: boolean;
  ownerPreview: boolean;
  reportStatus: string | null | undefined;
  releaseGate: 'payment' | 'agreement' | null;
}): boolean {
  if (opts.renderMode || opts.ownerPreview) return true;
  if (!isReportPublished(opts.reportStatus)) return false;
  return opts.releaseGate === null;
}

/**
 * Decide whether this read should be PINNED to the latest published version's
 * snapshot rather than resolved from live tables.
 *
 * Only the recipient track is pinned, and the two exclusions are not symmetric
 * with the access gate above — which is exactly why this is its own function
 * instead of a second `renderMode || ownerPreview` inline:
 *
 *  - RENDER TOKEN carries its own version and must keep it; the verify page
 *    materialises one specific version, not "the latest".
 *  - OWNER PREVIEW stays LIVE. The owner is the author, and preview exists to
 *    show work in progress — pinning it would hide every edit made since the
 *    last publish, which is the plan's split: publish → snapshot, live/draft
 *    preview → read current state.
 *
 * A draft has no version row, so the caller resolves nothing and falls through
 * to live. Nothing here consults the query string: the version is always
 * server-derived, so a link holder cannot ask for a version they were not sent.
 */
export function shouldPinLatestPublished(opts: {
  renderMode: boolean;
  ownerPreview: boolean;
  /** A version already named by a signed render token, if any. */
  tokenPinnedVersion: number | undefined;
}): boolean {
  if (opts.tokenPinnedVersion !== undefined) return false;
  return !opts.renderMode && !opts.ownerPreview;
}

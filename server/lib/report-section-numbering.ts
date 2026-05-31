/**
 * Report section numbering + edit-permission helpers — Competitor parity
 * App.F.4 (Spectora).
 *
 * In the published report viewer (`/report/:id`), section headings render
 * as `"3 - Roof"` (1-based, in visible-section order). On hover, an
 * "EDIT SECTION" button surfaces — but only for viewers with an
 * inspector / admin / owner role; public clients (no JWT, or `agent`
 * role) never see the edit affordance.
 *
 * Kept as pure functions so they unit-test without a DOM or Alpine
 * harness. The template (`report-card-stack.tsx`) calls these directly
 * during render.
 */

/** Roles that may hop back into the editor from the published viewer. */
const EDIT_ROLES = new Set(['owner', 'admin', 'inspector']);

/** Decide whether the current viewer should see the EDIT SECTION button.
 *  Accepts `null` / `undefined` (anonymous public viewer) and unknown
 *  role strings — both fail-closed to `false`. */
export function canEditSection(role: string | null | undefined): boolean {
    if (!role) return false;
    return EDIT_ROLES.has(role);
}

/**
 * Build a Spectora-style numbered section title:
 *   formatSectionHeading('Roof', 2)  ->  "3 - Roof"
 *
 * `index` is 0-based (matches the array index in the rendered list).
 * A null / empty title falls back to the bare number — keeps the
 * template safe if the SSR data layer ever produces a section with no
 * title.
 */
export function formatSectionHeading(title: string | null | undefined, index: number): string {
    const number = Math.max(0, Math.floor(index)) + 1;
    const cleanTitle = (title || '').trim();
    if (!cleanTitle) return String(number);
    return `${number} - ${cleanTitle}`;
}

/**
 * Build the deep-link the EDIT SECTION button should navigate to:
 *   buildSectionEditHref('insp-123', 'roof')
 *     ->  "/inspections/insp-123/report#section-roof"
 *
 * The fragment matches the section's DOM id in the editor — selecting
 * it after the editor mounts scrolls the right section into view.
 */
export function buildSectionEditHref(inspectionId: string, sectionId: string): string {
    return `/inspections/${inspectionId}/report#section-${sectionId}`;
}

/**
 * Sprint 2 S2-5 — `/inspections/:id/report` sub-page.
 *
 * The Report tab is the primary editing surface — the existing Alpine
 * inspection editor (1.6KLOC) gets a thin sub-nav header bolted on top so
 * users can switch between the 5 inspection sub-routes without leaving the
 * page. The editor itself is left untouched — it still uses BareLayout for
 * the full-canvas drawing surface.
 *
 * Sibling switcher (S2-2) lives on the other 4 sub-pages; on Report we
 * keep the existing chrome to avoid disturbing the editor's sticky header.
 */

import { InspectionEditPage } from '../inspection-edit';
import type { BrandingConfig } from '../../../types/auth';

export interface InspectionReportPageProps {
    inspectionId: string;
    branding?:    BrandingConfig | undefined;
}

export const InspectionReportPage = ({
    inspectionId,
    branding,
}: InspectionReportPageProps): JSX.Element => {
    // Delegate to the legacy editor — the editor already owns its own layout
    // and Alpine bindings. The sub-nav is rendered by the inspection-edit
    // page itself when window.location.pathname ends with '/report' (handled
    // in the InspectionSubNav script injection — kept in inspection-edit
    // unchanged for now).
    return InspectionEditPage({ inspectionId, branding });
};

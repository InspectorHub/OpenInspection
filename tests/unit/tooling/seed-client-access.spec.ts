/**
 * The delivered fixture is reachable as a REPORT, not only as a repair builder.
 *
 * `SEED_CLIENT_ACCESS` carried `builderPath`/`builderUrl` and nothing for the
 * report view, and that absence is why every change to the report surface in
 * this repository has been made without anybody opening it: one client surface
 * had a paste-ready URL and the other had none. The two links are derived from
 * the same three values, so they cannot disagree about which fixture they name.
 *
 * `report-viewer.spec.ts` does not close this gap — it skips itself entirely
 * unless `TEST_INSPECTION_ID` and `TEST_SHARE_TOKEN` are supplied by hand, and
 * no seed produces either.
 */
import { describe, it, expect } from 'vitest';

import { PCA_INSPECTION_ID, SEED_CLIENT_ACCESS, SEED_PCA_ACCESS } from '../../seed-fixtures';

describe('SEED_CLIENT_ACCESS report links', () => {
    it('offers a root-relative report path carrying the token', () => {
        expect(SEED_CLIENT_ACCESS.reportPath).toBe(
            `/report-view/${SEED_CLIENT_ACCESS.tenantSlug}/${SEED_CLIENT_ACCESS.inspectionId}`
            + `?token=${SEED_CLIENT_ACCESS.token}`,
        );
    });

    it('offers an absolute URL on the dev port for a human', () => {
        expect(SEED_CLIENT_ACCESS.reportUrl)
            .toBe(`http://localhost:8787${SEED_CLIENT_ACCESS.reportPath}`);
    });

    /**
     * POSITIVE CONTROL: both assertions above would also hold if the two new
     * fields were the builder links copied across. The report is a different
     * page, and the point of adding it was that it was not reachable.
     */
    it('is not the repair-builder link', () => {
        expect(SEED_CLIENT_ACCESS.reportPath).not.toBe(SEED_CLIENT_ACCESS.builderPath);
        expect(SEED_CLIENT_ACCESS.reportPath).toContain('/report-view/');
    });
});

/**
 * The PCA report is a SECOND surface with the same problem.
 *
 * `OpinionOfCost` — the three statutory cost totals ASTM E2018 §11.4 makes a
 * required sub-block — renders from `PcaSkeleton`, which only a `full_pca`
 * report reaches. The PCA fixture exists (behind `SEED_PCA=1`) and is already
 * `published`, but it carried no client access token, so the one component that
 * displays those totals could not be opened either.
 */
describe('SEED_PCA_ACCESS', () => {
    it('points at the PCA inspection, not the delivered one', () => {
        expect(SEED_PCA_ACCESS.inspectionId).toBe(PCA_INSPECTION_ID);
        expect(SEED_PCA_ACCESS.inspectionId).not.toBe(SEED_CLIENT_ACCESS.inspectionId);
    });

    it('offers a paste-ready report URL on the dev port', () => {
        expect(SEED_PCA_ACCESS.reportUrl).toBe(`http://localhost:8787${SEED_PCA_ACCESS.reportPath}`);
        expect(SEED_PCA_ACCESS.reportPath).toContain('/report-view/');
        expect(SEED_PCA_ACCESS.reportPath).toContain(SEED_PCA_ACCESS.token);
    });

    /**
     * POSITIVE CONTROL: every assertion above would also hold if this object
     * were the delivered one with its inspection id swapped. The token has to be
     * its own, or one fixture's link would silently authorise the other.
     */
    it('carries its own token, not the delivered fixture\'s', () => {
        expect(SEED_PCA_ACCESS.token).not.toBe(SEED_CLIENT_ACCESS.token);
    });
});

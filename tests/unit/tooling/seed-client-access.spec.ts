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

import { SEED_CLIENT_ACCESS } from '../../seed-fixtures';

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

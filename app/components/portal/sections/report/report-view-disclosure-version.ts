/**
 * Client-side mirror of `REPORT_VIEW_DISCLOSURE.version`
 * (`server/lib/legal/report-view-disclosure.ts`).
 *
 * Two copies because the two surfaces are genuinely different artifacts: the
 * email carries fixed English platform copy, while the report page carries the
 * translated message catalogue (en + es-419). What must NOT differ is the
 * version they stamp — a reader who saw the page and a reader who saw the email
 * saw the same disclosure, and a version that disagreed between them would make
 * the stamp worse than useless.
 *
 * The equality is asserted, not requested: `tests/unit/email/report-view-
 * disclosure.spec.ts` reads both files and fails when they drift. Bumping one
 * without the other is therefore a red test rather than a comment somebody did
 * not re-read.
 *
 * The value is duplicated rather than imported so the client bundle does not
 * reach into `server/`.
 */
export const REPORT_VIEW_DISCLOSURE_VERSION = 1;

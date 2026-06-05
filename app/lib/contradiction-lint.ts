/**
 * C-14b — flag included "all clear" narratives that contradict a
 * defect/monitor rating. The standard template pre-checks prose like
 * "appears serviceable with no visible defects"; when the inspector rates
 * the same item Defect both statements land in the published report and
 * contradict each other. The editor shows a non-blocking warning listing
 * the offending entries so the inspector can untick them.
 */

const ALL_CLEAR_RE =
  /no (visible )?defects?( were)?( observed| noted| found)?|appears? serviceable|in good condition|no (issues|deficiencies)( were)?( observed| noted| found)?/i;

export interface LintLevel {
  id: string;
  severity?: string;
  isDefect?: boolean;
}

export interface LintEntry {
  id: string;
  title: string;
  comment: string;
}

export function findRatingContradictions(opts: {
  level: LintLevel | undefined;
  entries: readonly LintEntry[];
  includedIds: ReadonlySet<string>;
}): LintEntry[] {
  const { level, entries, includedIds } = opts;
  const ratingSaysProblem =
    !!level && (level.isDefect === true || level.severity === 'marginal' || level.severity === 'significant');
  if (!ratingSaysProblem) return [];
  return entries.filter(
    (e) => includedIds.has(e.id) && (ALL_CLEAR_RE.test(e.comment) || ALL_CLEAR_RE.test(e.title)),
  );
}

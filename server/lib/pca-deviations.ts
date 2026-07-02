/**
 * Commercial PCA Phase S — the structured Deviations-from-the-Guide store.
 *
 * ASTM §11.4.3 conformance linchpin: any claim of E2018 conformance requires
 * disclosing every deviation from the baseline scope. This is a STRUCTURED
 * list (not prose), rendered under report §1.4. Phase S OWNS the store + the
 * append API; Phase C (cost-threshold / term changes), Phase T (scope
 * reductions), and Phase M (omitted exhibits) CALL `appendDeviation`. Phase M
 * adds the editor UI + conformance computation over this store — not the store.
 *
 * Persisted as a JSON array on the inspection (alongside `pca_narrative`).
 */
export interface Deviation {
  id: string;
  /** What the deviation concerns, e.g. "Cost threshold", "Scope reduction". */
  area: string;
  /** The ASTM/Guide baseline being departed from. */
  baselineRequirement: string;
  /** What was done instead. */
  deviation: string;
  /** Why — the client/site justification. */
  reason: string;
}

export type DeviationInput = Omit<Deviation, 'id'>;

function isSameDisclosure(a: Deviation, b: DeviationInput): boolean {
  return (
    a.area === b.area &&
    a.baselineRequirement === b.baselineRequirement &&
    a.deviation === b.deviation &&
    a.reason === b.reason
  );
}

/**
 * Append a deviation to the store, returning a NEW array (never mutates the
 * input). Idempotent: re-appending an identical disclosure is a no-op so
 * repeated phase calls (e.g. a re-run cost engine) don't duplicate rows.
 */
export function appendDeviation(
  store: Deviation[] | null | undefined,
  input: DeviationInput,
): Deviation[] {
  const current = store ?? [];
  if (current.some((d) => isSameDisclosure(d, input))) return [...current];
  const id = `dev_${current.length + 1}_${input.area}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return [...current, { id, ...input }];
}

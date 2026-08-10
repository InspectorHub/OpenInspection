/**
 * FIXTURE — the array is present, correctly named, exported and parseable, and
 * holds nothing.
 *
 * "Found nothing" and "looked at nothing" produce the same empty list, and
 * every other rule in the gate reports on what was parsed. Without an explicit
 * zero guard this file would print a clean bill of health for a catalogue that
 * catalogues no PII at all — which is also, exactly, what a derailed parser
 * looks like from the outside.
 */
export const ERASURE_MANIFEST: ErasureRule[] = [];

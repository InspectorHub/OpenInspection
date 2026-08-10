/**
 * Probe fixture for `scripts/check-non-translatable.mjs` — a source file that
 * behaves correctly: it holds instrument-shaped constants and does NOT import
 * the message catalogue. It is the POSITIVE CONTROL for the locator check and
 * for the catalogue-import check, so that a gate flagging everything it reads
 * cannot be mistaken for a gate flagging the right things.
 *
 * Not compiled by either tsc program and not linted (`scripts/**` is ignored).
 */
export const PROBE_SIGNATURE_BLOCK = 'signed by the probe inspector';
export const PROBE_RELIANCE = 'the probe report is for the named user only';
export const PROBE_LIABILITY = 'probe liability is capped at the probe fee';

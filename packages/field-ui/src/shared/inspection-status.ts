/**
 * The one inspection lifecycle status the editor itself writes into its local copy of the
 * inspection (after "mark complete" and "finish fieldwork" succeed). The server owns the
 * full status set; the package carries only this value, because it cannot import server
 * code. `app/lib/field/inspection-status.parity.test.ts` pins it to the server's constant.
 */
export const INSPECTION_STATUS_COMPLETED = 'completed';

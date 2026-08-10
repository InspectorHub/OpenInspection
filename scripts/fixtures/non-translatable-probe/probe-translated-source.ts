/**
 * Probe fixture for `scripts/check-non-translatable.mjs` — a source file that
 * renders through the message catalogue.
 *
 * Registered in the probe MANIFEST it must fail (instrument text cannot be
 * catalogue-rendered); registered in the probe OUT-OF-SCOPE register the very
 * same file must pass, because a platform notice legitimately does this. The
 * probe holds both registrations at once, which is how the spec shows the rule
 * is scoped to the manifest rather than fired on any paraglide import it sees.
 *
 * Not compiled by either tsc program and not linted (`scripts/**` is ignored).
 */
import { m } from '~/paraglide/messages';

export const PROBE_ACKNOWLEDGEMENT = () => m.probe_acknowledgement();

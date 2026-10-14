import { NATIVE_IDLE_LIMIT_S } from './native-token';

/**
 * How long the `pwchanged:{userId}` marker lives in KV after a credential change
 * or a removal.
 *
 * A web session reads the marker only while its token is alive (24 hours), but a
 * native grant has no fixed expiry: it is refused only when the marker is newer
 * than the grant, or when it has been idle for `NATIVE_IDLE_LIMIT_S`. The marker
 * therefore has to outlive that idle limit, or a grant whose revocation failed
 * could refresh once the marker had expired. Past the limit the idle rule refuses
 * the grant anyway, and a refused refresh does not move its idle clock, so every
 * grant that could still refresh when the marker was written meets the marker
 * before the marker is gone. Ten days of margin cover clock skew and a long
 * KV propagation. The longer life costs nothing on the web path, which only ever
 * compares the marker against a token issued before it.
 */
export const CREDENTIAL_MARKER_TTL_S = NATIVE_IDLE_LIMIT_S + 10 * 86400;

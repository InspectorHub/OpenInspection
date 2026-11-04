/** The environment values private-key wrappings depend on. */
export interface SigningKeyEnv {
    KEY_ENCRYPTION_SECRET?: string | undefined;
    JWT_SECRET?: string | undefined;
    JWT_SECRET_PREVIOUS?: string | undefined;
}

/**
 * The secret new wrappings are made under, and every earlier secret a stored wrapping might still be under.
 *
 * Current is KEY_ENCRYPTION_SECRET when it is set, else JWT_SECRET. Earlier ones: JWT_SECRET itself when KEY_ENCRYPTION_SECRET is set (a
 * deployment that started on JWT_SECRET and added KEY_ENCRYPTION_SECRET later), and JWT_SECRET_PREVIOUS (a JWT_SECRET that was rotated).
 * Short or repeated values are left out. This is the e-sign signing keys only; the session keyring (ES256 `JWT_PRIVATE_KEY_V<N>`) is a
 * different system and does not appear here.
 */
export function signingKeySecrets(env: SigningKeyEnv): { current: string; previous: string[] } {
    // Empty when neither is set: the service then refuses to be built, as it always has.
    const current = env.KEY_ENCRYPTION_SECRET || env.JWT_SECRET || '';
    const earlier = [env.KEY_ENCRYPTION_SECRET ? env.JWT_SECRET : undefined, env.JWT_SECRET_PREVIOUS];
    const previous = [...new Set(earlier.filter((s): s is string => !!s && s.length >= 16 && s !== current))];
    return { current, previous };
}

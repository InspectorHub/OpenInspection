/**
 * The deployment's own environment, recovered from a request's env.
 *
 * The integration-secrets middleware copies the environment per request and
 * fills in the keys a company stored. That merged copy no longer says which
 * side a value came from, and the source resolver must never mistake a
 * company's key for one the deployment supplies. The middleware records the
 * NAMES of the keys it took; removing exactly those leaves what the deployment
 * itself holds.
 *
 * Returns a copy; the input is never changed.
 */
export function deploymentEnvOf<E extends object>(env: E, tenantSecretKeys: readonly string[]): E {
    const copy: Record<string, unknown> = { ...(env as Record<string, unknown>) };
    for (const key of tenantSecretKeys) delete copy[key];
    return copy as E;
}

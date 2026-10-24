/**
 * The web host's `resources.publishReadiness`: the publish pre-flight over the BFF resource route
 * `/resources/publish-readiness` (loader = GET `?id=`, answers `{ readiness }`).
 *
 * Never throws. A failed, unauthenticated, redirected or malformed read answers `null`, which the editor
 * reads as "the check could not be made" and goes on to the publish dialog (a flaky pre-flight must not block
 * publishing). The request is the one the editor sent inline: a plain GET with credentials, fresh at click time.
 */
import type { FieldResources } from "@core/field-ui/data-source";
import type { PublishReadiness } from "@core/field-ui/shared/types";

const PUBLISH_READINESS_ROUTE = "/resources/publish-readiness";

type PublishReadinessCheck = NonNullable<FieldResources["publishReadiness"]>;

export function createWebPublishReadiness(
    fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): PublishReadinessCheck {
    return {
        async check(inspectionId: string): Promise<PublishReadiness | null> {
            try {
                const res = await fetchImpl(`${PUBLISH_READINESS_ROUTE}?id=${encodeURIComponent(inspectionId)}`, {
                    credentials: "include",
                });
                if (!res.ok || res.redirected) return null;
                const body = (await res.json().catch(() => null)) as { readiness?: PublishReadiness | null } | null;
                const readiness = body?.readiness;
                return typeof readiness === "object" && readiness !== null ? readiness : null;
            } catch {
                return null;
            }
        },
    };
}

/**
 * BFF resource route for the inspection page's picker lists.
 *
 * Three lists only feed controls that open on a click: the inspectors for the
 * Schedule card, the role profiles for the add-person dialog and the referral
 * sources for Order details. The page used to read all three before it could
 * render. They are read here instead, in one request, the first time one of
 * those controls is opened (see useHubPickers).
 *
 * Each list answers for itself: an array when the read worked (possibly empty,
 * which then means "there are none"), `null` when it could not be read. Callers
 * must treat null as "unavailable", never as an empty list.
 */
import type { Route } from "./+types/hub-pickers";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import type { RoleProfile } from "~/components/contacts/contacts-helpers";
import { resolveReferralSources } from "../../../server/lib/referral-sources";

export interface HubPickers {
    members: Array<{ id: string; name: string; email: string }> | null;
    roleProfiles: RoleProfile[] | null;
    referralSources: string[] | null;
}

const UNAVAILABLE: HubPickers = { members: null, roleProfiles: null, referralSources: null };

/**
 * Never throws: a fetcher whose route throws replaces the page with its error
 * boundary, and these lists are optional extras of a page that rendered fine.
 */
export async function loader({ request, context }: Route.LoaderArgs): Promise<HubPickers> {
    try {
        return await readPickers(request, context);
    } catch {
        return UNAVAILABLE;
    }
}

async function readPickers(request: Request, context: Route.LoaderArgs["context"]): Promise<HubPickers> {
    const token = await getToken(context, request);
    if (!token) return UNAVAILABLE;
    const api = createApi(context, { token });

    // try/catch inside each: the typed-client chain can throw synchronously, and
    // one failing list must not take the others down.
    const [members, roleProfiles, referralSources] = await Promise.all([
        (async (): Promise<HubPickers["members"]> => {
            try {
                // The assignee list the schedule routes themselves use.
                const res = await api.inspections.inspectors.$get({} as never);
                if (!res.ok) return null;
                const body = (await res.json()) as { data?: Array<{ id: string; name?: string | null; email?: string | null }> };
                return (body.data ?? []).map((u) => ({ id: u.id, name: u.name ?? "", email: u.email ?? "" }));
            } catch {
                return null;
            }
        })(),
        (async (): Promise<HubPickers["roleProfiles"]> => {
            try {
                // Admin-gated server-side: a viewer without access gets a non-ok answer.
                const res = await api.roleProfiles.index.$get();
                // A viewer without access (not an owner or manager) is refused: for them the
                // list is empty, as it always was, and the dialog says to ask an admin.
                if ((res.status as number) === 403) return [];
                if (!res.ok) return null;
                return ((await res.json()) as { data?: RoleProfile[] }).data ?? [];
            } catch {
                return null;
            }
        })(),
        (async (): Promise<HubPickers["referralSources"]> => {
            try {
                const res = await api.adminBranding.branding.$get({});
                if (!res.ok) return null;
                const body = (await res.json()) as { data?: { branding?: { customReferralSources?: string[] } } };
                return resolveReferralSources(body.data?.branding?.customReferralSources);
            } catch {
                return null;
            }
        })(),
    ]);
    return { members, roleProfiles, referralSources };
}

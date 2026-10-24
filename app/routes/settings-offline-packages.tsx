import { useLoaderData } from "react-router";

import type { Route } from "./+types/settings-offline-packages";
import { AccessDenied } from "~/components/AccessDenied";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import { OfflinePackageImporter } from "~/components/offline-package/OfflinePackageImporter";
import { useDisplayLocale, useDisplayTimeZone } from "~/hooks/useSessionContext";
import { requireAdminLoader } from "~/lib/access.server";
import { tenantIdFromSessionToken } from "~/lib/session-claims.server";
import { m } from "~/paraglide/messages";

export function meta() {
    return [{ title: m.offline_import_meta_title() }];
}

/**
 * Owners and managers only. `tenantId` is the company of the signed-in session,
 * handed to the page so it can tell a person that a file belongs to another
 * company before anything is sent; the import endpoint decides that again from
 * the verified token.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
    const { forbidden, token } = await requireAdminLoader(context, request);
    if (forbidden) return { forbidden: true as const, tenantId: null };
    return { forbidden: false as const, tenantId: tenantIdFromSessionToken(token) };
}

export default function SettingsOfflinePackages() {
    const { forbidden, tenantId } = useLoaderData<typeof loader>();
    const locale = useDisplayLocale();
    const timeZone = useDisplayTimeZone();

    if (forbidden) return <AccessDenied />;

    return (
        <div className="space-y-ih-list max-w-3xl">
            <SettingsCrumb
                items={[
                    { label: m.settings_crumb_settings(), href: "/settings" },
                    { label: m.offline_import_page_title() },
                ]}
            />
            <p className="text-[13px] text-ih-fg-3 max-w-[70ch]">{m.offline_import_page_subtitle()}</p>
            {/* A session whose company cannot be read is shown as a mismatch for every file, never as a match. */}
            <OfflinePackageImporter tenantId={tenantId ?? ""} locale={locale} timeZone={timeZone} />
        </div>
    );
}

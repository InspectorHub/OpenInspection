import { Link, redirect, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { Card, EmptyState, Pill, Table, buttonClasses, type PillTone, type TableColumn } from "@core/shared-ui";

import type { Route } from "./+types/settings-imports";
import { AccessDenied } from "~/components/AccessDenied";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import { StartImportPanel } from "~/components/imports/StartImportPanel";
import { useDisplayLocale, useDisplayTimeZone, useSessionContext } from "~/hooks/useSessionContext";
import { requireAdminLoader } from "~/lib/access.server";
import { createApi } from "~/lib/api-client.server";
import { formatDate } from "~/lib/format";
import {
    asImportEntryIntent,
    importEntryHref,
    importEntryPointFor,
    importEntryPointsFor,
    type ImportEntryIntent,
} from "~/lib/import-entry-points";
import { m } from "~/paraglide/messages";

/** One row of `GET /api/imports`, which returns exactly these six fields. */
interface ImportRunRow {
    id: string;
    intent: string;
    vendor: string;
    status: string;
    createdAt: string;
    expiresAt: string | null;
}

export function meta() {
    return [{ title: m.imports_page_title() }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
    const { forbidden, token } = await requireAdminLoader(context, request);
    if (forbidden) return { forbidden: true, items: [] as ImportRunRow[] };

    const api = createApi(context, { token });
    const res = await api.imports.index.$get({ query: {} });
    if (!res.ok) return { forbidden: false, items: [] as ImportRunRow[] };
    const body = (await res.json()) as { data?: { items?: ImportRunRow[] } };
    return { forbidden: false, items: body.data?.items ?? [] };
}

/**
 * Starting a run.
 *
 * The file goes to the same endpoint every entry point uses; the only thing
 * that differs is the intent, which is what decides what the file will become.
 * Success is a REDIRECT rather than data, so the browser lands on the new run
 * and a refresh cannot post the file a second time.
 */
export async function action({ context, request }: Route.ActionArgs) {
    const { forbidden, token } = await requireAdminLoader(context, request);
    if (forbidden) return { error: m.access_denied_title() };

    const form = await request.formData();
    // Narrowed, not cast: the intent decides which table the file lands in, so
    // an unrecognised one is refused here rather than forwarded and argued
    // about by the server's own enum.
    const intent = asImportEntryIntent(form.get("intent"));
    if (!intent) return { error: m.imports_start_unknown_intent() };

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
        return { error: m.imports_upload_needs_file() };
    }

    const api = createApi(context, { token });
    const res = await api.imports.index.$post({
        form: {
            intent,
            uploadAuthorized: String(form.get("uploadAuthorized") ?? ""),
            staffAccessAuthorized: String(form.get("staffAccessAuthorized") ?? ""),
            file,
        },
    });
    const body = (await res.json().catch(() => null)) as
        | { data?: { batchId?: string }; error?: { message?: string } }
        | null;
    if (!res.ok || !body?.data?.batchId) {
        // The server's own sentence, not one invented here: it is the only
        // party that knows whether nothing could read the file, the file was
        // too big, or this workspace may not run this kind of import.
        return { error: body?.error?.message ?? m.imports_unsupported_body() };
    }
    return redirect(`/settings/imports/${body.data.batchId}`);
}

/** What each entry point is called, and what each run was started as. Runs
 *  created before an intent existed still have to render, so the lookup falls
 *  back rather than throwing. */
const INTENT_LABEL: Record<string, () => string> = {
    "templates.create": m.imports_intent_templates_create,
    "templates.overwrite": m.imports_intent_templates_overwrite,
    "contacts.import": m.imports_intent_contacts_import,
    "members.invite": m.imports_intent_members_invite,
    "assisted.full": m.imports_intent_assisted_full,
};

const STATUS_LABEL: Record<string, () => string> = {
    staged: m.imports_status_staged,
    applying: m.imports_status_applying,
    applied: m.imports_status_applied,
    partially_applied: m.imports_status_partially_applied,
    reverted: m.imports_status_reverted,
    partially_reverted: m.imports_status_partially_reverted,
    abandoned: m.imports_status_abandoned,
    needs_assistance: m.imports_status_needs_assistance,
    expired: m.imports_status_expired,
};

/**
 * The chip's colour per state. `monitor` is the one that means "this is
 * waiting for you"; `defect` means part of it did not land.
 *
 * These are Pill's tone names, which are NOT the DS token names — Pill maps
 * `sat`→ok, `monitor`→watch, `defect`→bad internally. A tone spelled with the
 * token name instead compiles to an undefined key and paints nothing.
 *
 * The four settled states share `info` rather than taking Pill's muted greys,
 * for a measured reason: `gen` / `ni` / `neutral` are all
 * `bg-ih-bg-muted text-ih-fg-3`, which composites to 4.34:1 on a card at the
 * chip's 11px — under AA, and invisible to `lint:contrast`, which reads the
 * stylesheet and never composites the chip over the surface beneath it. The
 * distinction between "Undone", "Abandoned" and "Expired" is carried by the
 * word, which is the part that actually says what happened.
 */
const STATUS_TONE: Record<string, PillTone> = {
    staged: "monitor",
    applying: "info",
    applied: "sat",
    partially_applied: "defect",
    reverted: "info",
    partially_reverted: "defect",
    abandoned: "info",
    needs_assistance: "monitor",
    expired: "info",
};

export default function SettingsImports() {
    const { forbidden, items } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const [searchParams] = useSearchParams();
    const session = useSessionContext();
    const locale = useDisplayLocale();
    const timeZone = useDisplayTimeZone();

    // `?.deployment?.` on BOTH hops. A session payload written before this
    // capability shipped carries no `deployment` block at all, and guarding
    // only the context turns that into a blank page rather than a hidden entry.
    const hasAssistedMigration = session?.deployment?.hasAssistedMigration === true;
    const entryPoints = importEntryPointsFor(hasAssistedMigration);
    const chosen = importEntryPointFor(searchParams.get("intent"), hasAssistedMigration);

    if (forbidden) return <AccessDenied />;

    const columns: TableColumn<ImportRunRow>[] = [
        {
            key: "createdAt",
            label: m.imports_col_started(),
            cell: (r) => formatDate(r.createdAt, { locale, timeZone }),
        },
        {
            key: "intent",
            label: m.imports_col_what(),
            cell: (r) => (INTENT_LABEL[r.intent] ?? m.imports_intent_assisted_full)(),
        },
        {
            key: "vendor",
            label: m.imports_col_source(),
            cell: (r) => <span className="text-ih-fg-3">{r.vendor}</span>,
        },
        {
            key: "status",
            label: m.imports_col_status(),
            cell: (r) => (
                <Pill tone={STATUS_TONE[r.status] ?? "info"}>
                    {(STATUS_LABEL[r.status] ?? m.imports_status_staged)()}
                </Pill>
            ),
        },
        {
            key: "expiresAt",
            label: m.imports_col_expires(),
            // A run with nothing to sweep is a real answer, so it says so
            // rather than leaving the cell blank and reading as missing data.
            cell: (r) => (r.expiresAt ? formatDate(r.expiresAt, { locale, timeZone }) : "—"),
        },
        {
            key: "open",
            label: <span className="sr-only">{m.imports_open()}</span>,
            align: "right",
            cell: (r) => (
                <Link
                    to={`/settings/imports/${r.id}`}
                    className="text-[13px] font-bold text-ih-primary-text hover:underline"
                >
                    {m.imports_open()}
                </Link>
            ),
        },
    ];

    return (
        <div className="space-y-ih-list">
            <SettingsCrumb
                items={[
                    { label: m.settings_crumb_settings(), href: "/settings" },
                    { label: m.imports_page_title() },
                ]}
            />
            <p className="text-[13px] text-ih-fg-3">{m.imports_page_subtitle()}</p>

            {/* Start. The entries are not a sequence and are not numbered —
                they are three different things you might be bringing over, and
                which one you pick is the whole of what the run means. */}
            <Card className="p-5 space-y-4">
                <h2 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
                    {m.imports_start_heading()}
                </h2>
                <div className="flex flex-wrap gap-2">
                    {entryPoints.map((entry) => (
                        <Link
                            key={entry.intent}
                            to={importEntryHref(entry.intent)}
                            aria-current={chosen?.intent === entry.intent ? "page" : undefined}
                            className={buttonClasses({
                                variant: chosen?.intent === entry.intent ? "primary" : "secondary",
                            })}
                        >
                            {entryLabel(entry.intent)}
                        </Link>
                    ))}
                </div>

                {chosen && (
                    <div className="border-t border-ih-border pt-4">
                        <StartImportPanel
                            // Remount on a change of entry so a file chosen for
                            // one intent cannot be submitted as another.
                            key={chosen.intent}
                            entry={chosen}
                            label={entryLabel(chosen.intent)}
                            busy={navigation.state !== "idle"}
                            error={actionData?.error ?? null}
                        />
                    </div>
                )}
            </Card>

            {/* What has been imported, and the way back into any of it. */}
            <Card>
                <div className="px-5 pt-5 pb-2">
                    <h2 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
                        {m.imports_list_heading()}
                    </h2>
                </div>
                {items.length === 0 ? (
                    <EmptyState title={m.imports_empty_title()} description={m.imports_empty_body()} />
                ) : (
                    <Table columns={columns} rows={items} getRowKey={(r) => r.id} />
                )}
            </Card>
        </div>
    );
}

/** The assisted entry is named by the sentence a person would say, not by the
 *  noun the other three use — there is no noun, which is the point of it. */
function entryLabel(intent: ImportEntryIntent): string {
    return intent === "assisted.full"
        ? m.imports_start_unknown()
        : (INTENT_LABEL[intent] ?? m.imports_intent_assisted_full)();
}

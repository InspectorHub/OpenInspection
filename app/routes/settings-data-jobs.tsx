/**
 * Web window onto the desktop-owned data-package export jobs (E-3). The web
 * does not run exports — the desktop app does — but an owner may want to see
 * what is running and stop a job left behind on another device. This page is a
 * read-only ledger plus a cancel action; no X-Data-Job token is used here (the
 * cancel route is bearer-only and re-scopes the job by the verified tenant).
 */
import { useLoaderData } from "react-router";
import { Banner, Button, EmptyState, Pill, Table, type PillTone, type TableColumn } from "@core/shared-ui";
import type { Route } from "./+types/settings-data-jobs";
import { formatDate } from "@core/field-ui/shared/format";
import { AccessDenied } from "~/components/AccessDenied";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import { useDisplayLocale, useDisplayTimeZone } from "~/hooks/useSessionContext";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { requireOwnerLoader } from "~/lib/access.server";
import { createApi } from "~/lib/api-client.server";
import { m } from "~/paraglide/messages";

interface JobRow {
    id: string;
    kind: string;
    status: string;
    stage: string;
    leaseExpiresAt: string | null;
    createdAt: string;
    finishedAt: string | null;
    errorCode: string | null;
}

export function meta() {
    return [{ title: m.settings_data_jobs_meta_title() }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
    const { forbidden, token } = await requireOwnerLoader(context, request);
    if (forbidden) return { forbidden: true as const, loadFailed: false, jobs: [] as JobRow[] };
    const api = createApi(context, { token });
    try {
        const res = await api.admin["data-package"].jobs.$get();
        if (!res.ok) return { forbidden: false as const, loadFailed: true, jobs: [] as JobRow[] };
        const body = (await res.json()) as { data?: JobRow[] };
        return { forbidden: false as const, loadFailed: false, jobs: body.data ?? [] };
    } catch {
        return { forbidden: false as const, loadFailed: true, jobs: [] as JobRow[] };
    }
}

export async function action({ context, request }: Route.ActionArgs) {
    const { forbidden, token } = await requireOwnerLoader(context, request);
    if (forbidden) return { ok: false as const };
    const form = await request.formData();
    const id = form.get("jobId");
    if (typeof id !== "string" || !id) return { ok: false as const };
    try {
        const api = createApi(context, { token });
        const res = await api.admin["data-package"].jobs[":id"].cancel.$post({ param: { id } });
        return { ok: res.ok } as const;
    } catch {
        return { ok: false as const };
    }
}

function statusTone(status: string): PillTone {
    switch (status) {
        case "complete": return "sat";
        case "failed": return "defect";
        case "cancelled":
        case "expired": return "warning";
        case "running": return "info";
        default: return "neutral";
    }
}

/** One guarded cancel per row. useGuardedSubmit keys each fetcher and drops a double click. */
function CancelJobButton({ jobId }: { jobId: string }) {
    const { submit: submitCancel, busy, fetcher } = useGuardedSubmit<{ ok: boolean }>({ key: `cancel-${jobId}` });
    const failed = fetcher.data !== undefined && !fetcher.data.ok;
    return (
        <div className="flex flex-col gap-1">
            <Button
                variant="secondary"
                size="sm"
                pending={busy}
                onClick={() => submitCancel({ jobId }, { method: "post" })}
            >
                {busy ? m.settings_data_jobs_cancel_busy() : m.settings_data_jobs_cancel()}
            </Button>
            {failed && <span role="alert" className="text-[12px] text-ih-bad-fg">{m.settings_data_jobs_cancel_result_error()}</span>}
        </div>
    );
}

export default function SettingsDataJobs() {
    const { forbidden, loadFailed, jobs } = useLoaderData<typeof loader>();
    const locale = useDisplayLocale();
    const timeZone = useDisplayTimeZone();
    if (forbidden) return <AccessDenied />;

    const columns: TableColumn<JobRow>[] = [
        { key: "id", label: m.settings_data_jobs_col_job(), cell: (row) => <span className="font-mono text-[12px]">{row.id}</span> },
        { key: "kind", label: m.settings_data_jobs_col_kind(), cell: (row) => row.kind },
        { key: "status", label: m.settings_data_jobs_col_status(), cell: (row) => <Pill tone={statusTone(row.status)}>{row.status}</Pill> },
        { key: "createdAt", label: m.settings_data_jobs_col_created(), cell: (row) => formatDate(row.createdAt, { locale, timeZone }) },
        {
            key: "action",
            label: m.settings_data_jobs_col_action(),
            cell: (row) => (row.status === "queued" || row.status === "running")
                ? <CancelJobButton jobId={row.id} />
                : null,
        },
    ];

    return (
        <div className="space-y-ih-list">
            <SettingsCrumb items={[
                { label: m.settings_crumb_settings(), href: "/settings" },
                { label: m.settings_data_crumb(), href: "/settings/data" },
                { label: m.settings_data_jobs_crumb() },
            ]} />
            <p className="text-[13px] text-ih-fg-3">{m.settings_data_jobs_subtitle()}</p>
            {loadFailed ? (
                <Banner tone="danger">{m.settings_data_jobs_load_error()}</Banner>
            ) : (
                <Table
                    columns={columns}
                    rows={jobs}
                    getRowKey={(row) => row.id}
                    empty={<EmptyState title={m.settings_data_jobs_empty()} />}
                />
            )}
        </div>
    );
}

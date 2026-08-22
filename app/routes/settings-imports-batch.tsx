import { useState } from "react";
import { Link, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { Banner, Card, EmptyState, Pill, buttonClasses } from "@core/shared-ui";

import type { Route } from "./+types/settings-imports-batch";
import { AccessDenied } from "~/components/AccessDenied";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import { AssistanceStage } from "~/components/imports/AssistanceStage";
import { ImportStage } from "~/components/imports/ImportStage";
import { ImportWizardShell } from "~/components/imports/ImportWizardShell";
import { MappingStage } from "~/components/imports/MappingStage";
import { RepairStage } from "~/components/imports/RepairStage";
import { SourcePanel } from "~/components/imports/SourcePanel";
import { useDisplayLocale, useDisplayTimeZone, useSessionContext } from "~/hooks/useSessionContext";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { requireAdminLoader } from "~/lib/access.server";
import { createApi } from "~/lib/api-client.server";
import { formatDate } from "~/lib/format";
import { importIntentLabel, importStatusLabel, importStatusTone } from "~/lib/import-run-labels";
import type {
    AdapterInspection,
    ColumnMapping,
    ProblemRow,
    StageMapping,
} from "~/lib/imports-types";
import {
    currentImportStep,
    importNextBlockedReason,
    importStepsFor,
    type ImportRunView,
    type ImportStepId,
} from "~/lib/import-wizard-steps";
import { m } from "~/paraglide/messages";

/**
 * What `GET /api/imports/:batchId` answers with, as it arrives HERE.
 *
 * Declared rather than imported from the report service, because the two shapes
 * genuinely differ: `createdAt` is a `Date` on the server and a string by the
 * time JSON has been through the wire.
 */
interface BatchReport {
    batch: {
        id: string;
        intent: string;
        vendor: string;
        status: string;
        createdAt: string;
    };
    counts: { total: number; ok: number; conflicts: number; problems: number };
    /** Only the entries needing a person, and only this page of them. */
    problemRows: ProblemRow[];
    /** How many there are behind the page. Without it a page of three is unreadable. */
    problemRowsTotal: number;
    page: number;
    pageSize: number;
    blockedReason: string | null;
    /** The source file's columns, and the mapping to start from. Both null together. */
    inspection: AdapterInspection | null;
    mapping: StageMapping | null;
    /** The day this run's entries are cleared, as `YYYY-MM-DD`, or null. */
    undoUntil: string | null;
}

export function meta() {
    return [{ title: m.imports_page_title() }];
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
    const { forbidden, token } = await requireAdminLoader(context, request);
    if (forbidden) return { forbidden: true, report: null };

    // The page travels in the URL rather than in component state, so the entries
    // needing a person are paged by the SERVER — the report carries one page of
    // them and the count behind it, and a screen that held the page locally
    // would be paging a list it had only the first slice of. It is passed on
    // unparsed: the query schema coerces and bounds it, and a second bound here
    // would be a second answer to how big a page is.
    const url = new URL(request.url);
    const page = url.searchParams.get("page");
    const pageSize = url.searchParams.get("pageSize");

    const api = createApi(context, { token });
    const res = await api.imports[":batchId"].$get({
        param: { batchId: params.batchId },
        query: {
            ...(page ? { page } : {}),
            ...(pageSize ? { pageSize } : {}),
        },
    });
    // A run belonging to another workspace and a run that never existed answer
    // the same way, deliberately, and this screen keeps them the same: the two
    // are one sentence here because telling them apart is what the server
    // refuses to do.
    if (!res.ok) return { forbidden: false, report: null };
    // Two steps, because the route declares its payload as `z.unknown()` — the
    // report is built by a service rather than described by a schema, so the
    // client type is `JSONValue` and narrowing it in one cast is the assertion
    // the compiler refuses. Widening to `unknown` first says out loud that this
    // shape is trusted rather than checked.
    const body = (await res.json()) as { data?: unknown };
    return { forbidden: false, report: (body.data ?? null) as BatchReport | null };
}

/**
 * The four things that can be done to a prepared run, dispatched by `op`.
 *
 * One action rather than four routes: they all name the same run, they all
 * answer with a sentence when they refuse, and the screen returns to the same
 * address afterwards. What comes back is the SERVER's message — it is the only
 * party that knows whether the run has moved on, whether its file is still
 * stored, or how many seats are left.
 */
export async function action({ context, request, params }: Route.ActionArgs) {
    const { forbidden, token } = await requireAdminLoader(context, request);
    if (forbidden) return { error: m.access_denied_title() };

    const form = await request.formData();
    const op = String(form.get("op") ?? "");
    const api = createApi(context, { token });
    const param = { batchId: params.batchId };
    /** Trusted because this screen wrote it a moment ago; the server re-validates it. */
    const json = (field: string): never =>
        JSON.parse(String(form.get(field) ?? "null")) as never;

    const res = await (async () => {
        switch (op) {
            case "mapping":
                return api.imports[":batchId"].mapping.$patch({
                    param, json: { mapping: json("mapping") },
                });
            case "repair":
                return api.imports[":batchId"].rows[":rowId"].$patch({
                    param: { ...param, rowId: String(form.get("rowId") ?? "") },
                    json: { payload: json("payload") },
                });
            case "apply":
                return api.imports[":batchId"].apply.$post({
                    param, json: { conflictPolicy: String(form.get("conflictPolicy") ?? "") as never },
                });
            case "revert":
                return api.imports[":batchId"].revert.$post({ param });
            default:
                return null;
        }
    })();

    if (!res) return { error: m.imports_start_unknown_intent() };
    if (res.ok) return { error: null };
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { error: body?.error?.message ?? m.imports_run_not_found() };
}

/** Each step's name, which is the only thing the shell needs from the catalogue. */
const STEP_LABEL: Record<ImportStepId, () => string> = {
    upload: m.imports_wizard_step_upload,
    mapping: m.imports_wizard_step_mapping,
    repair: m.imports_wizard_step_repair,
    import: m.imports_wizard_step_import,
};

/**
 * A mapping with columns to point at, or null.
 *
 * A TEMPLATE mapping carries a name rather than a column choice, so it has no
 * columns to put on this screen. The narrowing on `mapping.kind` is what keeps
 * it out — NOT the presence of an inspection: a template run now reports one
 * too, describing its rating vocabulary rather than its columns. Narrowing
 * rather than asserting keeps that a fact the compiler holds, and keeps the
 * mapping step out of the rail for a run that would open an empty form.
 */
function columnMapping(report: BatchReport): ColumnMapping | null {
    if (!report.inspection || !report.mapping) return null;
    return report.mapping.kind === "template" ? null : report.mapping;
}

export default function SettingsImportsBatch() {
    const { forbidden, report } = useLoaderData<typeof loader>();
    const session = useSessionContext();
    const navigation = useNavigation();
    const [, setSearchParams] = useSearchParams();
    const locale = useDisplayLocale();
    const timeZone = useDisplayTimeZone();
    const { submit, fetcher, busy: submitting } = useGuardedSubmit<typeof action>();
    /** The step being looked at, once somebody has moved off the landing one. */
    const [step, setStep] = useState<ImportStepId | null>(null);
    /** An undo deletes real rows, so it is confirmed — never with `window.confirm`. */
    const [confirmRevert, setConfirmRevert] = useState(false);

    if (forbidden) return <AccessDenied />;

    if (!report) {
        return (
            <div className="space-y-ih-list">
                {/* Two crumbs, not three: there is no run to name in the third,
                    and a trail whose last step is a run that does not exist is
                    a trail that says the page loaded. */}
                <SettingsCrumb
                    items={[
                        { label: m.settings_crumb_settings(), href: "/settings" },
                        { label: m.imports_page_title() },
                    ]}
                />
                <Card>
                    <EmptyState
                        title={m.imports_run_not_found()}
                        description={m.imports_empty_body()}
                        action={
                            <Link
                                to="/settings/imports"
                                className={buttonClasses({ variant: "secondary" })}
                            >
                                {m.imports_list_heading()}
                            </Link>
                        }
                    />
                </Card>
            </div>
        );
    }

    const mapping = columnMapping(report);
    const run: ImportRunView = {
        status: report.batch.status,
        // A run with columns to map is one whose REPORT carries them. Deriving
        // it from the vendor instead would keep the step on screen after the
        // stored file has been swept, where the mapping can no longer be
        // changed by anybody — and would put this screen in charge of a list of
        // which products are special.
        hasMapping: mapping !== null,
        problemCount: report.counts.problems,
        blockedReason: report.blockedReason,
    };
    const steps = importStepsFor(run);
    const current = step && steps.includes(step) ? step : currentImportStep(run);
    const blockedReason = importNextBlockedReason(current, run, {
        needsFile: m.imports_upload_needs_file(),
        fixProblemsFirst: (n) => m.imports_repair_fix_first({ count: String(n) }),
    });
    // Both halves: the guarded submit covers a write in flight, and navigation
    // covers the reload that follows it. A control released between the two
    // takes a second press against a report that has not been rebuilt yet.
    const busy = submitting || navigation.state !== "idle";
    const failure = fetcher.data?.error ?? null;

    // The date-only retention day is rendered IN UTC, unlike every other date on
    // this page. The server sent a civil day rather than an instant, so reading
    // it in the viewer's zone would move it: a run kept until the 17th would
    // read as the 16th for anybody west of Greenwich.
    const keptUntil = report.undoUntil
        ? formatDate(report.undoUntil, { locale, timeZone: "UTC" })
        : null;

    /** Rewrites one query parameter, keeping whatever else is in the address. */
    const setQuery = (key: string, value: number) =>
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set(key, String(value));
            return next;
        });

    return (
        <div className="space-y-ih-list">
            <SettingsCrumb
                items={[
                    { label: m.settings_crumb_settings(), href: "/settings" },
                    { label: m.imports_page_title(), href: "/settings/imports" },
                    { label: importIntentLabel(report.batch.intent) },
                ]}
            />

            <Card className="p-5 space-y-3">
                <Pill tone={importStatusTone(report.batch.status)}>
                    {importStatusLabel(report.batch.status)}
                </Pill>
                {/* The four numbers together, never only the problems: a screen
                    that shows what is wrong cannot tell "nothing is wrong" from
                    "nothing was examined". A waiting run has read no file yet,
                    so it has no numbers to print rather than four zeroes. */}
                {report.counts.total > 0 && (
                    <p data-testid="import-counts" className="text-[13px] text-ih-fg-2">
                        {m.imports_summary_total({ count: String(report.counts.total) })} ·{" "}
                        {m.imports_summary_ok({ count: String(report.counts.ok) })} ·{" "}
                        {m.imports_summary_conflicts({ count: String(report.counts.conflicts) })} ·{" "}
                        {m.imports_summary_problems({ count: String(report.counts.problems) })}
                    </p>
                )}
            </Card>

            {/* The server's refusal, printed where the control that caused it is.
                It is the only party that knows the run has moved on, or that its
                file is gone, or how many seats are left. */}
            {failure && <Banner tone="danger">{failure}</Banner>}

            {report.batch.status === "needs_assistance" ? (
                <AssistanceStage
                    // `?.deployment?.` on BOTH hops. A session payload written
                    // before this capability shipped carries no `deployment`
                    // block at all, and guarding only the context turns that
                    // into a blank page rather than a closed door.
                    hasAssistedMigration={session?.deployment?.hasAssistedMigration === true}
                    keptUntil={keptUntil}
                />
            ) : (
                <ImportWizardShell
                    steps={steps}
                    current={current}
                    stepLabel={(s) => STEP_LABEL[s]()}
                    blockedReason={blockedReason}
                    busy={busy}
                    onStep={setStep}
                >
                    {current === "upload" && (
                        <SourcePanel
                            vendor={report.batch.vendor}
                            started={formatDate(report.batch.createdAt, { locale, timeZone })}
                            keptUntil={keptUntil}
                        />
                    )}

                    {current === "mapping" && report.inspection && mapping && (
                        <MappingStage
                            inspection={report.inspection}
                            mapping={mapping}
                            busy={busy}
                            onApply={(chosen) => submit(
                                { op: "mapping", mapping: JSON.stringify(chosen) },
                                { method: "post" },
                            )}
                        />
                    )}

                    {current === "repair" && (
                        <RepairStage
                            rows={report.problemRows}
                            total={report.problemRowsTotal}
                            page={report.page}
                            pageSize={report.pageSize}
                            busy={busy}
                            onSave={(rowId, payload) => submit(
                                { op: "repair", rowId, payload: JSON.stringify(payload) },
                                { method: "post" },
                            )}
                            onPage={(p) => setQuery("page", p)}
                            onPageSize={(size) => setQuery("pageSize", size)}
                        />
                    )}

                    {current === "import" && (
                        <ImportStage
                            counts={report.counts}
                            blockedReason={report.blockedReason}
                            status={report.batch.status}
                            undoUntil={keptUntil}
                            busy={busy}
                            onApply={(conflictPolicy) => submit(
                                { op: "apply", conflictPolicy },
                                { method: "post" },
                            )}
                            onRevert={() => setConfirmRevert(true)}
                        />
                    )}
                </ImportWizardShell>
            )}

            <ConfirmDialog
                open={confirmRevert}
                title={m.imports_revert_confirm_title()}
                message={m.imports_revert_confirm_body()}
                confirmLabel={m.imports_revert()}
                busy={busy}
                onCancel={() => setConfirmRevert(false)}
                onConfirm={() => {
                    setConfirmRevert(false);
                    submit({ op: "revert" }, { method: "post" });
                }}
            />
        </div>
    );
}

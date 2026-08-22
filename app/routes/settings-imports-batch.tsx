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
import { PreviewStage } from "~/components/imports/PreviewStage";
import { RepairStage } from "~/components/imports/RepairStage";
import { SourcePanel } from "~/components/imports/SourcePanel";
import { useDisplayLocale, useDisplayTimeZone, useSessionContext } from "~/hooks/useSessionContext";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { requireAdminLoader } from "~/lib/access.server";
import { createApi } from "~/lib/api-client.server";
import { formatDate } from "~/lib/format";
import { importIntentLabel, importStatusLabel, importStatusTone } from "~/lib/import-run-labels";
import type { BatchReport, StageMapping } from "~/lib/imports-types";
import {
    currentImportStep,
    importNextBlockedReason,
    importStepsFor,
    type ImportRunView,
    type ImportStepId,
} from "~/lib/import-wizard-steps";
import { m } from "~/paraglide/messages";

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
    preview: m.imports_wizard_step_preview,
    repair: m.imports_wizard_step_repair,
    import: m.imports_wizard_step_import,
};

/**
 * The mapping this run has a QUESTION about, or null when it has none.
 *
 * Null is the wizard's "nothing to decide" rule applied to a step whose
 * question differs by what was uploaded, and the two arms are unlike enough
 * that one condition could not cover both:
 *
 *  · A tabular source is asked which column holds what, and has a question
 *    whenever the report carries columns at all.
 *  · A TEMPLATE is asked what its own rating words mean — and only when those
 *    words rate its ITEMS. An export whose words file its comments has them
 *    already settled as the three comment tabs, so there is nothing to ask,
 *    and one with no words has nothing to ask about. Both would open a form
 *    with an empty question on it.
 *
 * Narrowing rather than asserting, so a mapping and an inspection that
 * disagree cannot reach a form built for the other one.
 */
function questionedMapping(report: BatchReport): StageMapping | null {
    const { inspection, mapping } = report;
    if (!inspection || !mapping) return null;
    if (mapping.kind === "template") {
        if (inspection.kind !== "template") return null;
        const asks = inspection.ratingsDescribe === "items" && inspection.ratings.length > 0;
        return asks ? mapping : null;
    }
    return inspection.kind === "columns" ? mapping : null;
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

    const mapping = questionedMapping(report);
    const run: ImportRunView = {
        status: report.batch.status,
        // A run with a mapping question is one whose REPORT still poses one.
        // Deriving it from the vendor instead would keep the step on screen
        // after the stored file has been swept, where the mapping can no longer
        // be changed by anybody — and would put this screen in charge of a list
        // of which products are special.
        hasMapping: mapping !== null,
        // A run with a shape to judge is one whose REPORT carries one. Same
        // rule as the mapping step, and for the same reason: a list of which
        // intents are special would go stale the day a fourth entity grew a
        // shape, and would keep the step on screen for a run whose rows are
        // gone.
        hasStructurePreview: report.structure !== null,
        entityKind: report.entityKind,
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

                    {current === "preview" && report.structure && (
                        <PreviewStage structure={report.structure} />
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

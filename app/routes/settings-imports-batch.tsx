import { useState } from "react";
import { Link, useLoaderData, useNavigation } from "react-router";
import { Card, EmptyState, Pill, buttonClasses } from "@core/shared-ui";

import type { Route } from "./+types/settings-imports-batch";
import { AccessDenied } from "~/components/AccessDenied";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import { AssistanceStage } from "~/components/imports/AssistanceStage";
import { ImportWizardShell } from "~/components/imports/ImportWizardShell";
import { useDisplayLocale, useDisplayTimeZone, useSessionContext } from "~/hooks/useSessionContext";
import { requireAdminLoader } from "~/lib/access.server";
import { createApi } from "~/lib/api-client.server";
import { formatDate } from "~/lib/format";
import { importIntentLabel, importStatusLabel, importStatusTone } from "~/lib/import-run-labels";
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
 * time JSON has been through the wire. Only the fields this screen reads are
 * listed — the entries needing a person, and their paging, belong to the step
 * that shows them.
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
    blockedReason: string | null;
    /**
     * The source file's columns, and the mapping to start from.
     *
     * Only their PRESENCE is read here, which is why neither is given a shape:
     * whether there is a mapping question to ask is a fact about the run, and
     * the shape of the answer belongs to the step that asks it.
     */
    inspection: unknown;
    mapping: unknown;
    /** The day this run's entries are cleared, as `YYYY-MM-DD`, or null. */
    undoUntil: string | null;
}

export function meta() {
    return [{ title: m.imports_page_title() }];
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
    const { forbidden, token } = await requireAdminLoader(context, request);
    if (forbidden) return { forbidden: true, report: null };

    const api = createApi(context, { token });
    const res = await api.imports[":batchId"].$get({
        param: { batchId: params.batchId },
        query: {},
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

/** Each step's name, which is the only thing the shell needs from the catalogue. */
const STEP_LABEL: Record<ImportStepId, () => string> = {
    upload: m.imports_wizard_step_upload,
    mapping: m.imports_wizard_step_mapping,
    repair: m.imports_wizard_step_repair,
    import: m.imports_wizard_step_import,
};

export default function SettingsImportsBatch() {
    const { forbidden, report } = useLoaderData<typeof loader>();
    const session = useSessionContext();
    const navigation = useNavigation();
    const locale = useDisplayLocale();
    const timeZone = useDisplayTimeZone();
    /** The step being looked at, once somebody has moved off the landing one. */
    const [step, setStep] = useState<ImportStepId | null>(null);

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

    const run: ImportRunView = {
        status: report.batch.status,
        // A run with columns to map is one whose REPORT carries them. Deriving
        // it from the vendor instead would keep the step on screen after the
        // stored file has been swept, where the mapping can no longer be
        // changed by anybody — and would put this screen in charge of a list of
        // which products are special.
        hasMapping: report.inspection !== null && report.mapping !== null,
        problemCount: report.counts.problems,
        blockedReason: report.blockedReason,
    };
    const steps = importStepsFor(run);
    const current = step && steps.includes(step) ? step : currentImportStep(run);
    const blockedReason = importNextBlockedReason(current, run, {
        needsFile: m.imports_upload_needs_file(),
        fixProblemsFirst: (n) => m.imports_repair_fix_first({ count: String(n) }),
    });

    // The date-only retention day is rendered IN UTC, unlike every other date on
    // this page. The server sent a civil day rather than an instant, so reading
    // it in the viewer's zone would move it: a run kept until the 17th would
    // read as the 16th for anybody west of Greenwich.
    const keptUntil = report.undoUntil
        ? formatDate(report.undoUntil, { locale, timeZone: "UTC" })
        : null;

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
                    busy={navigation.state !== "idle"}
                    onStep={setStep}
                >
                    {current === "upload" && (
                        <SourcePanel
                            vendor={report.batch.vendor}
                            started={formatDate(report.batch.createdAt, { locale, timeZone })}
                            keptUntil={keptUntil}
                        />
                    )}
                </ImportWizardShell>
            )}
        </div>
    );
}

/**
 * The Upload step of a run that already has its file.
 *
 * There is no file control here, and the sentence at the bottom says why: the
 * file a run was read from is the run. Replacing it would silently discard
 * every correction made since, so the way to a different file is a different
 * run — which is also the only shape the server offers.
 */
function SourcePanel({
    vendor,
    started,
    keptUntil,
}: {
    vendor: string;
    started: string;
    /** Already formatted, or null when this run is kept by another rule. */
    keptUntil: string | null;
}) {
    return (
        <Card className="p-5 space-y-4">
            <h3 className="text-[15px] font-bold text-ih-fg-1">{m.imports_source_title()}</h3>
            <dl className="grid gap-3 sm:grid-cols-3 text-[13px]">
                <SourceFact label={m.imports_col_source()} value={vendor} />
                <SourceFact label={m.imports_col_started()} value={started} />
                {/* A dash rather than an empty cell: a run kept by another rule
                    is a real answer, and a blank reads as missing data. */}
                <SourceFact label={m.imports_col_expires()} value={keptUntil ?? "—"} />
            </dl>
            <p className="text-[12px] text-ih-fg-2">{m.imports_source_replace_note()}</p>
        </Card>
    );
}

function SourceFact({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-ih-fg-3">
                {label}
            </dt>
            <dd className="mt-0.5 text-ih-fg-1">{value}</dd>
        </div>
    );
}

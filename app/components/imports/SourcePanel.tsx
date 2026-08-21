import { Card } from "@core/shared-ui";

import { m } from "~/paraglide/messages";

/**
 * The Upload step of a run that already has its file.
 *
 * There is no file control here, and the sentence at the bottom says why: the
 * file a run was read from is the run. Replacing it would silently discard every
 * correction made since, so the way to a different file is a different run —
 * which is also the only shape the server offers.
 *
 * Moved out of the route module when the three later stages landed there. Its
 * three siblings are components, and a wizard whose first step is inline in the
 * page while the other three are imported reads as though that step were
 * special.
 */
export function SourcePanel({
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

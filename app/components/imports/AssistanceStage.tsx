import { Banner, Card } from "@core/shared-ui";

import { m } from "~/paraglide/messages";

/**
 * What a run whose file nothing could read shows.
 *
 * Two different screens, and the difference is not a disabled button. Where
 * there is a support path, the run is WAITING — somebody agreed, at the moment
 * they uploaded it, to a person on the support team opening a file that holds
 * their clients' names and contact details, and the only thing left to say is
 * that we have it and when it stops being kept. Where there is no support path
 * there was never an offer to make: the server refuses that upload before
 * storing anything, so what is shown is what this import can actually read.
 *
 * There is deliberately NO "send it to us" control here. Authorisation is taken
 * with the file or the file is not taken at all — `createAssistanceBatch`
 * writes the name, the instant and the wording version in the same insert as
 * the run — so a run in this state has already been authorised, and there is no
 * route that could record the agreement after the fact.
 */
export function AssistanceStage({
    hasAssistedMigration,
    keptUntil,
}: {
    hasAssistedMigration: boolean;
    /** When the file stops being kept, already formatted, or null. */
    keptUntil: string | null;
}) {
    if (!hasAssistedMigration) {
        return (
            <Card className="p-5 space-y-2">
                <h3 className="text-[15px] font-bold text-ih-fg-1">
                    {m.imports_unsupported_title()}
                </h3>
                <p className="text-[13px] text-ih-fg-2">{m.imports_unsupported_body()}</p>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            <Banner tone="info">{m.imports_assistance_waiting()}</Banner>
            {/* The clock is the part a waiting run cannot leave unsaid: the file
                is somebody else's personal data and it is swept on this date,
                converted or not. */}
            {keptUntil && (
                <Card className="p-5">
                    <p className="text-[13px] text-ih-fg-2">
                        <span className="text-ih-fg-3">{m.imports_col_expires()}</span>{" "}
                        <span className="font-bold">{keptUntil}</span>
                    </p>
                </Card>
            )}
        </div>
    );
}

import { Checkbox } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * The notifications screen (spec §4), rendered by all three audiences.
 *
 * §4 states the requirement as two questions a reader must answer without help:
 * *what will you send me* and *what can I stop*. Everything below follows from
 * that, and three choices in particular are deliberate rather than stylistic:
 *
 * 1. ALWAYS SENT is a SECTION WITH A REASON, not a row of disabled switches.
 *    A greyed-out toggle invites the reader to try, then refuses. A count and a
 *    sentence answer the question before it is asked — which is why the count is
 *    the loudest thing in the section: "7 notifications you cannot switch off"
 *    is a number a reader can hold, and "we may send you service messages" is
 *    not.
 * 2. An em dash is NOT an off switch. It means the notification has no form on
 *    that channel at all. Rendering an unchecked box there would be a lie about
 *    what exists, and a reader who ticked it would be right to expect something.
 * 3. Text messages are not a third identical toggle — the SMS block shows the
 *    consent LEDGER, because consent is the authority there and a preference
 *    can only ever narrow it (§3.3). That block lives in v4; this component
 *    leaves the seam for it rather than rendering a switch that would lie.
 *
 * The same component serves staff, agent and client (CLAUDE.md, Cross-Portal
 * Reuse): one entity, one component, differences expressed as props. A parallel
 * implementation would drift, and only one of the three would get the next fix.
 */

export type ChannelState = "on" | "off" | "unavailable";
export type ChannelId = "email" | "sms" | "in_app";

export interface AlwaysSentItem {
    id: string;
    label: string;
    channels: string[];
}

export interface ChoiceRow {
    id: string;
    label: string;
    channels: Record<ChannelId, ChannelState>;
}

export interface NotificationPreferencesProps {
    alwaysSent: AlwaysSentItem[];
    youChoose: ChoiceRow[];
    /** Called when a switch moves. The caller owns persistence and optimism. */
    onChange: (classId: string, channel: ChannelId, enabled: boolean) => void;
    /** Disables every control while a save is in flight. */
    busy?: boolean;
}

const CHANNELS: ReadonlyArray<{ id: ChannelId; label: () => string }> = [
    { id: "email", label: () => m.notif_prefs_channel_email() },
    { id: "sms", label: () => m.notif_prefs_channel_sms() },
    { id: "in_app", label: () => m.notif_prefs_channel_in_app() },
];

function ChannelCell({
    row, channel, channelLabel, onChange, busy,
}: {
    row: ChoiceRow;
    channel: ChannelId;
    channelLabel: string;
    onChange: NotificationPreferencesProps["onChange"];
    busy: boolean;
}) {
    const state = row.channels[channel];
    return (
        <div role="cell" className="flex items-center gap-2 sm:justify-center">
            {/* The channel name repeats per cell on narrow screens, where the
                column header is not there to supply it. Hidden from AT on wide
                screens only — the checkbox keeps its own full label either way. */}
            <span className="text-[12px] text-ih-fg-3 sm:hidden">{channelLabel}</span>
            {state === "unavailable" ? (
                <>
                    <span aria-hidden="true" className="text-ih-fg-4 select-none">—</span>
                    <span className="sr-only">
                        {m.notif_prefs_channel_unavailable({ channel: channelLabel })}
                    </span>
                </>
            ) : (
                <Checkbox
                    bare
                    checked={state === "on"}
                    disabled={busy}
                    aria-label={`${row.label} — ${channelLabel}`}
                    onChange={(e) => onChange(row.id, channel, e.currentTarget.checked)}
                />
            )}
        </div>
    );
}

export function NotificationPreferences({
    alwaysSent, youChoose, onChange, busy = false,
}: NotificationPreferencesProps) {
    return (
        <div className="space-y-6">
            <section aria-labelledby="notif-always-h" className="bg-ih-bg-card border border-ih-border rounded-xl p-6">
                <div className="flex items-baseline gap-3">
                    {/* The one loud element on the page, and §4 says why: a number
                        a reader can hold beats a sentence they have to trust. */}
                    <span className="text-[28px] leading-none font-bold text-ih-fg-1 tabular-nums">
                        {alwaysSent.length}
                    </span>
                    <h2 id="notif-always-h" className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest">
                        {m.notif_prefs_always_heading()}
                    </h2>
                </div>
                <p className="text-[13px] text-ih-fg-3 mt-2 max-w-prose">
                    {m.notif_prefs_always_reason()}
                </p>

                {alwaysSent.length > 0 && (
                    <details className="mt-4 group">
                        <summary className="text-[13px] font-medium text-ih-fg-2 cursor-pointer select-none focus-visible:outline-2 focus-visible:outline-ih-primary rounded-sm">
                            {m.notif_prefs_always_show()}
                        </summary>
                        <ul className="mt-3 divide-y divide-ih-border">
                            {alwaysSent.map((item) => (
                                <li key={item.id} className="py-2 flex items-baseline justify-between gap-4">
                                    <span className="text-[13px] text-ih-fg-1">{item.label}</span>
                                    <span className="text-[12px] text-ih-fg-3 shrink-0">
                                        {item.channels
                                            .map((c) => CHANNELS.find((x) => x.id === c)?.label() ?? c)
                                            .join(" · ")}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </details>
                )}
            </section>

            <section aria-labelledby="notif-choose-h" className="bg-ih-bg-card border border-ih-border rounded-xl p-6">
                <div className="flex items-baseline gap-3">
                    <span className="text-[28px] leading-none font-bold text-ih-fg-1 tabular-nums">
                        {youChoose.length}
                    </span>
                    <h2 id="notif-choose-h" className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest">
                        {m.notif_prefs_choose_heading()}
                    </h2>
                </div>

                {youChoose.length === 0 ? (
                    <p className="text-[13px] text-ih-fg-3 mt-3">{m.notif_prefs_choose_empty()}</p>
                ) : (
                    // Notification x channel is tabular data, so it carries table
                    // semantics even though the layout is a responsive grid: a
                    // screen-reader user gets row/column context, and the header
                    // row is only a visual convenience for everyone else.
                    <div role="table" aria-labelledby="notif-choose-h" className="mt-4">
                        <div role="row" className="hidden sm:grid grid-cols-[1fr_repeat(3,5rem)] gap-2 pb-2 border-b border-ih-border">
                            <span role="columnheader" />
                            {CHANNELS.map((c) => (
                                <span key={c.id} role="columnheader" className="text-[11px] font-bold text-ih-fg-4 uppercase tracking-wider text-center">
                                    {c.label()}
                                </span>
                            ))}
                        </div>
                        <div className="divide-y divide-ih-border">
                            {youChoose.map((row) => (
                                <div
                                    key={row.id}
                                    role="row"
                                    className="py-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_repeat(3,5rem)] sm:items-center"
                                >
                                    <span role="rowheader" className="text-[13px] text-ih-fg-1">{row.label}</span>
                                    {CHANNELS.map((c) => (
                                        <ChannelCell
                                            key={c.id}
                                            row={row}
                                            channel={c.id}
                                            channelLabel={c.label()}
                                            onChange={onChange}
                                            busy={busy}
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}

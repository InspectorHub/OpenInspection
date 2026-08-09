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

type ChannelState = "on" | "off";
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
    /**
     * Whether the last change is in flight, landed, or nothing has happened.
     *
     * There is no Save button, and that is deliberate: a single switch does not
     * need one, and adding it would invent the question "did that save?" for an
     * action that is already one click. But auto-save without a reply invents
     * the SAME question silently — a reader cannot tell a persisted change from
     * a box that merely looks ticked. This is the reply.
     */
    status?: "idle" | "saving" | "saved";
    /**
     * Bulk change for one row, one column, or the whole grid.
     *
     * The controls sit ON the row and column rather than as loose buttons above
     * the table, because the reader would otherwise have to work out which
     * cells each button touched. A header checkbox says it by where it is.
     *
     * Omit to render no bulk controls at all — which is what a screen with a
     * single choosable row should do, since there the one cell IS the control.
     */
    onBulk?: (enabled: boolean, scope: { channel?: ChannelId; classId?: string }) => void;
    /**
     * Channels the reader cannot currently receive at all, with the reason.
     *
     * A revoked SMS consent makes every per-notification Text choice moot — no
     * text can arrive whatever the row says — so the column is DISABLED rather
     * than merely unchecked. Leaving it live would let someone tick "yes, text
     * me about bookings" while consent says we may not text them at all, which
     * is a screen disagreeing with the send gate.
     */
    lockedChannels?: Partial<Record<ChannelId, string>>;
}

/** All | none | some of the cells in scope are on. */
type BulkState = "all" | "none" | "some";

function bulkStateOf(
    rows: ChoiceRow[],
    scope: { channel?: ChannelId; classId?: string },
): BulkState | null {
    const cells: ChannelState[] = [];
    for (const r of rows) {
        if (scope.classId && r.id !== scope.classId) continue;
        for (const c of CHANNELS) {
            if (scope.channel && c.id !== scope.channel) continue;
            cells.push(r.channels[c.id]);
        }
    }
    if (cells.length === 0) return null;
    if (cells.every((c) => c === "on")) return "all";
    if (cells.every((c) => c === "off")) return "none";
    return "some";
}

function BulkBox({
    state, label, disabled, onToggle,
}: {
    state: BulkState;
    label: string;
    disabled: boolean;
    onToggle: (enabled: boolean) => void;
}) {
    return (
        <Checkbox
            bare
            aria-label={label}
            checked={state === "all"}
            disabled={disabled}
            // `indeterminate` is a DOM property, not an attribute — a partially
            // selected column that rendered as plain unchecked would invite the
            // reader to "select all" when half of it already was.
            ref={(el: HTMLInputElement | null) => { if (el) el.indeterminate = state === "some"; }}
            onChange={() => onToggle(state !== "all")}
        />
    );
}

const CHANNELS: ReadonlyArray<{ id: ChannelId; label: () => string }> = [
    { id: "email", label: () => m.notif_prefs_channel_email() },
    { id: "sms", label: () => m.notif_prefs_channel_sms() },
    { id: "in_app", label: () => m.notif_prefs_channel_in_app() },
];

function ChannelCell({
    row, channel, channelLabel, onChange, busy, lockedReason,
}: {
    row: ChoiceRow;
    channel: ChannelId;
    channelLabel: string;
    onChange: NotificationPreferencesProps["onChange"];
    busy: boolean;
    lockedReason?: string | undefined;
}) {
    return (
        <div role="cell" className="flex items-center gap-2 sm:justify-center">
            {/* The channel name repeats per cell on narrow screens, where the
                column header is not there to supply it. Hidden from AT on wide
                screens only — the checkbox keeps its own full label either way. */}
            <span className="text-[12px] text-ih-fg-3 sm:hidden">{channelLabel}</span>
            <Checkbox
                bare
                checked={row.channels[channel] === "on"}
                disabled={busy || !!lockedReason}
                aria-label={`${row.label} — ${channelLabel}`}
                {...(lockedReason ? { title: lockedReason } : {})}
                onChange={(e) => onChange(row.id, channel, e.currentTarget.checked)}
            />
        </div>
    );
}

export function NotificationPreferences({
    alwaysSent, youChoose, onChange, busy = false, status = "idle", onBulk,
    lockedChannels = {},
}: NotificationPreferencesProps) {
    // With one row there is nothing to batch: the row, the column and the grid
    // all resolve to the same single cell, and three extra controls saying so
    // is noise.
    const bulk = onBulk && youChoose.length > 1 ? onBulk : undefined;
    return (
        <div className="space-y-6">
            <section aria-labelledby="notif-always-h" className="bg-ih-bg-card border border-ih-border rounded-xl p-6">
                <div className="flex items-baseline gap-3">
                    {/* The one loud element on the page, and §4 says why: a number
                        a reader can hold beats a sentence they have to trust. */}
                    <span className="text-[28px] leading-none font-bold text-ih-fg-1 tabular-nums">
                        {alwaysSent.length}
                    </span>
                    <h2 id="notif-always-h" className="text-[11px] font-bold text-ih-fg-3 uppercase tracking-widest">
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
                    <h2 id="notif-choose-h" className="text-[11px] font-bold text-ih-fg-3 uppercase tracking-widest">
                        {m.notif_prefs_choose_heading()}
                    </h2>
                    {/* Only the IN-FLIGHT state lives here. The result is a
                        toast: it has to reach a reader who has scrolled past
                        this card, which an inline line cannot. */}
                    <span aria-live="polite" className="text-[12px] text-ih-fg-3 ml-auto">
                        {status === "saving" ? m.notif_prefs_saving() : ""}
                    </span>
                </div>

                {youChoose.length === 0 ? (
                    <p className="text-[13px] text-ih-fg-3 mt-3">{m.notif_prefs_choose_empty()}</p>
                ) : (
                    // Notification x channel is tabular data, so it carries table
                    // semantics even though the layout is a responsive grid: a
                    // screen-reader user gets row/column context, and the header
                    // row is only a visual convenience for everyone else.
                    <div role="table" aria-labelledby="notif-choose-h" className="mt-4">
                        {/* Channel columns are 6rem, not 5: the widest header is
                            the localized channel name, and es-419 "Correo
                            electrónico" measures 85px — it outgrew a 5rem column
                            and bled into the next one. Sized for the label, not
                            for the English word "Email". */}
                        <div role="row" className="hidden sm:grid grid-cols-[1fr_repeat(3,6rem)] gap-2 pb-2 border-b border-ih-border">
                            <span role="columnheader" className="flex items-center gap-2">
                                {bulk && bulkStateOf(youChoose, {}) && (
                                    <>
                                        <BulkBox
                                            state={bulkStateOf(youChoose, {})!}
                                            label={m.notif_prefs_bulk_all()}
                                            disabled={busy}
                                            onToggle={(enabled) => bulk(enabled, {})}
                                        />
                                        <span className="text-[11px] font-bold text-ih-fg-3 uppercase tracking-wider">
                                            {m.notif_prefs_bulk_all_short()}
                                        </span>
                                    </>
                                )}
                            </span>
                            {CHANNELS.map((c) => (
                                <span key={c.id} role="columnheader" className="flex flex-col items-center gap-1">
                                    <span className="text-[11px] font-bold text-ih-fg-3 uppercase tracking-wider">
                                        {c.label()}
                                    </span>
                                    {bulk && !lockedChannels[c.id] && bulkStateOf(youChoose, { channel: c.id }) && (
                                        <BulkBox
                                            state={bulkStateOf(youChoose, { channel: c.id })!}
                                            label={m.notif_prefs_bulk_column({ channel: c.label() })}
                                            disabled={busy}
                                            onToggle={(enabled) => bulk(enabled, { channel: c.id })}
                                        />
                                    )}
                                </span>
                            ))}
                        </div>
                        <div className="divide-y divide-ih-border">
                            {youChoose.map((row) => (
                                <div
                                    key={row.id}
                                    role="row"
                                    className="py-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_repeat(3,6rem)] sm:items-center"
                                >
                                    <span role="rowheader" className="text-[13px] text-ih-fg-1 flex items-center gap-2">
                                        {bulk && bulkStateOf(youChoose, { classId: row.id }) && (
                                            <BulkBox
                                                state={bulkStateOf(youChoose, { classId: row.id })!}
                                                label={m.notif_prefs_bulk_row({ notification: row.label })}
                                                disabled={busy}
                                                onToggle={(enabled) => bulk(enabled, { classId: row.id })}
                                            />
                                        )}
                                        {row.label}
                                    </span>
                                    {CHANNELS.map((c) => (
                                        <ChannelCell
                                            key={c.id}
                                            row={row}
                                            channel={c.id}
                                            channelLabel={c.label()}
                                            onChange={onChange}
                                            busy={busy}
                                            lockedReason={lockedChannels[c.id]}
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>
                        {/* Every notification shows every channel, always. A
                            channel with nothing behind it yet is quiet, not
                            broken — and switching it off now is honoured the
                            moment something does send on it. */}
                        <p className="text-[12px] text-ih-fg-3 mt-3">{m.notif_prefs_legend()}</p>
                    </div>
                )}
            </section>
        </div>
    );
}

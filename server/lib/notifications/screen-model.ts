import { NOTIFICATION_CLASSES, type Audience, type NotificationClass } from './classes';

/**
 * What one reader sees on the notifications screen (spec §4).
 *
 * §4 states the requirement as two questions a reader must be able to answer
 * without help: *what will you send me* and *what can I stop*. That is why the
 * shape below is two SECTIONS rather than one list of toggles — and why the
 * always-sent group is a section with a reason instead of a row of disabled
 * switches. A greyed-out toggle invites the reader to try, then tells them no.
 *
 * Three surfaces render this (staff, agent, client) and they must not each
 * decide what belongs on it. The filtering rules — audience, recipient-facing,
 * which channels a class can even use — live here once, so a class added later
 * appears in all three or none.
 */

/** A channel's state on a row. `unavailable` is NOT "off" — see below. */
export type ChannelState = 'on' | 'off' | 'unavailable';

export interface ScreenRow {
    id: string;
    label: string;
    /**
     * Per channel. `unavailable` means the class never uses it, which §4 renders
     * as `—`: showing an off-switch for a channel that does not exist is a lie
     * about what exists, and a reader who flips it would be right to expect
     * something to change.
     */
    channels: Record<'email' | 'sms' | 'in_app', ChannelState>;
}

export interface ScreenModel {
    /** Cannot be switched off by anyone. §4 shows these collapsed, with a reason. */
    alwaysSent: Array<{ id: string; label: string; channels: string[] }>;
    /** The reader's call. */
    youChoose: ScreenRow[];
}

const CHANNELS = ['email', 'sms', 'in_app'] as const;

/** Classes this reader can actually receive, in vocabulary order. */
export function classesFor(audience: Audience): NotificationClass[] {
    return NOTIFICATION_CLASSES.filter((c) =>
        c.recipientFacing !== false && c.audience.includes(audience));
}

/**
 * @param muted  `${classId}:${channel}` for every explicit `enabled = false`
 *               row this subject holds. ABSENCE IS NOT "OFF" — a class with no
 *               row is on, which is why this takes the mutes rather than the
 *               full preference set.
 */
export function buildScreenModel(audience: Audience, muted: ReadonlySet<string>): ScreenModel {
    const visible = classesFor(audience);
    return {
        alwaysSent: visible
            .filter((c) => c.required)
            .map((c) => ({ id: c.id, label: c.label, channels: [...c.channels] })),
        youChoose: visible
            .filter((c) => !c.required)
            .map((c) => ({
                id: c.id,
                label: c.label,
                channels: Object.fromEntries(CHANNELS.map((ch) => [
                    ch,
                    !c.channels.includes(ch) ? 'unavailable'
                        : muted.has(`${c.id}:${ch}`) ? 'off' : 'on',
                ])) as ScreenRow['channels'],
            })),
    };
}

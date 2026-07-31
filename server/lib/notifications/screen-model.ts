import { NOTIFICATION_CLASSES, defaultEnabled, type Audience, type NotificationClass } from './classes';

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

/** A channel's state on a row. */
export type ChannelState = 'on' | 'off';

export interface ScreenRow {
    id: string;
    label: string;
    /**
     * Every channel, always — see `buildScreenModel` for why the screen does
     * not narrow this to what the class or the tenant can send today.
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
 * EVERY CLASS SHOWS EVERY CHANNEL, and the screen reads neither the class's
 * own `channels` list nor the tenant's automation rules and templates.
 *
 * A preference is a statement of INTENT — "do not text me about bookings" — and
 * that sentence is true and worth storing before anyone has written the text.
 * When the content and the rule are completed the stored answer simply takes
 * effect, with no screen that changed shape underneath the reader and no
 * decision silently lost in between.
 *
 * The asymmetry is what makes this safe: the switch's meaningful direction is
 * OFF, and OFF always works. A channel left ON that nothing sends yet is not a
 * broken promise, it is just quiet.
 *
 * `classes.ts`'s `channels` is still the truth about what the CODE can send and
 * still gates the send path; it just no longer decides what the screen offers.
 *
 * @param chosen  `${classId}:${channel}` → the explicit choice this subject
 *                stored, for the rows they actually hold. A class with NO entry
 *                falls back to its own default, which is usually "send" but is
 *                not always — see `defaultEnabled`. Only differences from the
 *                default are stored, so this map stays small (§3.2).
 */
export function buildScreenModel(audience: Audience, chosen: ReadonlyMap<string, boolean>): ScreenModel {
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
                    (chosen.get(`${c.id}:${ch}`) ?? defaultEnabled(c.id)) ? 'on' : 'off',
                ])) as ScreenRow['channels'],
            })),
    };
}

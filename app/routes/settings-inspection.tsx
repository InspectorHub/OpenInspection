import { useState } from 'react';
import { useLoaderData, useFetcher } from 'react-router';
import { Icon, RadioGroup, Button, Modal, Banner } from "@core/shared-ui";
import { SettingsCrumb } from '~/components/SettingsCrumb';
import type { Route } from './+types/settings-inspection';
import { requireToken } from '~/lib/session.server';
import { createApi } from '~/lib/api-client.server';
import { useInspectionPrefs } from '~/hooks/useInspectionPrefs';
import { LinkExpiryControl } from '~/components/inspection/LinkExpiryControl';
import type { ReportLinkTtl } from '../../server/lib/report-link-ttl';
import { m } from "~/paraglide/messages";

export function meta() {
    return [{ title: m.settings_inspection_meta_title() }];
}

interface TagRow { id: string; name: string; color: string }

// Track H (C-12): tag list moved off the raw client `fetch('/api/tags')`
// (unauthenticated — BFF rule) into the loader with Token-Relay.
export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await requireToken(context, request);
    const api = createApi(context, { token });
    let tags: TagRow[] = [];
    try {
        const res = await api.tags.index.$get();
        const body = res.ok ? ((await res.json()) as { data?: TagRow[] }) : { data: [] };
        tags = body.data ?? [];
    } catch {
        tags = [];
    }
    // IA-36 ⑥ — the blast radius of the bulk-expiry action, resolved before the
    // operator can press it. Its own try//catch: a tags outage must not take the
    // link controls down with it, and vice versa.
    let liveLinks: number | null = null;
    try {
        const res = await api.inspectionPrefs['report-link-expiry'].$get();
        if (res.ok) liveLinks = ((await res.json()) as { liveLinks: number }).liveLinks;
    } catch {
        // Unknown count. The UI hides the action rather than guessing a number —
        // a button that says "Expire 0 links" and then expires 47 is worse than
        // no button.
        liveLinks = null;
    }
    // IA-100 — current archive-revokes policy, read from the same branding
    // payload the archive dialog reads so the two always agree.
    let archiveRevokesAccess = false;
    try {
        const res = await api.sessionContext.context.$get();
        if (res.ok) {
            const b = (await res.json()) as { data?: { branding?: { archiveRevokesAccess?: boolean } } };
            archiveRevokesAccess = b.data?.branding?.archiveRevokesAccess ?? false;
        }
    } catch {
        archiveRevokesAccess = false;
    }
    return { tags, liveLinks, archiveRevokesAccess };
}

export async function action({ request, context }: Route.ActionArgs) {
    const token = await requireToken(context, request);
    const form = await request.formData();

    // IA-100 — the archive-revokes policy is a tenant_configs column, so it
    // rides the existing branding PUT rather than growing its own endpoint.
    if (form.get('intent') === 'archive-revokes') {
        try {
            const api = createApi(context, { token });
            const res = await api.adminBranding.branding.$post({
                json: { archiveRevokesAccess: form.get('value') === '1' },
            } as unknown as Parameters<typeof api.adminBranding.branding.$post>[0]);
            return { ok: res.ok, affected: 0 };
        } catch {
            return { ok: false as const, affected: 0 };
        }
    }

    // Narrowed to the real type rather than cast through `never`: the server
    // re-validates with ReportLinkTtlSchema regardless, but a blind cast here
    // would let a shape change compile silently on this side — the same
    // failure mode as the RR v8 `(context as {...}).cloudflare` regression.
    let ttl: ReportLinkTtl;
    try {
        ttl = JSON.parse(String(form.get('ttl') ?? '"never"')) as ReportLinkTtl;
    } catch {
        return { ok: false as const, affected: 0 };
    }
    try {
        const api = createApi(context, { token });
        const res = await api.inspectionPrefs['report-link-expiry'].$post({ json: { ttl } });
        if (!res.ok) return { ok: false as const, affected: 0 };
        const body = (await res.json()) as { affected: number };
        return { ok: true as const, affected: body.affected };
    } catch {
        return { ok: false as const, affected: 0 };
    }
}

export default function SettingsInspectionPage() {
    const { prefs, loaded, patch, saveFailed } = useInspectionPrefs();
    const { tags, liveLinks, archiveRevokesAccess: initialArchiveRevokes } = useLoaderData<typeof loader>();
    // IA-100 — optimistic so the checkbox does not appear to ignore a click
    // while the PUT is in flight; the loader revalidation is the source of
    // truth on the next render.
    const archiveRevokesFetcher = useFetcher<{ ok?: boolean }>();
    const [archiveRevokes, setArchiveRevokes] = useState(initialArchiveRevokes);
    const saveArchiveRevokes = (next: boolean) => {
        setArchiveRevokes(next);
        archiveRevokesFetcher.submit(
            { intent: "archive-revokes", value: next ? "1" : "0" },
            { method: "post" },
        );
    };

    if (!loaded) return <div className="p-6 text-[13px] text-ih-fg-3">{m.settings_inspection_loading()}</div>;

    return (
        <div className="space-y-8">
            <SettingsCrumb items={[{ label: m.settings_crumb_settings(), href: '/settings' }, { label: m.settings_inspection_crumb() }]} />
            {/* IA-129 — these controls save silently on change, so a failure
                used to be indistinguishable from a success: the radio stayed
                where you put it and nothing was said. The value is rolled back
                now, which without this banner would look like the click simply
                never registered. */}
            {saveFailed && (
                <Banner tone="danger">{m.settings_inspection_save_failed()}</Banner>
            )}
            <p className="text-[13px] text-ih-fg-3">{m.settings_inspection_intro()}</p>

            <section>
                <h2 className="text-[13px] font-bold uppercase tracking-[0.1em] text-ih-fg-3 mb-3">{m.settings_inspection_clone_heading()}</h2>
                <RadioGroup
                    name="cloneDefault"
                    value={prefs.cloneDefault}
                    onChange={v => patch({ cloneDefault: v as 'rating' | 'rating_notes' | 'all' })}
                    options={[
                        { value: 'rating', label: m.settings_inspection_clone_rating() },
                        { value: 'rating_notes', label: m.settings_inspection_clone_rating_notes() },
                        { value: 'all', label: m.settings_inspection_clone_all() },
                    ]}
                />
            </section>

            <section>
                <h2 className="text-[13px] font-bold uppercase tracking-[0.1em] text-ih-fg-3 mb-3">{m.settings_inspection_autoadvance_heading()}</h2>
                <RadioGroup
                    name="autoAdvance"
                    value={prefs.autoAdvance}
                    onChange={v => patch({ autoAdvance: v as 'keyboard' | 'always' | 'off' })}
                    options={[
                        { value: 'keyboard', label: m.settings_inspection_autoadvance_keyboard() },
                        { value: 'always', label: m.settings_inspection_autoadvance_always() },
                        { value: 'off', label: m.settings_inspection_autoadvance_off() },
                    ]}
                />
                <p className="text-[12px] text-ih-fg-3 mt-1">{m.settings_inspection_autoadvance_note()}</p>
                <div className="flex items-center gap-3 mt-3">
                    <input
                        type="range"
                        min={0}
                        max={2000}
                        step={50}
                        value={prefs.autoAdvanceDelayMs}
                        onChange={e => patch({ autoAdvanceDelayMs: Number(e.target.value) })}
                        className="flex-1"
                    />
                    <span className="text-[13px] font-mono tabular-nums w-20 text-right">{m.settings_inspection_autoadvance_delay_value({ ms: prefs.autoAdvanceDelayMs })}</span>
                </div>
                <p className="text-[12px] text-ih-fg-3 mt-1">{m.settings_inspection_autoadvance_delay_help()}</p>
            </section>

            <section>
                <h2 className="text-[13px] font-bold uppercase tracking-[0.1em] text-ih-fg-3 mb-3">{m.settings_inspection_required_heading()}</h2>
                <p className="text-[12px] text-ih-fg-3 mb-2">{m.settings_inspection_required_help()}</p>
                <RadioGroup
                    name="requireDefectFields"
                    value={prefs.requireDefectFields}
                    onChange={v => patch({ requireDefectFields: v as 'none' | 'location' | 'trade' | 'both' })}
                    options={[
                        { value: 'none', label: m.settings_inspection_required_none() },
                        { value: 'location', label: m.settings_inspection_required_location() },
                        { value: 'trade', label: m.settings_inspection_required_trade() },
                        { value: 'both', label: m.settings_inspection_required_both() },
                    ]}
                />
            </section>

            <section>
                <h2 className="text-[13px] font-bold uppercase tracking-[0.1em] text-ih-fg-3 mb-3">{m.settings_inspection_agent_repair_heading()}</h2>
                <p className="text-[12px] text-ih-fg-3 mb-2">{m.settings_inspection_agent_repair_hint()}</p>
                <RadioGroup
                    name="agentRepairAccess"
                    value={prefs.agentRepairAccess}
                    onChange={v => patch({ agentRepairAccess: v as 'off' | 'read' | 'readwrite' })}
                    options={[
                        { value: 'off', label: m.settings_inspection_agent_repair_off() },
                        { value: 'read', label: m.settings_inspection_agent_repair_read() },
                        { value: 'readwrite', label: m.settings_inspection_agent_repair_readwrite() },
                    ]}
                />
            </section>

            {/* IA-36 ⑤⑥ — how long a report link stays usable. Applies to links
                minted from here on; links already in customers' inboxes are never
                re-dated by changing this. To act on an inspection's existing
                links, use the same control on its People card. */}
            <section>
                <h2 className="text-[13px] font-bold uppercase tracking-[0.1em] text-ih-fg-3 mb-3">{m.settings_inspection_report_link_heading()}</h2>
                <p className="text-[12px] text-ih-fg-3 mb-2">{m.settings_inspection_report_link_help()}</p>
                <LinkExpiryControl
                    value={prefs.reportLinkTtl}
                    onChange={ttl => patch({ reportLinkTtl: ttl })}
                    idPrefix="tenant-link-expiry"
                />
                <p className="text-[12px] text-ih-fg-3 mt-2">{m.settings_inspection_report_link_future_only()}</p>
                <BulkLinkExpiry ttl={prefs.reportLinkTtl} liveLinks={liveLinks} />

                {/* IA-100 — sits under report links because that is what it
                    governs, not under Contacts. Archiving a contact does not
                    touch the links they hold unless this is on; the archive
                    dialog states which way it is set, so the two cannot drift
                    apart in an operator's head. */}
                <label className="flex items-start gap-2.5 mt-4 pt-4 border-t border-ih-border cursor-pointer">
                    <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={archiveRevokes}
                        onChange={(e) => saveArchiveRevokes(e.target.checked)}
                        disabled={archiveRevokesFetcher.state !== "idle"}
                    />
                    <span>
                        <span className="block text-[13px] font-medium text-ih-fg-1">
                            {m.settings_inspection_archive_revokes_label()}
                        </span>
                        <span className="block text-[12px] text-ih-fg-3">
                            {m.settings_inspection_archive_revokes_help()}
                        </span>
                    </span>
                </label>
            </section>

            <section>
                <h2 className="text-[13px] font-bold uppercase tracking-[0.1em] text-ih-fg-3 mb-3">{m.settings_inspection_pinned_heading({ count: prefs.pinnedTagIds.length })}</h2>
                <p className="text-[12px] text-ih-fg-3 mb-3">{m.settings_inspection_pinned_help()}</p>
                <ul className="space-y-1">
                    {tags.map(tag => {
                        const pinned = prefs.pinnedTagIds.includes(tag.id);
                        return (
                            <li key={tag.id} className="flex items-center gap-2 py-1">
                                <input
                                    type="checkbox"
                                    checked={pinned}
                                    disabled={!pinned && prefs.pinnedTagIds.length >= 5}
                                    onChange={() => {
                                        const next = pinned
                                            ? prefs.pinnedTagIds.filter(id => id !== tag.id)
                                            : [...prefs.pinnedTagIds, tag.id];
                                        patch({ pinnedTagIds: next });
                                    }}
                                    className="w-4 h-4"
                                />
                                <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }} />
                                <span className="text-[13px]">{tag.name}</span>
                            </li>
                        );
                    })}
                </ul>
                <a href="/library/tags" className="text-[12px] text-ih-primary-text hover:underline mt-3 inline-flex items-center gap-1">{m.settings_inspection_manage_tags()} <Icon name="arrowR" size={12} /></a>
            </section>
        </div>
    );
}

/**
 * IA-36 ⑥ — the only way to act on report links that already exist.
 *
 * Saving the policy above is future-only and stays that way. Retroactively
 * re-dating links already sitting in customers' inboxes, as a silent
 * consequence of changing a setting, would kill them in bulk the moment
 * "never" became "90 days" — the exact accident IA-36 was opened about.
 *
 * So this is a separate verb, and its button states its own consequence with
 * the real number ("Expire 47 links"), never a harmless "Apply". The count
 * comes from the same predicate the server updates by, so it cannot understate
 * what is about to happen.
 */
export function BulkLinkExpiry({ ttl, liveLinks }: { ttl: ReportLinkTtl; liveLinks: number | null }) {
    const fetcher = useFetcher<typeof action>();
    const [confirming, setConfirming] = useState(false);

    // Unknown count (the lookup failed) → no control at all. A bulk destructive
    // action whose scope we cannot state is not one worth offering.
    if (liveLinks === null) return null;

    const lifting = ttl === 'never';
    const label = lifting
        ? liveLinks === 1 ? m.settings_inspection_report_link_bulk_lift_one() : m.settings_inspection_report_link_bulk_lift({ count: liveLinks })
        : liveLinks === 1 ? m.settings_inspection_report_link_bulk_expire_one() : m.settings_inspection_report_link_bulk_expire({ count: liveLinks });
    const busy = fetcher.state !== 'idle';
    const done = fetcher.state === 'idle' && fetcher.data?.ok === true;

    return (
        <div className="mt-4 pt-4 border-t border-ih-border">
            <p className="text-[12px] text-ih-fg-3 mb-2">{m.settings_inspection_report_link_bulk_help()}</p>
            <Button
                variant="secondary"
                size="sm"
                // Nothing live to act on. Kept visible and disabled rather than
                // hidden, so the absence reads as "none right now" instead of
                // "this product cannot do that".
                disabled={liveLinks === 0 || busy}
                onClick={() => setConfirming(true)}
            >
                {label}
            </Button>
            {done && (
                <p className="text-[12px] text-ih-fg-3 mt-2" role="status">
                    {m.settings_inspection_report_link_bulk_done({ count: fetcher.data?.affected ?? 0 })}
                </p>
            )}

            <Modal
                open={confirming}
                onClose={() => setConfirming(false)}
                title={label}
                footer={
                    <>
                        <Button variant="ghost" onClick={() => setConfirming(false)}>{m.common_cancel()}</Button>
                        <Button
                            variant="danger"
                            disabled={busy}
                            onClick={() => {
                                fetcher.submit({ ttl: JSON.stringify(ttl) }, { method: 'post' });
                                setConfirming(false);
                            }}
                        >
                            {label}
                        </Button>
                    </>
                }
            >
                <p className="text-[13px] text-ih-fg-3">
                    {lifting
                        ? m.settings_inspection_report_link_bulk_lift_confirm({ count: liveLinks })
                        : m.settings_inspection_report_link_bulk_expire_confirm({ count: liveLinks })}
                </p>
            </Modal>
        </div>
    );
}

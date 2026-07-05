import { useLoaderData } from 'react-router';
import { SettingsCrumb } from '~/components/SettingsCrumb';
import type { Route } from './+types/settings-inspection';
import { requireToken } from '~/lib/session.server';
import { createApi } from '~/lib/api-client.server';
import { useInspectionPrefs } from '~/hooks/useInspectionPrefs';

export function meta() {
    return [{ title: 'Inspection Workflow Settings - OpenInspection' }];
}

interface TagRow { id: string; name: string; color: string }

// Track H (C-12): tag list moved off the raw client `fetch('/api/tags')`
// (unauthenticated — BFF rule) into the loader with Token-Relay.
export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await requireToken(context, request);
    try {
        const api = createApi(context, { token });
        const res = await api.tags.index.$get();
        const body = res.ok ? ((await res.json()) as { data?: TagRow[] }) : { data: [] };
        return { tags: body.data ?? [] };
    } catch {
        return { tags: [] };
    }
}

export default function SettingsInspectionPage() {
    const { prefs, loaded, patch } = useInspectionPrefs();
    const { tags } = useLoaderData<typeof loader>();

    if (!loaded) return <div className="p-6 text-[13px] text-ih-fg-3">Loading...</div>;

    return (
        <div className="space-y-8">
            <SettingsCrumb items={[{ label: 'Settings', href: '/settings' }, { label: 'Inspection Workflow' }]} />
            <p className="text-[13px] text-ih-fg-3">Defaults that apply to every inspector on this workspace.</p>

            <section>
                <h2 className="text-[13px] font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-3">Clone last (R key) default</h2>
                {(['rating', 'rating_notes', 'all'] as const).map(scope => (
                    <label key={scope} className="flex items-center gap-2 py-1.5 cursor-pointer">
                        <input
                            type="radio"
                            checked={prefs.cloneDefault === scope}
                            onChange={() => patch({ cloneDefault: scope })}
                            className="w-4 h-4"
                        />
                        <span className="text-[13px]">{({
                            rating:       'Rating only',
                            rating_notes: 'Rating + Notes',
                            all:          'Everything (rating + notes + photos + tags)',
                        } as Record<typeof scope, string>)[scope]}</span>
                    </label>
                ))}
            </section>

            <section>
                <h2 className="text-[13px] font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-3">Auto-advance after rating</h2>
                {(['keyboard', 'always', 'off'] as const).map(mode => (
                    <label key={mode} className="flex items-center gap-2 py-1 cursor-pointer">
                        <input
                            type="radio"
                            checked={prefs.autoAdvance === mode}
                            onChange={() => patch({ autoAdvance: mode })}
                            className="w-4 h-4"
                        />
                        <span className="text-[13px]">{({
                            keyboard: 'Keyboard rating only (1-5 speed-scans; clicks stay on the item)',
                            always:   'Always (clicks and keyboard both advance)',
                            off:      'Never (always stay on the item)',
                        } as Record<typeof mode, string>)[mode]}</span>
                    </label>
                ))}
                <p className="text-[12px] text-ih-fg-3 mt-1">Defect/Monitor-style ratings always stay put and focus Notes so you can describe the finding.</p>
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
                    <span className="text-[13px] font-mono tabular-nums w-20 text-right">{prefs.autoAdvanceDelayMs} ms</span>
                </div>
                <p className="text-[12px] text-ih-fg-3 mt-1">Delay before the editor advances to the next item.</p>
            </section>

            <section>
                <h2 className="text-[13px] font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-3">Required defect fields at publish</h2>
                <p className="text-[12px] text-ih-fg-3 mb-2">Fields every defect must have before a report can be published. Inspections can override this per-job in inspection settings.</p>
                {(['none', 'location', 'trade', 'both'] as const).map(req => (
                    <label key={req} className="flex items-center gap-2 py-1 cursor-pointer">
                        <input
                            type="radio"
                            checked={prefs.requireDefectFields === req}
                            onChange={() => patch({ requireDefectFields: req })}
                            className="w-4 h-4"
                        />
                        <span className="text-[13px]">{({
                            none:     'None — missing fields warn, never block',
                            location: 'Location required',
                            trade:    'Recommended trade required',
                            both:     'Location + trade required',
                        } as Record<typeof req, string>)[req]}</span>
                    </label>
                ))}
            </section>

            <section>
                <h2 className="text-[13px] font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-3">Pinned tags ({prefs.pinnedTagIds.length}/5)</h2>
                <p className="text-[12px] text-ih-fg-3 mb-3">Up to 5 tags shown as 1-click chips below the Notes field.</p>
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
                <a href="/library/tags" className="text-[12px] text-ih-primary hover:underline mt-3 inline-block">Manage tag library →</a>
            </section>
        </div>
    );
}

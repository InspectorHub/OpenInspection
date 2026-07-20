import { useLoaderData } from 'react-router';
import { Icon, RadioGroup } from "@core/shared-ui";
import { SettingsCrumb } from '~/components/SettingsCrumb';
import type { Route } from './+types/settings-inspection';
import { requireToken } from '~/lib/session.server';
import { createApi } from '~/lib/api-client.server';
import { useInspectionPrefs } from '~/hooks/useInspectionPrefs';
import { m } from "~/paraglide/messages";

export function meta() {
    return [{ title: m.settings_inspection_meta_title() }];
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

    if (!loaded) return <div className="p-6 text-[13px] text-ih-fg-3">{m.settings_inspection_loading()}</div>;

    return (
        <div className="space-y-8">
            <SettingsCrumb items={[{ label: m.settings_crumb_settings(), href: '/settings' }, { label: m.settings_inspection_crumb() }]} />
            <p className="text-[13px] text-ih-fg-3">{m.settings_inspection_intro()}</p>

            <section>
                <h2 className="text-[13px] font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-3">{m.settings_inspection_clone_heading()}</h2>
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
                <h2 className="text-[13px] font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-3">{m.settings_inspection_autoadvance_heading()}</h2>
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
                <h2 className="text-[13px] font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-3">{m.settings_inspection_required_heading()}</h2>
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
                <h2 className="text-[13px] font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-3">{m.settings_inspection_pinned_heading({ count: prefs.pinnedTagIds.length })}</h2>
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
                <a href="/library/tags" className="text-[12px] text-ih-primary hover:underline mt-3 inline-flex items-center gap-1">{m.settings_inspection_manage_tags()} <Icon name="arrowR" size={12} /></a>
            </section>
        </div>
    );
}

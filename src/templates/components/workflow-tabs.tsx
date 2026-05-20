/**
 * Design System 0520 subsystem E phase 2 — WorkflowTabs.
 *
 * 6-tab nav rendered above the dashboard inspections list. Each tab
 * filters by inspection lifecycle state; counts are recomputed from
 * the `inspections-loaded` window event the dashboard fires after
 * every list fetch (so the filter survives subsequent refreshes
 * without an extra round trip).
 *
 * Selecting a tab dispatches `workflow-filter-changed` (detail: { workflow })
 * and persists to the URL as `?workflow=:id` so deep-links honour
 * the choice across reloads.
 */
import type { FC } from 'hono/jsx';

export const WorkflowTabs: FC = () => (
    <nav x-data="workflowTabs()" {...{ 'x-init': 'init()' }}
         class="flex gap-2 flex-wrap mb-4">
        <template {...{ 'x-for': 't in tabs', ':key': 't.id' }}>
            <button class="inline-flex items-center gap-2 px-3 h-8 rounded-md text-xs font-bold transition-colors"
                    {...{
                        ':class': "selected === t.id ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'",
                        '@click': 'select(t.id)',
                    }}>
                <span x-text="t.label" />
                <span class="px-1.5 h-4 inline-flex items-center justify-center rounded-full text-[10px] font-bold"
                      {...{ ':class': "selected === t.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'" }}
                      x-text="t.count" />
            </button>
        </template>
    </nav>
);

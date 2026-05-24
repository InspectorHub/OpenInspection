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
         class="flex flex-wrap items-center border-b border-slate-200 dark:border-slate-700 -mb-px">
        <template {...{ 'x-for': 't in tabs', ':key': 't.id' }}>
            <button class="inline-flex items-center gap-1.5 px-3.5 py-2.5 border-b-2 text-[13px] font-bold transition-all"
                    {...{
                        ':class': "selected === t.id ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'",
                        '@click': 'select(t.id)',
                    }}>
                <span x-text="t.label" />
                <span class="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold tabular-nums"
                      {...{ ':class': "selected === t.id ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'" }}
                      x-text="t.count" />
            </button>
        </template>
    </nav>
);

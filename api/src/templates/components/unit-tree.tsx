/**
 * Design System 0520 subsystem D phase 2 — UnitTree left rail.
 *
 * Renders the building / floor / unit hierarchy as a collapsible
 * tree alongside the inspection editor. Used only when the inspection
 * has at least one unit row (multi-unit commercial / multi-family
 * properties); single-unit residential inspections see the plain
 * section list and never load this component's data.
 *
 * The Alpine factory lives in /js/unit-tree.js. It listens for an
 * `inspection-editor-ready` window event that publishes the active
 * inspection id so the data fetch can resolve.
 */
import type { FC } from 'hono/jsx';

export const UnitTree: FC = () => (
    <aside
        x-data="unitTree()"
        {...{ 'x-init': 'init()' }}
        x-show="hasUnits || allowEnable"
        style="display: none"
        class="w-56 border-r border-slate-200 bg-slate-50 p-3 overflow-y-auto"
        aria-label="Unit hierarchy"
    >
        <div class="flex items-center justify-between mb-2">
            <h3 class="text-[10px] font-bold uppercase tracking-widest text-slate-400">Units</h3>
            <button class="px-2 h-6 rounded-md bg-white border border-slate-200 text-xs font-bold hover:bg-slate-100"
                    {...{ '@click': "addUnit(null, 'building')" }}
                    title="Add building">+</button>
        </div>

        <ul class="space-y-1 text-sm">
            <template {...{ 'x-for': 'b in roots', ':key': 'b.id' }}>
                <li>
                    <div class="flex items-center gap-1"
                         {...{ ':class': "selectedUnitId === b.id ? 'bg-indigo-100 rounded' : ''" }}>
                        <button class="flex-1 text-left px-2 py-1 font-medium"
                                {...{ '@click': "selectUnit(b.id)" }}
                                x-text="b.name" />
                        <button class="text-slate-400 hover:text-indigo-600 px-1"
                                {...{ '@click': "addUnit(b.id, 'floor')" }}
                                title="Add floor">+</button>
                    </div>
                    <ul class="ml-3 mt-1 space-y-1">
                        <template {...{ 'x-for': 'f in childrenOf(b.id)', ':key': 'f.id' }}>
                            <li>
                                <div class="flex items-center gap-1"
                                     {...{ ':class': "selectedUnitId === f.id ? 'bg-indigo-100 rounded' : ''" }}>
                                    <button class="flex-1 text-left px-2 py-1"
                                            {...{ '@click': "selectUnit(f.id)" }}
                                            x-text="f.name" />
                                    <button class="text-slate-400 hover:text-indigo-600 px-1"
                                            {...{ '@click': "addUnit(f.id, 'unit')" }}
                                            title="Add unit">+</button>
                                </div>
                                <ul class="ml-3 mt-1 space-y-1">
                                    <template {...{ 'x-for': 'u in childrenOf(f.id)', ':key': 'u.id' }}>
                                        <li>
                                            <button class="text-left px-2 py-1 w-full text-slate-700"
                                                    {...{ ':class': "selectedUnitId === u.id ? 'bg-indigo-100 rounded' : ''", '@click': "selectUnit(u.id)" }}
                                                    x-text="u.name" />
                                        </li>
                                    </template>
                                </ul>
                            </li>
                        </template>
                    </ul>
                </li>
            </template>
        </ul>

        <div x-show="!hasUnits && allowEnable" class="mt-4">
            <button class="px-3 h-8 rounded-md bg-indigo-50 border border-indigo-200 text-xs font-bold text-indigo-700 w-full hover:bg-indigo-100"
                    {...{ '@click': "addUnit(null, 'building')" }}>
                + Add first building
            </button>
            <p class="text-[10px] text-slate-400 mt-1 leading-snug">
                Switches this inspection to multi-unit mode.
            </p>
        </div>
    </aside>
);

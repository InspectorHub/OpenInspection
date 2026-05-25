/**
 * Gap 3 — BreadcrumbDropdown for multi-unit navigation.
 *
 * Renders Building / Unit segment dropdowns in the editor PageChrome.
 * Hidden for single-family inspections (no units).
 *
 * Each dropdown shows:
 *   - Grouped options (Common areas / Individual units) with eyebrow labels
 *   - Hover-reveal actions: Rename / Duplicate / Remove
 *   - Footer: + Add unit / + Add common area / + Add building
 *
 * Alpine state reads from inspectionEditor factory:
 *   units, activeUnitId, activeBuildingId, setActiveUnit, setActiveBuilding
 */
import type { FC } from 'hono/jsx';

interface BreadcrumbDropdownProps {
    inspectionId: string;
}

export const BreadcrumbDropdown: FC<BreadcrumbDropdownProps> = ({ inspectionId: _id }) => (
    <div
        x-show="units && units.length > 0"
        x-cloak
        class="flex items-center gap-1 text-[13px]"
    >
        <span class="text-slate-300 dark:text-slate-600 mx-0.5">/</span>

        {/* Building segment */}
        <div x-show="buildingList && buildingList.length > 0" class="relative" x-data="{ bldgOpen: false }" {...{ 'x-on:click.outside': 'bldgOpen = false' }}>
            <button
                type="button"
                {...{ 'x-on:click': 'bldgOpen = !bldgOpen' }}
                class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[13px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
                <span x-text="activeBuildingName || 'Building'" class="truncate max-w-[140px]"></span>
                <svg class="w-3 h-3 flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>

            <div
                x-show="bldgOpen"
                x-cloak
                {...{ 'x-transition:enter': 'transition ease-out duration-150', 'x-transition:enter-start': 'opacity-0 scale-95', 'x-transition:enter-end': 'opacity-100 scale-100', 'x-transition:leave': 'transition ease-in duration-100', 'x-transition:leave-start': 'opacity-100 scale-100', 'x-transition:leave-end': 'opacity-0 scale-95' }}
                class="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 overflow-hidden"
            >
                <div class="max-h-[380px] overflow-y-auto py-1">
                    <template x-for="b in buildingList" {...{ 'x-bind:key': 'b.id' }}>
                        <button
                            type="button"
                            {...{ 'x-on:click': 'setActiveBuilding(b.id); bldgOpen = false' }}
                            class="w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors group ih-row"
                            x-bind:class="activeBuildingId === b.id ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-bold' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'"
                        >
                            <span class="flex-1 truncate" x-text="b.name"></span>
                            <span class="ih-row__hover flex items-center gap-1">
                                <button type="button" {...{ 'x-on:click.stop': 'renameUnit(b.id, b.name)' }} class="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-indigo-600" title="Rename">
                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                </button>
                                <button type="button" {...{ 'x-on:click.stop': 'removeUnit(b.id)' }} class="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-rose-600" title="Remove">
                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                </button>
                            </span>
                        </button>
                    </template>
                </div>
                <div class="border-t border-slate-200 dark:border-slate-700 px-3 py-2">
                    <button
                        type="button"
                        {...{ 'x-on:click': "addUnit('building', null); bldgOpen = false" }}
                        class="inline-flex items-center gap-1.5 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                        Add building
                    </button>
                </div>
            </div>
        </div>

        {/* Unit segment */}
        <span x-show="buildingList && buildingList.length > 0" class="text-slate-300 dark:text-slate-600 mx-0.5">/</span>
        <div class="relative" x-data="{ unitOpen: false }" {...{ 'x-on:click.outside': 'unitOpen = false' }}>
            <button
                type="button"
                {...{ 'x-on:click': 'unitOpen = !unitOpen' }}
                class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[13px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
                <span x-show="activeUnitType === 'common'" class="px-1 py-0 rounded text-[8px] font-extrabold uppercase tracking-[0.05em] mr-0.5" style="background: rgba(245,158,11,0.16); color: #b45309;">Common</span>
                <span x-text="activeUnitName || 'Unit'" class="truncate max-w-[140px]"></span>
                <svg class="w-3 h-3 flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>

            <div
                x-show="unitOpen"
                x-cloak
                {...{ 'x-transition:enter': 'transition ease-out duration-150', 'x-transition:enter-start': 'opacity-0 scale-95', 'x-transition:enter-end': 'opacity-100 scale-100', 'x-transition:leave': 'transition ease-in duration-100', 'x-transition:leave-start': 'opacity-100 scale-100', 'x-transition:leave-end': 'opacity-0 scale-95' }}
                class="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 overflow-hidden"
            >
                <div class="max-h-[380px] overflow-y-auto py-1">
                    {/* Common areas group */}
                    <template x-if="commonUnits && commonUnits.length > 0">
                        <div>
                            <div class="ih-eyebrow px-3 pt-2 pb-1">Common areas</div>
                            <template x-for="u in commonUnits" {...{ 'x-bind:key': 'u.id' }}>
                                <button
                                    type="button"
                                    {...{ 'x-on:click': 'setActiveUnit(u.id); unitOpen = false' }}
                                    class="w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors group ih-row"
                                    x-bind:class="activeUnitId === u.id ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-bold' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'"
                                >
                                    <span class="px-1 py-0 rounded text-[8px] font-extrabold uppercase tracking-[0.05em]" style="background: rgba(245,158,11,0.16); color: #b45309;">Common</span>
                                    <span class="flex-1 truncate" x-text="u.name"></span>
                                    <span class="ih-row__hover flex items-center gap-1">
                                        <button type="button" {...{ 'x-on:click.stop': 'renameUnit(u.id, u.name)' }} class="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-indigo-600" title="Rename">
                                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                        </button>
                                        <button type="button" {...{ 'x-on:click.stop': 'duplicateUnit(u.id)' }} class="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-indigo-600" title="Duplicate">
                                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                                        </button>
                                        <button type="button" {...{ 'x-on:click.stop': 'removeUnit(u.id)' }} class="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-rose-600" title="Remove">
                                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                        </button>
                                    </span>
                                </button>
                            </template>
                        </div>
                    </template>

                    {/* Individual units group */}
                    <template x-if="regularUnits && regularUnits.length > 0">
                        <div>
                            <div class="ih-eyebrow px-3 pt-2 pb-1">Individual units</div>
                            <template x-for="u in regularUnits" {...{ 'x-bind:key': 'u.id' }}>
                                <button
                                    type="button"
                                    {...{ 'x-on:click': 'setActiveUnit(u.id); unitOpen = false' }}
                                    class="w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors group ih-row"
                                    x-bind:class="activeUnitId === u.id ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-bold' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'"
                                >
                                    <span class="flex-1 truncate" x-text="u.name"></span>
                                    <span class="ih-row__hover flex items-center gap-1">
                                        <button type="button" {...{ 'x-on:click.stop': 'renameUnit(u.id, u.name)' }} class="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-indigo-600" title="Rename">
                                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                        </button>
                                        <button type="button" {...{ 'x-on:click.stop': 'duplicateUnit(u.id)' }} class="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-indigo-600" title="Duplicate">
                                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                                        </button>
                                        <button type="button" {...{ 'x-on:click.stop': 'removeUnit(u.id)' }} class="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-rose-600" title="Remove">
                                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                        </button>
                                    </span>
                                </button>
                            </template>
                        </div>
                    </template>
                </div>

                {/* Footer: Add unit / Add common area */}
                <div class="border-t border-slate-200 dark:border-slate-700 px-3 py-2 flex items-center gap-3">
                    <button
                        type="button"
                        {...{ 'x-on:click': "addUnit('unit', activeBuildingId); unitOpen = false" }}
                        class="inline-flex items-center gap-1.5 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                        Add unit
                    </button>
                    <button
                        type="button"
                        {...{ 'x-on:click': "addUnit('common', activeBuildingId); unitOpen = false" }}
                        class="inline-flex items-center gap-1.5 text-[11px] font-bold hover:underline"
                        style="color: #b45309"
                    >
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                        Add common area
                    </button>
                </div>
            </div>
        </div>
    </div>
);

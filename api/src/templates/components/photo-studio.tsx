/**
 * Design System 0520 — M14 PhotoStudio MVP (subsystem A, phase 4).
 *
 * Full-screen photo annotation overlay opened from any photo thumbnail in
 * inspection-edit. State + drawing handlers live in the standalone Alpine
 * factory `window.photoStudio()` (public/js/photo-studio.js) so this
 * component remains markup-only.
 *
 * Tools: Pan (default) / Circle / Arrow / Freehand / Label.
 * All shapes use `--ih-status-bad` (rose) at stroke 3 — single-colour MVP.
 *
 * Entry: window.dispatchEvent(new CustomEvent('open-photo-studio',
 *   { detail: { media: {...}, inspectionContext: { sectionName, itemTitle } } }))
 *
 * Save: PUT /api/inspections/:id/media/:mediaId/annotations
 *       (UpdateMediaAnnotationsSchema — 8 KB / 200 char limits)
 */

interface Tool {
    id:    'pan' | 'circle' | 'arrow' | 'draw' | 'label';
    /** Heroicons-outline path data rendered inside a 24-viewBox SVG with
     *  stroke=2 / fill=none / currentColor. `null` means render the literal
     *  `letter` glyph instead (used by the typography 'label' tool). */
    iconPath: string | null;
    letter?:  string;
    name:    string;
}

const TOOLS: Tool[] = [
    { id: 'pan',    iconPath: 'M9 11.25V5.25a2.25 2.25 0 014.5 0v6m0 0V3.75a2.25 2.25 0 014.5 0v9.75M13.5 11.25V7.5a2.25 2.25 0 014.5 0v6m-9 1.5l-1.5-3-1.125-1.125a1.875 1.875 0 112.652-2.652L9 9.75m9 4.5c0 4-3.25 6.75-7.5 6.75-2.5 0-4-1.5-5.25-3l-1.5-2.25', name: 'Pan' },
    { id: 'circle', iconPath: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0z', name: 'Circle' },
    { id: 'arrow',  iconPath: 'M4.5 19.5l15-15M19.5 19.5V4.5h-15', name: 'Arrow' },
    { id: 'draw',   iconPath: 'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z', name: 'Draw' },
    { id: 'label',  iconPath: null, letter: 'A', name: 'Label' },
];

export function PhotoStudio(): JSX.Element {
    return (
        <div
            x-data="photoStudio()"
            x-show="open"
            x-cloak
            style="display: none"
            class="fixed inset-0 z-50 bg-slate-900/95 backdrop-blur-sm flex flex-col text-white"
            role="dialog"
            aria-modal="true"
            aria-label="Photo annotation studio"
        >
            {/* Header */}
            <div class="flex items-center justify-between px-6 py-3 border-b border-white/10">
                <button
                    type="button"
                    class="ih-btn ih-btn--ghost text-white"
                    x-on:click="close()"
                    aria-label="Close photo studio"
                >×</button>
                <div class="text-sm truncate max-w-xl" x-text="caption || autoCaption"></div>
                <div class="flex gap-2">
                    <button
                        type="button"
                        class="ih-btn ih-btn--secondary"
                        x-on:click="showInfo = !showInfo"
                        aria-label="Toggle EXIF info panel"
                    >Info ⓘ</button>
                    <button
                        type="button"
                        class="ih-btn ih-btn--primary"
                        x-on:click="save()"
                        x-bind:disabled="saving"
                    >Save</button>
                </div>
            </div>

            <div class="flex-1 flex overflow-hidden">
                {/* Tool palette */}
                <div class="w-16 flex flex-col gap-2 p-2 border-r border-white/10 bg-slate-900/40">
                    {TOOLS.map(t => (
                        <button
                            type="button"
                            class="w-12 h-12 rounded flex items-center justify-center transition-colors"
                            x-bind:class={`tool === '${t.id}' ? 'bg-indigo-600 text-white' : 'bg-slate-700 hover:bg-slate-600 text-white'`}
                            x-on:click={`selectTool('${t.id}')`}
                            aria-label={t.name}
                            title={t.name}
                            key={t.id}
                        >
                            {t.iconPath
                                ? <svg aria-hidden="true" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d={t.iconPath} /></svg>
                                : <span aria-hidden="true" class="font-bold text-lg">{t.letter}</span>}
                        </button>
                    ))}
                </div>

                {/* Canvas */}
                <div class="flex-1 flex items-center justify-center relative overflow-hidden bg-slate-950">
                    <svg
                        class="max-w-full max-h-full select-none"
                        x-bind:viewBox="'0 0 ' + ((media && media.naturalWidth) || 1000) + ' ' + ((media && media.naturalHeight) || 750)"
                        x-on:pointerdown="onPointerDown($event)"
                        x-on:pointermove="onPointerMove($event)"
                        x-on:pointerup="onPointerUp($event)"
                        style="touch-action: none;"
                    >
                        <image
                            x="0"
                            y="0"
                            x-bind:href="media && media.url"
                            x-bind:width="(media && media.naturalWidth) || 1000"
                            x-bind:height="(media && media.naturalHeight) || 750"
                        />
                        {/* In-progress freehand path */}
                        <path
                            x-show="drawing && tool === 'draw' && currentPath"
                            x-bind:d="currentPath"
                            fill="none"
                            stroke="var(--ih-status-bad)"
                            stroke-width="3"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        />
                        {/* Committed shapes */}
                        <template x-for="(s, i) in shapes" x-bind:key="i">
                            <g>
                                <template x-if="s.type === 'circle'">
                                    <ellipse
                                        x-bind:cx="s.cx" x-bind:cy="s.cy" x-bind:rx="s.rx" x-bind:ry="s.ry"
                                        fill="none" stroke="var(--ih-status-bad)" stroke-width="3"
                                    />
                                </template>
                                <template x-if="s.type === 'arrow'">
                                    <line
                                        x-bind:x1="s.x1" x-bind:y1="s.y1" x-bind:x2="s.x2" x-bind:y2="s.y2"
                                        stroke="var(--ih-status-bad)" stroke-width="3"
                                        marker-end="url(#ph-arrow)"
                                    />
                                </template>
                                <template x-if="s.type === 'freehand'">
                                    <path
                                        x-bind:d="s.d" fill="none"
                                        stroke="var(--ih-status-bad)" stroke-width="3"
                                        stroke-linecap="round" stroke-linejoin="round"
                                    />
                                </template>
                                <template x-if="s.type === 'label'">
                                    <text
                                        x-bind:x="s.x" x-bind:y="s.y" x-text="s.text"
                                        fill="white" stroke="var(--ih-status-bad)" stroke-width="1"
                                        font-size="16" font-family="Inter, system-ui, sans-serif"
                                    />
                                </template>
                            </g>
                        </template>
                        <defs>
                            <marker id="ph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                                <path d="M0,0 L10,5 L0,10 z" fill="var(--ih-status-bad)" />
                            </marker>
                        </defs>
                    </svg>
                </div>

                {/* EXIF panel (slide-in from the right) */}
                <div
                    x-show="showInfo"
                    x-cloak
                    class="w-64 p-4 border-l border-white/10 text-sm space-y-3 overflow-y-auto bg-slate-900/40"
                >
                    <h3 class="ih-eyebrow text-slate-300">Photo info</h3>
                    <template x-if="!exif">
                        <p class="ih-meta">EXIF unavailable</p>
                    </template>
                    <template x-if="exif">
                        <div class="space-y-3">
                            <div>
                                <div class="ih-eyebrow text-slate-400 mb-1">Date taken</div>
                                <div x-text="exif.date || '—'"></div>
                            </div>
                            <div>
                                <div class="ih-eyebrow text-slate-400 mb-1">GPS</div>
                                <div x-text="exif.gps || '—'"></div>
                            </div>
                            <div>
                                <div class="ih-eyebrow text-slate-400 mb-1">Device</div>
                                <div x-text="exif.device || '—'"></div>
                            </div>
                            <div>
                                <div class="ih-eyebrow text-slate-400 mb-1">Dimensions</div>
                                <div x-text="exif.dim || '—'"></div>
                            </div>
                        </div>
                    </template>
                </div>
            </div>

            {/* Footer: caption + undo / redo / reset */}
            <div class="px-6 py-3 border-t border-white/10 flex items-center gap-3 bg-slate-900/40">
                <label class="text-sm flex-1 flex items-center gap-2">
                    <span class="ih-eyebrow text-slate-400 shrink-0">Caption:</span>
                    <input
                        type="text"
                        class="ih-input flex-1 bg-slate-800 text-white border-white/20"
                        x-model="caption"
                        maxlength={200}
                        aria-label="Photo caption"
                    />
                </label>
                <button type="button" class="ih-btn ih-btn--ghost text-white" x-on:click="undo()" aria-label="Undo">↺</button>
                <button type="button" class="ih-btn ih-btn--ghost text-white" x-on:click="redoShape()" aria-label="Redo">↻</button>
                <button type="button" class="ih-btn ih-btn--danger inline-flex items-center gap-1.5" x-on:click="reset()" aria-label="Reset all annotations and caption">
                    <svg aria-hidden="true" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                    Reset
                </button>
            </div>
        </div>
    );
}

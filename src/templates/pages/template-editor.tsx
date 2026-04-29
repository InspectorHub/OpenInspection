import { BareLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

const EDITOR_CSS = `
.bg-grid { background-image: radial-gradient(circle, #d5d0c8 0.75px, transparent 0.75px); background-size: 24px 24px; }
.glass-warm { background: rgba(255, 253, 250, 0.82); backdrop-filter: blur(16px) saturate(1.5); border: 1px solid rgba(255,255,255,0.7); }
.scrollbar-thin::-webkit-scrollbar { width: 4px; }
.scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
.scrollbar-thin::-webkit-scrollbar-thumb { background: #d0cbc4; border-radius: 999px; }
.drag-handle { cursor: grab; touch-action: none; }
.drag-handle:active { cursor: grabbing; }
.sortable-ghost { opacity: 0.35; }
.sortable-chosen { box-shadow: 0 8px 25px -5px rgba(74, 114, 255, 0.25); transform: scale(1.02); z-index: 50; }
.sortable-drag { opacity: 0.9; }
.icon-picker-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
.icon-btn { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 12px; cursor: pointer; transition: all 0.15s; border: 2px solid transparent; }
.icon-btn:hover { background: #eef4ff; border-color: #bcd2ff; }
.icon-btn.active { background: #eef4ff; border-color: #4a72ff; }
[x-cloak] { display: none !important; }
.section-accent { border-left: 3px solid var(--section-color, #4a72ff); }
.rating-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
input:focus, textarea:focus, select:focus { outline: none; box-shadow: 0 0 0 3px rgba(74, 114, 255, 0.15); }
`;

export const TemplateEditorPage = ({ templateId, branding }: { templateId: string; branding?: BrandingConfig | undefined }): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';

    return (
        <BareLayout
            title={`Template Editor | ${siteName}`}
            {...(branding ? { branding } : {})}
            extraHead={<style dangerouslySetInnerHTML={{ __html: EDITOR_CSS }} />}
        >
            <div class="bg-surface-50 bg-grid text-ink-900 antialiased min-h-screen" x-data="templateEditor()" x-cloak data-template-id={templateId}>

                {/* Top Bar */}
                <header class="sticky top-0 z-50 border-b border-surface-200/60 bg-surface-50/90 backdrop-blur-xl">
                    <div class="flex items-center justify-between px-6 h-16">
                        <div class="flex items-center gap-4">
                            <a href="/templates" class="w-9 h-9 rounded-xl bg-surface-100 hover:bg-surface-200 flex items-center justify-center transition-colors group">
                                <svg class="w-4 h-4 text-ink-500 group-hover:text-ink-800 transition-colors" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
                            </a>
                            <div class="flex items-center gap-3">
                                <input type="text" x-model="template.title"
                                    class="text-xl font-display font-700 bg-transparent border-b-2 border-transparent hover:border-surface-200 focus:border-blueprint-500 px-1 py-0.5 transition-colors min-w-[200px]"
                                    placeholder="Template Name" />
                                <span class="font-mono text-[10px] font-600 text-ink-400 bg-surface-100 px-2.5 py-1 rounded-lg tracking-wide" x-text="'v' + template.version"></span>
                                <span x-show="template.source" class="inline-flex items-center gap-1 text-[10px] font-600 px-2 py-0.5 rounded-md"
                                    x-bind:class="template.source?.platform === 'spectora' ? 'bg-orange-50 text-orange-600' : template.source?.platform === 'itb' ? 'bg-emerald-50 text-emerald-600' : 'bg-surface-100 text-ink-400'"
                                    x-text="template.source?.platform?.toUpperCase()"></span>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <button {...{'@click': 'showRatingModal = true'}} class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-600 text-ink-600 hover:bg-surface-100 transition-colors">
                                <div class="flex -space-x-1">
                                    <template x-for="l in template.ratingSystem.levels.slice(0,4)" x-bind:key="l.id">
                                        <span class="rating-dot ring-2 ring-surface-50" x-bind:style="'background:'+l.color"></span>
                                    </template>
                                </div>
                                <span x-text="template.ratingSystem.name" class="max-w-[140px] truncate"></span>
                            </button>
                            <div class="w-px h-6 bg-surface-200 mx-1"></div>
                            <button {...{'@click': 'showCannedPanel = !showCannedPanel'}} class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-600 transition-colors"
                                x-bind:class="showCannedPanel ? 'bg-blueprint-50 text-blueprint-600' : 'text-ink-600 hover:bg-surface-100'">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/></svg>
                                Comments
                                <span class="bg-ink-300/20 text-ink-600 text-[10px] font-mono font-600 px-1.5 py-0.5 rounded" x-text="cannedComments.length"></span>
                            </button>
                            <div class="w-px h-6 bg-surface-200 mx-1"></div>
                            <button {...{'@click': 'previewMode = !previewMode'}} class="px-4 py-2 rounded-xl text-sm font-600 transition-colors"
                                x-bind:class="previewMode ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-surface-100'">
                                <span x-text="previewMode ? 'Editing' : 'Preview'"></span>
                            </button>
                            <button {...{'@click': 'saveTemplate()'}} class="ml-2 px-6 py-2 rounded-xl bg-blueprint-600 text-white text-sm font-700 hover:bg-blueprint-700 active:scale-[0.97] transition-all shadow-lg shadow-blueprint-600/20"
                                x-bind:disabled="saving">
                                <span x-show="!saving">Save</span>
                                <span x-show="saving">Saving...</span>
                            </button>
                        </div>
                    </div>
                </header>

                {/* Main 3-Panel Layout */}
                <div class="flex h-[calc(100vh-4rem)]">

                    {/* LEFT: Sections Panel */}
                    <aside class="w-[260px] border-r border-surface-200/60 bg-white/50 flex flex-col flex-shrink-0">
                        <div class="px-4 pt-5 pb-3 flex items-center justify-between">
                            <h2 class="text-[11px] font-800 uppercase tracking-[0.12em] text-ink-400 font-display">Sections</h2>
                            <button {...{'@click': 'addSection()'}} class="w-7 h-7 rounded-lg bg-blueprint-50 text-blueprint-600 hover:bg-blueprint-100 flex items-center justify-center transition-colors">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" d="M12 5v14m7-7H5"/></svg>
                            </button>
                        </div>
                        <div id="sectionsList" class="flex-1 overflow-y-auto px-2 pb-4 space-y-1 scrollbar-thin">
                            <template x-for="(section, si) in template.sections" x-bind:key="section.id">
                                <div x-bind:data-id="section.id" {...{'@click': 'selectSection(section.id)'}}
                                    class="w-full text-left px-3 py-3 rounded-xl group transition-all relative cursor-pointer"
                                    x-bind:class="selectedSectionId === section.id ? 'bg-blueprint-50 text-blueprint-700' : 'hover:bg-surface-100 text-ink-700'">
                                    <div class="flex items-center gap-2.5">
                                        <span class="drag-handle text-ink-300 hover:text-ink-500 flex-shrink-0">
                                            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
                                        </span>
                                        <span class="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                                            x-bind:style="selectedSectionId === section.id ? 'background:' + sectionColor(section) + '18; color:' + sectionColor(section) : 'background: #f3f1ed; color: #908a83'">
                                            <template x-if="getSectionIconSvg(section.icon)">
                                                <span x-html="getSectionIconSvg(section.icon)"></span>
                                            </template>
                                            <template x-if="!getSectionIconSvg(section.icon)">
                                                <span class="text-xs font-display font-700" x-text="section.title.charAt(0)"></span>
                                            </template>
                                        </span>
                                        <div class="flex-1 min-w-0">
                                            <div class="text-sm font-600 truncate" x-text="section.title"></div>
                                            <div class="text-[10px] font-mono text-ink-400 mt-0.5" x-text="section.items.length + ' items'"></div>
                                        </div>
                                        <span x-show="section.source" class="w-2 h-2 rounded-full flex-shrink-0"
                                            x-bind:class="section.source?.platform === 'spectora' ? 'bg-orange-400' : 'bg-emerald-400'"></span>
                                    </div>
                                    <span class="absolute top-1.5 right-1.5 text-[9px] font-mono text-ink-300 opacity-0 group-hover:opacity-100 transition-opacity" x-text="'#' + si"></span>
                                </div>
                            </template>
                        </div>
                    </aside>

                    {/* CENTER: Items Panel */}
                    <main class="flex-1 overflow-y-auto bg-surface-50/50">
                        <template x-if="selectedSection">
                            <div class="animate-fade-in">
                                <div class="sticky top-0 z-10 bg-surface-50/90 backdrop-blur-sm border-b border-surface-200/40 px-8 py-5">
                                    <div class="flex items-center justify-between">
                                        <div class="flex items-center gap-4">
                                            <div class="relative">
                                                <button {...{'@click': 'showIconPicker = !showIconPicker'}}
                                                    class="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:ring-2 hover:ring-blueprint-200"
                                                    x-bind:style="'background: ' + (sectionColor(selectedSection) + '15') + '; color: ' + sectionColor(selectedSection)">
                                                    <template x-if="getSectionIconSvg(selectedSection.icon, 'w-5 h-5')">
                                                        <span x-html="getSectionIconSvg(selectedSection.icon, 'w-5 h-5')"></span>
                                                    </template>
                                                    <template x-if="!getSectionIconSvg(selectedSection.icon, 'w-5 h-5')">
                                                        <span class="text-lg font-display font-800" x-text="selectedSection.title.charAt(0)"></span>
                                                    </template>
                                                </button>
                                                <div x-show="showIconPicker" x-cloak {...{'@click.outside': 'showIconPicker = false'}}
                                                    x-transition:enter="transition ease-out duration-150" x-transition:enter-start="opacity-0 scale-95" x-transition:enter-end="opacity-100 scale-100"
                                                    class="absolute top-12 left-0 z-50 bg-white rounded-2xl shadow-2xl border border-surface-200 p-3 w-[280px]">
                                                    <div class="text-[10px] font-700 uppercase tracking-[0.1em] text-ink-400 mb-2 px-1">Section Icon</div>
                                                    <div class="icon-picker-grid">
                                                        <template x-for="ic in sectionIconKeys" x-bind:key="ic">
                                                            <button {...{'@click': "selectedSection.icon = ic; showIconPicker = false"}}
                                                                class="icon-btn" x-bind:class="selectedSection.icon === ic ? 'active' : ''"
                                                                x-html="getSectionIconSvg(ic, 'w-5 h-5')"
                                                                x-bind:title="ic.replace(/_/g, ' ')"></button>
                                                        </template>
                                                    </div>
                                                    <button {...{'@click': "selectedSection.icon = ''; showIconPicker = false"}}
                                                        class="mt-2 w-full text-[10px] font-600 text-ink-400 hover:text-ink-600 py-1.5 rounded-lg hover:bg-surface-50 transition-colors">Clear Icon</button>
                                                </div>
                                            </div>
                                            <div>
                                                <input x-model="selectedSection.title" class="text-lg font-display font-700 bg-transparent border-b border-transparent hover:border-surface-200 focus:border-blueprint-500 transition-colors" />
                                                <div class="flex items-center gap-3 mt-0.5">
                                                    <span x-show="selectedSection.identifier" class="font-mono text-[10px] text-ink-400" x-text="selectedSection.identifier"></span>
                                                    <span x-show="selectedSection.disclaimerText" class="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">has disclaimer</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="flex items-center gap-2">
                                            <button {...{'@click': 'addItem()'}} class="flex items-center gap-2 px-4 py-2 rounded-xl bg-blueprint-600 text-white text-sm font-600 hover:bg-blueprint-700 active:scale-[0.97] transition-all shadow-md shadow-blueprint-600/15">
                                                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" d="M12 5v14m7-7H5"/></svg>
                                                Add Item
                                            </button>
                                            <button {...{'@click': 'removeSection(selectedSectionId)'}} class="w-9 h-9 rounded-xl text-ink-400 hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition-colors">
                                                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div id="itemsList" class="px-8 py-6 space-y-3">
                                    <template x-for="(item, ii) in selectedSection.items" x-bind:key="item.id">
                                        <div x-bind:data-id="item.id" class="section-accent rounded-2xl bg-white shadow-sm hover:shadow-md transition-all animate-slide-up"
                                            x-bind:style="'--section-color:' + sectionColor(selectedSection)"
                                            {...{'@click': 'selectItem(item.id)'}}>
                                            <div class="px-5 py-4 flex items-center gap-4 cursor-pointer"
                                                x-bind:class="selectedItemId === item.id ? 'bg-blueprint-50/40' : ''">
                                                <span class="drag-handle text-ink-300 hover:text-ink-500 flex-shrink-0">
                                                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
                                                </span>
                                                <div class="flex-1 min-w-0">
                                                    <div class="flex items-center gap-2">
                                                        <span class="text-sm font-600" x-text="item.label"></span>
                                                        <span x-show="item.required" class="text-[9px] font-700 text-red-500 bg-red-50 px-1.5 py-0.5 rounded uppercase">req</span>
                                                        <span x-show="item.isSafety" class="text-[9px] font-700 text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded uppercase">safety</span>
                                                    </div>
                                                    <div class="flex items-center gap-3 mt-1">
                                                        <span class="inline-flex items-center gap-1 text-[10px] font-mono font-500 text-ink-400 bg-surface-100 px-2 py-0.5 rounded">
                                                            <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h8m-8 6h16"/></svg>
                                                            <span x-text="item.type"></span>
                                                        </span>
                                                        <span x-show="item.attributes && item.attributes.length" class="text-[10px] font-mono text-ink-400">
                                                            <span x-text="item.attributes.length"></span> attrs
                                                        </span>
                                                        <span x-show="item.source" class="text-[10px] px-1.5 py-0.5 rounded"
                                                            x-bind:class="item.source?.platform === 'spectora' ? 'bg-orange-50 text-orange-500' : 'bg-emerald-50 text-emerald-500'"
                                                            x-text="item.source?.platform"></span>
                                                    </div>
                                                </div>
                                                <div class="flex items-center gap-2">
                                                    <span x-show="item.defaultRecommendation" class="text-[10px] text-blue-500 bg-blue-50 px-2 py-0.5 rounded-md font-500" x-text="item.defaultRecommendation"></span>
                                                    <svg class="w-4 h-4 text-ink-300 transition-transform" x-bind:class="selectedItemId === item.id ? 'rotate-90' : ''" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
                                                </div>
                                            </div>

                                            <div x-show="selectedItemId === item.id && item.attributes && item.attributes.length > 0" x-collapse
                                                class="px-5 pb-4 border-t border-surface-100">
                                                <div class="mt-3 space-y-1.5">
                                                    <div class="text-[10px] font-700 uppercase tracking-[0.1em] text-ink-400 mb-2">Attributes</div>
                                                    <template x-for="attr in item.attributes" x-bind:key="attr.id">
                                                        <div class="flex items-center gap-3 py-1.5 px-3 rounded-lg bg-surface-50 text-sm">
                                                            <span class="w-16 text-[10px] font-mono text-ink-400 uppercase" x-text="attr.type"></span>
                                                            <span class="font-500 text-ink-700 flex-1 truncate" x-text="attr.name"></span>
                                                            <span x-show="attr.choices && attr.choices.length" class="text-[10px] text-ink-400" x-text="attr.choices.length + ' opts'"></span>
                                                            <span x-show="attr.isSafety" class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                                                            <span x-show="attr.isDefect" class="w-1.5 h-1.5 rounded-full bg-red-400"></span>
                                                        </div>
                                                    </template>
                                                </div>
                                            </div>
                                        </div>
                                    </template>

                                    <div x-show="!selectedSection.items.length" class="text-center py-20 animate-fade-in">
                                        <div class="w-16 h-16 rounded-2xl bg-surface-100 flex items-center justify-center mx-auto mb-4">
                                            <svg class="w-8 h-8 text-ink-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
                                        </div>
                                        <p class="text-ink-400 font-500">No items yet</p>
                                        <p class="text-ink-300 text-sm mt-1">Add inspection points to this section</p>
                                    </div>
                                </div>

                                <div x-show="selectedSection" class="px-8 pb-6">
                                    <details class="group">
                                        <summary class="text-[11px] font-700 uppercase tracking-[0.1em] text-ink-400 cursor-pointer hover:text-ink-600 transition-colors select-none flex items-center gap-2">
                                            <svg class="w-3 h-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" d="M9 5l7 7-7 7"/></svg>
                                            Section Disclaimer
                                        </summary>
                                        <textarea x-model="selectedSection.disclaimerText" rows={3}
                                            class="mt-3 w-full text-sm bg-amber-50/50 border border-amber-200/50 rounded-xl px-4 py-3 resize-none font-body text-ink-600 placeholder:text-ink-300"
                                            placeholder="Optional legal disclaimer text shown at bottom of this section..."></textarea>
                                    </details>
                                </div>
                            </div>
                        </template>

                        <template x-if="!selectedSection">
                            <div class="flex items-center justify-center h-full text-center animate-fade-in">
                                <div>
                                    <div class="w-24 h-24 rounded-3xl bg-surface-100 flex items-center justify-center mx-auto mb-6 rotate-3">
                                        <svg class="w-12 h-12 text-ink-300" fill="none" stroke="currentColor" stroke-width="1.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                                    </div>
                                    <h3 class="text-xl font-display font-700 text-ink-700 mb-2">Select a Section</h3>
                                    <p class="text-sm text-ink-400 max-w-xs mx-auto">Choose a section from the left panel to view and edit its inspection items.</p>
                                </div>
                            </div>
                        </template>
                    </main>

                    {/* RIGHT: Properties Panel */}
                    <aside class="w-[340px] border-l border-surface-200/60 bg-white/50 flex flex-col flex-shrink-0 overflow-y-auto scrollbar-thin"
                        x-show="selectedItem" x-transition:enter="transition ease-out duration-200"
                        x-transition:enter-start="opacity-0 translate-x-4" x-transition:enter-end="opacity-100 translate-x-0">
                        <template x-if="selectedItem">
                            <div class="animate-fade-in">
                                <div class="px-5 py-4 border-b border-surface-200/40 sticky top-0 bg-white/80 backdrop-blur-sm z-10">
                                    <div class="flex items-center justify-between mb-1">
                                        <span class="text-[11px] font-800 uppercase tracking-[0.12em] text-ink-400 font-display">Item Properties</span>
                                        <button {...{'@click': 'removeItem(selectedItemId)'}} class="text-ink-300 hover:text-red-500 transition-colors p-1">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                        </button>
                                    </div>
                                    <span class="font-mono text-[10px] text-ink-300" x-text="selectedItem.id"></span>
                                </div>

                                <div class="p-5 space-y-5">
                                    <div class="space-y-1.5">
                                        <label class="text-[10px] font-700 uppercase tracking-[0.1em] text-ink-400">Label</label>
                                        <input type="text" x-model="selectedItem.label" class="w-full px-3 py-2.5 text-sm font-500 rounded-xl border border-surface-200 bg-white focus:border-blueprint-500 transition-colors" />
                                    </div>
                                    <div class="space-y-1.5">
                                        <label class="text-[10px] font-700 uppercase tracking-[0.1em] text-ink-400">Description</label>
                                        <textarea x-model="selectedItem.description" rows={2} class="w-full px-3 py-2.5 text-sm rounded-xl border border-surface-200 bg-white focus:border-blueprint-500 transition-colors resize-none"></textarea>
                                    </div>
                                    <div class="space-y-1.5">
                                        <label class="text-[10px] font-700 uppercase tracking-[0.1em] text-ink-400">Input Type</label>
                                        <select x-model="selectedItem.type" class="w-full px-3 py-2.5 text-sm font-500 rounded-xl border border-surface-200 bg-white focus:border-blueprint-500 transition-colors appearance-none"
                                            style="background-image: url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 fill=%22none%22 viewBox=%220 0 24 24%22 stroke=%22%236b6560%22%3E%3Cpath stroke-linecap=%22round%22 stroke-linejoin=%22round%22 stroke-width=%222%22 d=%22M19 9l-7 7-7-7%22/%3E%3C/svg%3E'); background-repeat: no-repeat; background-position: right 12px center; background-size: 16px; padding-right: 36px;">
                                            <option value="rating">Rating (buttons)</option>
                                            <option value="boolean">Boolean (yes/no)</option>
                                            <option value="text">Text (single line)</option>
                                            <option value="textarea">Textarea (multi-line)</option>
                                            <option value="number">Number</option>
                                            <option value="select">Select (dropdown)</option>
                                            <option value="multi_select">Multi-Select (checkboxes)</option>
                                            <option value="date">Date</option>
                                            <option value="photo_only">Photo Only</option>
                                        </select>
                                    </div>
                                    <div x-show="selectedItem.type === 'select' || selectedItem.type === 'multi_select'" class="space-y-1.5">
                                        <label class="text-[10px] font-700 uppercase tracking-[0.1em] text-ink-400">Choices</label>
                                        <textarea x-model="choicesText" {...{'@input': 'updateChoices()'}} rows={3}
                                            class="w-full px-3 py-2.5 text-sm font-mono rounded-xl border border-surface-200 bg-white focus:border-blueprint-500 transition-colors resize-none"
                                            placeholder="One choice per line..."></textarea>
                                    </div>
                                    <div x-show="selectedItem.type === 'number'" class="grid grid-cols-3 gap-2">
                                        <div class="space-y-1">
                                            <label class="text-[9px] font-700 uppercase tracking-[0.1em] text-ink-400">Min</label>
                                            <input type="number" {...{'x-model.number': 'selectedItem.options.min'}} class="w-full px-2 py-2 text-sm font-mono rounded-lg border border-surface-200 bg-white text-center" />
                                        </div>
                                        <div class="space-y-1">
                                            <label class="text-[9px] font-700 uppercase tracking-[0.1em] text-ink-400">Max</label>
                                            <input type="number" {...{'x-model.number': 'selectedItem.options.max'}} class="w-full px-2 py-2 text-sm font-mono rounded-lg border border-surface-200 bg-white text-center" />
                                        </div>
                                        <div class="space-y-1">
                                            <label class="text-[9px] font-700 uppercase tracking-[0.1em] text-ink-400">Unit</label>
                                            <input type="text" x-model="selectedItem.options.unit" class="w-full px-2 py-2 text-sm rounded-lg border border-surface-200 bg-white" placeholder="sqft" />
                                        </div>
                                    </div>
                                    <hr class="border-surface-200/60" />
                                    <div class="space-y-3">
                                        <label class="text-[10px] font-700 uppercase tracking-[0.1em] text-ink-400">Flags</label>
                                        <label class="flex items-center gap-3 cursor-pointer group">
                                            <input type="checkbox" x-model="selectedItem.required" class="w-4 h-4 rounded border-surface-200 text-blueprint-600 focus:ring-blueprint-500" />
                                            <span class="text-sm font-500 text-ink-600 group-hover:text-ink-900 transition-colors">Required</span>
                                        </label>
                                        <label class="flex items-center gap-3 cursor-pointer group">
                                            <input type="checkbox" x-model="selectedItem.isSafety" class="w-4 h-4 rounded border-surface-200 text-amber-500 focus:ring-amber-500" />
                                            <span class="text-sm font-500 text-ink-600 group-hover:text-ink-900 transition-colors">Safety Item</span>
                                        </label>
                                    </div>
                                    <hr class="border-surface-200/60" />
                                    <div class="space-y-1.5">
                                        <label class="text-[10px] font-700 uppercase tracking-[0.1em] text-ink-400">Default Recommendation</label>
                                        <select x-model="selectedItem.defaultRecommendation" class="w-full px-3 py-2.5 text-sm rounded-xl border border-surface-200 bg-white focus:border-blueprint-500 transition-colors"
                                            style="background-image: url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 fill=%22none%22 viewBox=%220 0 24 24%22 stroke=%22%236b6560%22%3E%3Cpath stroke-linecap=%22round%22 stroke-linejoin=%22round%22 stroke-width=%222%22 d=%22M19 9l-7 7-7-7%22/%3E%3C/svg%3E'); background-repeat: no-repeat; background-position: right 12px center; background-size: 16px; padding-right: 36px;">
                                            <option value="">None</option>
                                            <template x-for="r in recommendationTypes" x-bind:key="r">
                                                <option x-bind:value="r" x-text="r.replace(/_/g, ' ')"></option>
                                            </template>
                                        </select>
                                    </div>
                                    <div class="grid grid-cols-2 gap-3">
                                        <div class="space-y-1">
                                            <label class="text-[9px] font-700 uppercase tracking-[0.1em] text-ink-400">Est. Min ($)</label>
                                            <input type="number" {...{'x-model.number': 'selectedItem.defaultEstimateMin'}} class="w-full px-3 py-2 text-sm font-mono rounded-lg border border-surface-200 bg-white" placeholder="0" />
                                        </div>
                                        <div class="space-y-1">
                                            <label class="text-[9px] font-700 uppercase tracking-[0.1em] text-ink-400">Est. Max ($)</label>
                                            <input type="number" {...{'x-model.number': 'selectedItem.defaultEstimateMax'}} class="w-full px-3 py-2 text-sm font-mono rounded-lg border border-surface-200 bg-white" placeholder="0" />
                                        </div>
                                    </div>
                                    <hr class="border-surface-200/60" />
                                    <div class="space-y-3">
                                        <div class="flex items-center justify-between">
                                            <label class="text-[10px] font-700 uppercase tracking-[0.1em] text-ink-400">Attributes</label>
                                            <button {...{'@click': 'addAttribute()'}} class="text-[10px] font-600 text-blueprint-600 hover:text-blueprint-700 transition-colors flex items-center gap-1">
                                                <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" d="M12 5v14m7-7H5"/></svg>
                                                Add
                                            </button>
                                        </div>
                                        <template x-for="(attr, ai) in selectedItem.attributes" x-bind:key="attr.id">
                                            <div class="p-3 rounded-xl bg-surface-50 space-y-2 animate-scale-in">
                                                <div class="flex items-center justify-between">
                                                    <input type="text" x-model="attr.name" class="text-sm font-500 bg-transparent border-b border-transparent hover:border-surface-200 focus:border-blueprint-500 flex-1 transition-colors" placeholder="Attribute name" />
                                                    <button {...{'@click': 'selectedItem.attributes.splice(ai, 1)'}} class="text-ink-300 hover:text-red-500 transition-colors ml-2 p-0.5">
                                                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/></svg>
                                                    </button>
                                                </div>
                                                <div class="flex items-center gap-2">
                                                    <select x-model="attr.type" class="text-[10px] font-mono px-2 py-1 rounded-md border border-surface-200 bg-white">
                                                        <option value="boolean">boolean</option>
                                                        <option value="text">text</option>
                                                        <option value="number">number</option>
                                                        <option value="select">select</option>
                                                        <option value="multi_select">multi_select</option>
                                                        <option value="date">date</option>
                                                    </select>
                                                    <label class="flex items-center gap-1 text-[10px] text-ink-400">
                                                        <input type="checkbox" x-model="attr.isSafety" class="w-3 h-3 rounded" /> safety
                                                    </label>
                                                    <label class="flex items-center gap-1 text-[10px] text-ink-400">
                                                        <input type="checkbox" x-model="attr.isDefect" class="w-3 h-3 rounded" /> defect
                                                    </label>
                                                </div>
                                                <div x-show="attr.type === 'select' || attr.type === 'multi_select'">
                                                    <input type="text" x-model="attr._choicesStr" {...{'@input': "attr.choices = attr._choicesStr.split(',').map(s=>s.trim()).filter(Boolean)"}}
                                                        class="w-full text-[11px] font-mono px-2 py-1.5 rounded-md border border-surface-200 bg-white"
                                                        placeholder="Choice 1, Choice 2, ..." />
                                                </div>
                                            </div>
                                        </template>
                                        <div x-show="!selectedItem.attributes || !selectedItem.attributes.length" class="text-center py-4">
                                            <p class="text-[11px] text-ink-300">No attributes defined</p>
                                        </div>
                                    </div>
                                    <div x-show="selectedItem.source" class="mt-4 p-3 rounded-xl bg-surface-50 border border-surface-200/50">
                                        <div class="text-[10px] font-700 uppercase tracking-[0.1em] text-ink-400 mb-2">Import Source</div>
                                        <div class="flex items-center gap-2">
                                            <span class="text-[10px] font-600 px-2 py-0.5 rounded"
                                                x-bind:class="selectedItem.source?.platform === 'spectora' ? 'bg-orange-50 text-orange-600' : 'bg-emerald-50 text-emerald-600'"
                                                x-text="selectedItem.source?.platform"></span>
                                            <span class="font-mono text-[10px] text-ink-300" x-text="selectedItem.source?.externalId"></span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </template>
                        <template x-if="!selectedItem">
                            <div class="flex items-center justify-center h-full text-center p-8">
                                <div>
                                    <div class="w-12 h-12 rounded-xl bg-surface-100 flex items-center justify-center mx-auto mb-3">
                                        <svg class="w-6 h-6 text-ink-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg>
                                    </div>
                                    <p class="text-sm text-ink-400 font-500">Select an item to edit</p>
                                </div>
                            </div>
                        </template>
                    </aside>
                </div>

                {/* Rating System Modal */}
                <div x-show="showRatingModal" x-cloak class="fixed inset-0 z-[100] flex items-center justify-center p-6"
                    x-transition:enter="transition ease-out duration-200" x-transition:enter-start="opacity-0" x-transition:enter-end="opacity-100"
                    x-transition:leave="transition ease-in duration-150" x-transition:leave-start="opacity-100" x-transition:leave-end="opacity-0">
                    <div class="absolute inset-0 bg-ink-900/50 backdrop-blur-sm" {...{'@click': 'showRatingModal = false'}}></div>
                    <div class="relative w-full max-w-xl bg-white rounded-3xl shadow-2xl animate-scale-in max-h-[85vh] overflow-hidden flex flex-col">
                        <div class="px-8 pt-8 pb-4 border-b border-surface-100">
                            <h3 class="text-2xl font-display font-700 text-ink-900">Rating System</h3>
                            <p class="text-sm text-ink-400 mt-1">Configure the rating levels for this template</p>
                        </div>
                        <div class="flex-1 overflow-y-auto p-8 space-y-4">
                            <div class="space-y-2">
                                <label class="text-[10px] font-700 uppercase tracking-[0.1em] text-ink-400">Preset</label>
                                <div class="flex flex-wrap gap-2">
                                    <template x-for="preset in ratingPresets" x-bind:key="preset.name">
                                        <button {...{'@click': 'applyRatingPreset(preset)'}} class="px-3 py-1.5 text-sm rounded-lg border transition-colors"
                                            x-bind:class="template.ratingSystem.name === preset.name ? 'border-blueprint-500 bg-blueprint-50 text-blueprint-700 font-600' : 'border-surface-200 text-ink-500 hover:border-surface-300'"
                                            x-text="preset.name"></button>
                                    </template>
                                </div>
                            </div>
                            <hr class="border-surface-100" />
                            <div class="space-y-1.5">
                                <label class="text-[10px] font-700 uppercase tracking-[0.1em] text-ink-400">System Name</label>
                                <input type="text" x-model="template.ratingSystem.name" class="w-full px-3 py-2.5 text-sm font-500 rounded-xl border border-surface-200 bg-white focus:border-blueprint-500 transition-colors" />
                            </div>
                            <div class="space-y-2">
                                <div class="flex items-center justify-between">
                                    <label class="text-[10px] font-700 uppercase tracking-[0.1em] text-ink-400">Levels</label>
                                    <button {...{'@click': 'addRatingLevel()'}} class="text-[10px] font-600 text-blueprint-600 hover:text-blueprint-700 flex items-center gap-1">
                                        <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" d="M12 5v14m7-7H5"/></svg>
                                        Add Level
                                    </button>
                                </div>
                                <template x-for="(level, li) in template.ratingSystem.levels" x-bind:key="level.id">
                                    <div class="flex items-center gap-3 p-3 rounded-xl bg-surface-50 group animate-scale-in">
                                        <input type="color" x-model="level.color" class="w-8 h-8 rounded-lg border-0 cursor-pointer" />
                                        <div class="flex-1 grid grid-cols-4 gap-2">
                                            <input type="text" x-model="level.id" class="text-[10px] font-mono px-2 py-1.5 rounded-md border border-surface-200 bg-white uppercase font-600" placeholder="ID" />
                                            <input type="text" x-model="level.label" class="col-span-2 text-sm px-2 py-1.5 rounded-md border border-surface-200 bg-white font-500" placeholder="Label" />
                                            <input type="text" x-model="level.abbreviation" class="text-[10px] font-mono px-2 py-1.5 rounded-md border border-surface-200 bg-white" placeholder="Abbr" />
                                        </div>
                                        <select x-model="level.severity" class="text-[10px] font-mono px-2 py-1.5 rounded-md border border-surface-200 bg-white">
                                            <option value="good">good</option>
                                            <option value="marginal">marginal</option>
                                            <option value="significant">significant</option>
                                            <option value="minor">minor</option>
                                        </select>
                                        <label class="flex items-center gap-1 text-[10px] text-ink-400 whitespace-nowrap">
                                            <input type="checkbox" x-model="level.isDefect" class="w-3 h-3 rounded" /> defect
                                        </label>
                                        <label class="flex items-center gap-1 text-[10px] text-ink-400 whitespace-nowrap">
                                            <input type="radio" name="default_level" x-bind:value="level.id" x-model="template.ratingSystem.defaultLevelId" class="w-3 h-3" /> default
                                        </label>
                                        <button {...{'@click': 'template.ratingSystem.levels.splice(li, 1)'}} class="text-ink-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/></svg>
                                        </button>
                                    </div>
                                </template>
                            </div>
                        </div>
                        <div class="px-8 py-5 border-t border-surface-100 flex justify-end gap-3">
                            <button {...{'@click': 'showRatingModal = false'}} class="px-5 py-2.5 rounded-xl text-sm font-600 text-ink-500 hover:bg-surface-100 transition-colors">Close</button>
                        </div>
                    </div>
                </div>

                {/* Canned Comments Slide Panel */}
                <div x-show="showCannedPanel" x-cloak
                    class="fixed right-0 top-16 bottom-0 w-[380px] bg-white border-l border-surface-200 shadow-2xl z-40 flex flex-col"
                    x-transition:enter="transition ease-out duration-200" x-transition:enter-start="translate-x-full" x-transition:enter-end="translate-x-0"
                    x-transition:leave="transition ease-in duration-150" x-transition:leave-start="translate-x-0" x-transition:leave-end="translate-x-full">
                    <div class="px-5 py-4 border-b border-surface-200/60 flex items-center justify-between">
                        <h3 class="text-sm font-display font-700">Canned Comments</h3>
                        <button {...{'@click': 'showCannedPanel = false'}} class="text-ink-400 hover:text-ink-700 transition-colors">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/></svg>
                        </button>
                    </div>
                    <div class="p-4">
                        <div class="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-50 border border-surface-200/50">
                            <svg class="w-4 h-4 text-ink-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path stroke-linecap="round" d="M21 21l-4.35-4.35"/></svg>
                            <input type="text" x-model="commentSearch" class="flex-1 text-sm bg-transparent border-0 p-0 focus:ring-0" placeholder="Search comments..." />
                        </div>
                    </div>
                    <div class="px-4 pb-3 space-y-2">
                        <input type="text" x-model="newCommentText" placeholder="Comment text..." class="w-full text-sm px-3 py-2 rounded-xl bg-surface-50 border border-surface-200/50 focus:outline-none focus:border-blueprint-400" />
                        <div class="flex gap-2">
                            <input type="text" x-model="newCommentCategory" placeholder="Category (optional)" class="flex-1 text-sm px-3 py-2 rounded-xl bg-surface-50 border border-surface-200/50 focus:outline-none focus:border-blueprint-400" />
                            <button {...{'@click': 'addCannedComment()'}} class="px-4 py-2 rounded-xl bg-blueprint-600 text-white text-sm font-600 hover:bg-blueprint-700 transition-colors">Add</button>
                        </div>
                    </div>
                    <div class="flex-1 overflow-y-auto px-4 pb-4 space-y-2 scrollbar-thin">
                        <template x-for="cc in filteredComments()" x-bind:key="cc.id">
                            <div class="p-3 rounded-xl bg-surface-50 hover:bg-surface-100 transition-colors group flex items-start justify-between gap-2">
                                <div class="min-w-0">
                                    <span x-show="cc.category" class="text-[9px] font-700 uppercase tracking-wide text-blueprint-500 mr-1" x-text="cc.category"></span>
                                    <span class="text-sm font-600 text-ink-700" x-text="cc.text"></span>
                                </div>
                                <button {...{'@click': 'deleteCannedComment(cc.id)'}} class="shrink-0 text-ink-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all mt-0.5">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/></svg>
                                </button>
                            </div>
                        </template>
                        <p x-show="filteredComments().length === 0" class="text-sm text-ink-400 text-center py-4">No comments yet.</p>
                    </div>
                </div>

            </div>

            {/* Scripts */}
            <script src="/js/auth.js"></script>
            <script src="/vendor/sortable.min.js"></script>
            <script src="/js/template-editor.js"></script>
        </BareLayout>
    );
};

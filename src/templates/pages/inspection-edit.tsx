// src/templates/pages/inspection-edit.tsx
import { BareLayout } from '../layouts/main-layout';
import { Modal, ModalFooter } from '../components/modal';
import { PublishModal } from '../components/publish-modal';
import type { BrandingConfig } from '../../types/auth';
import { RECOMMENDATION_CATEGORIES } from '../../lib/recommendation-categories';

interface InspectionEditProps {
  inspectionId: string;
  branding?: BrandingConfig | undefined;
  // Track E1 — when true, the editor's sub-nav exposes the "Repair List"
  // 6th tab. Default off so existing tenants keep the 5-tab layout.
  enableRepairList?: boolean;
}

/**
 * Sprint 2 S2-3 — Build the grouped <optgroup> payload for the per-defect
 * "Contact contractor" dropdown. Done once at page render, not on every
 * Alpine re-render. The result is serialized into a `<script>` tag below so
 * the editor JS can iterate without an extra fetch.
 */
function buildRecoGroups(): Array<{ group: string; items: Array<{ id: string; label: string; icon?: string }> }> {
    const groups = new Map<string, Array<{ id: string; label: string; icon?: string }>>();
    for (const cat of RECOMMENDATION_CATEGORIES) {
        const arr = groups.get(cat.group) ?? [];
        const item: { id: string; label: string; icon?: string } = { id: cat.id, label: cat.label };
        if (cat.icon) item.icon = cat.icon;
        arr.push(item);
        groups.set(cat.group, arr);
    }
    return Array.from(groups.entries()).map(([group, items]) => ({ group, items }));
}

export function InspectionEditPage({ inspectionId, branding, enableRepairList = false }: InspectionEditProps) {
  const siteName = branding?.siteName || 'OpenInspection';
  const recoGroups = buildRecoGroups();

  return BareLayout({
    title: `${siteName} | Edit Inspection`,
    branding,
    extraHead: (
      <>
        <link rel="stylesheet" href="/fonts.css" />
        <style dangerouslySetInnerHTML={{ __html: `
          /* R41 (2026-05-07) — inspection editor migrated to v3 indigo/slate.
             Inter is the page body font (inherited from main-layout); JetBrains
             Mono used for item numbers + progress counters. */
          .font-mono { font-family: 'JetBrains Mono', monospace; }
          .hide-scrollbar::-webkit-scrollbar { display: none; }
          .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
          [x-cloak] { display: none !important; }
        ` }} />
      </>
    ),
    children: (
      <>
      {/* Sprint 2 S2-5 — Inspection sub-route nav. Renders the 5-tab bar
          (Report / Photos / Summary / Signatures / Settings) at the top of
          the editor so users can switch between sub-routes without leaving
          the page. Kept outside the inspectionEditor x-data scope so it
          stays interactive even if the editor's Alpine init fails. */}
      <nav
        role="tablist"
        aria-label="Inspection sections"
        class="sticky top-0 z-[60] bg-white border-b border-slate-200 print:hidden"
      >
        <div class="max-w-full mx-auto px-4 flex items-center gap-1 overflow-x-auto hide-scrollbar">
          <a
            href={`/inspections/${inspectionId}/report`}
            role="tab"
            aria-current="page"
            aria-selected="true"
            class="px-4 py-2.5 text-[13px] font-bold border-b-2 border-indigo-500 text-slate-900 whitespace-nowrap"
          >Report</a>
          <a
            href={`/inspections/${inspectionId}/photos`}
            role="tab"
            aria-selected="false"
            class="px-4 py-2.5 text-[13px] font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300 whitespace-nowrap transition-colors"
          >Photos</a>
          <a
            href={`/inspections/${inspectionId}/summary`}
            role="tab"
            aria-selected="false"
            class="px-4 py-2.5 text-[13px] font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300 whitespace-nowrap transition-colors"
          >Summary</a>
          {/* Track E1 (ITB §11) — opt-in 6th tab. */}
          {enableRepairList && (
            <a
              href={`/inspections/${inspectionId}/repair-list`}
              role="tab"
              aria-selected="false"
              data-testid="inspection-edit-repair-list-tab"
              class="px-4 py-2.5 text-[13px] font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300 whitespace-nowrap transition-colors"
            >Repair List</a>
          )}
          <a
            href={`/inspections/${inspectionId}/signatures`}
            role="tab"
            aria-selected="false"
            class="px-4 py-2.5 text-[13px] font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300 whitespace-nowrap transition-colors"
          >Signatures</a>
          <a
            href={`/inspections/${inspectionId}/settings`}
            role="tab"
            aria-selected="false"
            class="px-4 py-2.5 text-[13px] font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300 whitespace-nowrap transition-colors"
          >Settings</a>
        </div>
      </nav>
      <div
        x-data={`inspectionEditor('${inspectionId}')`}
        class="min-h-screen"
        style="background: #f8fafc; background-image: radial-gradient(circle, #cbd5e1 0.6px, transparent 0.6px); background-size: 20px 20px;"
      >
        {/* Spec 5G M1.1 — Global hotkey photo input. P key triggers .click()
            on this hidden input; uploadPhoto reads activeItemId. */}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          class="hidden"
          id="hotkey-photo-input"
          x-on:change="if (activeItemId) { uploadPhoto(activeItemId, $event); $event.target.value = ''; }"
        />
        {/* P2 — AI Suggest Comment popover (shared scope with inspectionEditor).
            Single-button footer (Cancel only — picking a suggestion inserts and
            closes), inlined since ModalFooter assumes a Cancel + Confirm pair. */}
        <Modal
            name="showAiPopover"
            title="AI Suggestions"
            subtitle="Pick one to insert into the notes field."
            size="md"
            footer={
                <button
                    type="button"
                    x-on:click="showAiPopover = false"
                    class="h-10 px-6 rounded-xl border bg-white text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-all"
                    style="border-color: #e2e8f0"
                >
                    Cancel
                </button>
            }
        >
            <div class="space-y-2">
                <template x-for="(s, idx) in aiSuggestions" x-bind:key="idx">
                    <button type="button" x-on:click="insertSuggestion(s)" class="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-amber-400 hover:bg-amber-50 transition-all text-sm text-slate-700">
                        <span x-text="s"></span>
                    </button>
                </template>
            </div>
        </Modal>

        {/* ===== Mobile View ===== */}
        <div x-show="!isDesktop" class="lg:hidden">
          {/* Sticky Header */}
          <div class="sticky top-0 z-50" style="background: rgba(255,255,255,0.85); backdrop-filter: blur(16px) saturate(1.5); border-bottom: 1px solid rgba(226,232,240,0.6);">
            <div class="px-4 py-3 flex items-center justify-between">
              <div class="flex items-center gap-3">
                <a href="/dashboard" class="w-8 h-8 rounded-xl bg-white/60 flex items-center justify-center">
                  <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
                </a>
                <div>
                  <h1 class="text-sm font-bold leading-tight" style="color: #0f172a" x-text="inspection.propertyAddress || 'Loading...'"></h1>
                  <p class="text-[10px] font-mono" style="color: #cbd5e1" x-text="formattedDate"></p>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span x-show="saveState === 'saving'" x-cloak class="text-[10px] font-semibold text-amber-500">Saving...</span>
                <span x-show="saveState === 'saved'" x-cloak class="text-[10px] font-semibold text-emerald-500">Saved</span>
                <span x-show="saveState === 'error'" x-cloak class="text-[10px] font-semibold text-red-500">Error</span>
                <span class="text-xs font-mono font-semibold px-2 py-1 rounded-lg" style="background: #eef2ff; color: var(--ih-primary, #6366f1)" x-text="completionPercent + '%'"></span>
                <button x-on:click="toggleCheatsheet()" class="w-8 h-8 rounded-xl bg-white/60 flex items-center justify-center" aria-label="Gesture help">
                  <svg class="w-4 h-4" style="color: #64748b" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>
              </div>
            </div>

            {/* Section Chips */}
            <div class="px-4 pb-3 flex gap-2 overflow-x-auto hide-scrollbar">
              <template x-for="(sec, idx) in sections" x-bind:key="sec.id">
                <button
                  x-on:click="selectSection(idx)"
                  x-show="sectionMatchesSearch(sec)"
                  class="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap"
                  x-bind:class="currentSectionIdx === idx ? 'text-white' : 'bg-white/60 text-gray-600'"
                  x-bind:style="currentSectionIdx === idx ? 'background: var(--ih-primary, #6366f1)' : ''"
                >
                  <span x-show="getSectionIconSvg(sec.icon)" x-html="getSectionIconSvg(sec.icon, 'w-3.5 h-3.5')"></span>
                  <span x-show="!getSectionIconSvg(sec.icon)" class="text-[10px] font-bold" x-text="(sec.title || '').charAt(0)"></span>
                  <span x-text="sec.title"></span>
                  <span x-show="sectionDefectCount(sec.id) > 0"
                    class="w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center"
                    x-text="sectionDefectCount(sec.id)"></span>
                </button>
              </template>
            </div>
          </div>

          {/* Sprint 2 S2-2 — mobile request switcher banner. */}
          <div
            x-data={`requestSwitcher('${inspectionId}')`}
            x-init="load()"
            x-show="hasSiblings"
            style="display:none"
            class="mx-4 mt-3 flex flex-wrap items-center gap-1.5 px-3 py-2 bg-indigo-50 rounded-md border border-indigo-200"
          >
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white ring-1 ring-inset ring-indigo-200 text-[10px] font-bold text-indigo-700">
              Part <span x-text="partIndex"></span> of <span x-text="partTotal"></span>
            </span>
            <span class="text-[10px] text-slate-500" x-text="'request ' + requestIdShort"></span>
            <div class="flex flex-wrap gap-1 mt-1 w-full">
              <template x-for="s in siblings" {...{ 'x-bind:key': 's.id' }}>
                <a
                  x-bind:href="'/inspections/' + s.id + '/report'"
                  x-bind:class="isCurrent(s.id) ? 'px-2 py-0.5 rounded bg-white border border-indigo-300 text-indigo-700 text-[10px] font-bold' : 'px-2 py-0.5 rounded text-slate-600 text-[10px] font-medium hover:bg-white'"
                  x-text="s.templateName"
                ></a>
              </template>
            </div>
          </div>

          {/* Round 32 — one-time gesture hint surfaces R23 swipe nav.
              Auto-dismisses on first successful swipe; tap × to dismiss
              manually. Persisted via localStorage `oi:swipeHint`. */}
          <div
            x-show="!swipeHintDismissed && sections.length > 1"
            x-cloak
            {...{ 'x-transition.opacity': '' }}
            class="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-medium"
            style="background: rgba(99,102,241,0.08); color: var(--ih-primary, #6366f1); border: 1px solid rgba(99,102,241,0.18)"
          >
            <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7l-4 4m0 0l4 4m-4-4h16" />
            </svg>
            <span class="flex-1">Swipe left or right to switch sections</span>
            <button x-on:click="dismissSwipeHint()" class="w-5 h-5 rounded-md flex items-center justify-center hover:bg-white/40" aria-label="Dismiss tip">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Item Cards */}
          <div class="px-4 py-4 space-y-3 pb-24">
            <template x-for="item in currentSectionItems" x-bind:key="item.id">
              <div
                x-bind:data-item-id="item.id"
                x-show="itemMatchesSearch(currentSection, item)"
                class="rounded-md p-4 transition-all cursor-pointer"
                style="background: rgba(255,255,255,0.85); backdrop-filter: blur(16px) saturate(1.5); border: 1px solid rgba(255,255,255,0.7); border-left: 3px solid transparent; touch-action: manipulation;"
                x-bind:style="(activeItemId === item.id ? 'border-color: #6366f1; ' : '') + 'border-left-color: ' + getRatingColor(getItemRating(item.id))"
                x-bind:class="activeItemId === item.id ? 'ring-2 ring-indigo-100' : ''"
                x-on:click="setActiveItem(item.id)"
                x-on:touchstart="onItemTouchStart(item.id, $event)"
                x-on:touchmove="onItemTouchMove($event)"
                x-on:touchend="onItemTouchEnd(item.id)"
              >
                <div class="flex items-start justify-between mb-3">
                  <div>
                    <h3 class="font-bold text-sm" style="color: #0f172a" x-html="highlightSearchMatch(item.label)"></h3>
                    <span class="text-[10px] font-mono" style="color: #cbd5e1" x-text="item.number"></span>
                  </div>
                  <span class="w-3 h-3 rounded-full" x-bind:style="'background:' + getRatingColor(getItemRating(item.id))"></span>
                </div>

                {/* Rating Buttons — `data-rating-row` is the anchor target the
                    onboarding overlay (T6 / step 0) highlights so the user
                    knows which buttons the tour is talking about. */}
                {/* Spec 5G mobile field-flow (Round 12) — 44px+ tap target on
                    mobile per Apple HIG; desktop keeps compact 28px height.
                    R7-16 — show the full rating label on tablet+ (≥640px) so
                    new inspectors can read "Satisfactory" instead of decoding
                    "Sat". Mobile keeps the abbreviation to fit 5 buttons in
                    one row. aria-label still provides the full name to AT. */}
                <div data-rating-row class="flex flex-wrap gap-1.5 mb-3">
                  <template x-for="level in ratingLevels" x-bind:key="level.id">
                    <button
                      x-on:click="setRating(item.id, level.id)"
                      x-bind:title="level.description ? level.label + ' — ' + level.description : level.label"
                      x-bind:aria-label="level.label"
                      class="px-4 py-2.5 min-h-[44px] lg:min-h-0 lg:px-3 lg:py-1.5 text-sm lg:text-xs font-semibold rounded-lg border transition-all"
                      x-bind:class="getItemRating(item.id) === level.id ? 'text-white border-transparent' : 'text-gray-400 hover:text-gray-600'"
                      x-bind:style="getItemRating(item.id) === level.id ? 'background:' + level.color + ';border-color:transparent' : 'border-color: #e2e8f0'"
                    >
                      <span class="hidden sm:inline" x-text="level.label"></span>
                      <span class="sm:hidden" x-text="level.abbreviation"></span>
                    </button>
                  </template>
                </div>

                {/* Expand Toggle */}
                <div class="flex items-center gap-3 text-xs" style="color: #94a3b8">
                  <button x-on:click="toggleExpand(item.id)" class="flex items-center gap-1 hover:text-gray-700">
                    <svg class="w-3 h-3 transition-transform" x-bind:class="expanded[item.id] ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                    <span x-text="expanded[item.id] ? 'Collapse' : 'Expand'"></span>
                  </button>
                  <span x-text="getPhotoCount(item.id) + ' photos'"></span>
                  <span x-text="getItemNotes(item.id) ? '1 note' : '0 notes'"></span>
                </div>

                {/* Expanded Detail */}
                <div x-show="expanded[item.id]" x-collapse="" class="mt-3 pt-3" style="border-top: 1px solid rgba(226,232,240,0.6)">
                  {/* Sprint 1 A-10: simple-notes fallback hint when item has no tabs */}
                  <div x-show="!item.tabs || (!item.tabs.information && !item.tabs.limitations && !item.tabs.defects)" class="mb-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-50 border border-slate-200 text-[11px] text-slate-500">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    <span>Simple notes mode.</span>
                    <a href="/templates" class="text-indigo-600 hover:underline">Upgrade to tabs →</a>
                  </div>
                  <div class="relative">
                    <textarea
                      x-bind:id="'notes-mob-' + item.id"
                      x-model="results[item.id].notes"
                      x-on:input="debounceSave()"
                      data-slash-trigger="true"
                      placeholder="Add notes — type / for snippets"
                      class="w-full p-3 text-sm rounded-xl border resize-none"
                      style="background: #f1f5f9; border-color: #e2e8f0; color: #0f172a"
                      rows={3}
                    ></textarea>
                    <button type="button"
                      x-bind:data-mic-target="'notes-mob-' + item.id"
                      x-init="window.__rebindMicButtons && window.__rebindMicButtons()"
                      class="absolute top-2 right-2 w-7 h-7 rounded-lg bg-white/90 border border-slate-200 flex items-center justify-center hover:bg-white"
                      title="Dictate (Web Speech)"
                      aria-label="Dictate notes">
                      <svg class="w-3.5 h-3.5 text-slate-500" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                        <path d="M19 11h-1.7c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72z"/>
                      </svg>
                    </button>
                  </div>
                  <div class="mt-2 flex gap-2 flex-wrap">
                    <label class="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer" style="background: #eef2ff; color: var(--ih-primary, #6366f1)">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      Camera
                      <input type="file" accept="image/*" capture="environment" class="hidden" x-on:change="uploadPhoto(item.id, $event)" />
                    </label>
                    <button type="button" onclick="openCommentPicker(this)" class="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors" style="background: #f0fdf4; color: #16a34a">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-3 3-3-3z"></path></svg>
                      Library
                    </button>
                    <button type="button"
                      x-on:click="suggestComment(item.label, section.title, document.getElementById('notes-mob-' + item.id), $event)"
                      class="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors"
                      style="background: #fef3c7; color: #b45309">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>
                      Suggest
                    </button>
                  </div>

                  {/* Spec 5B mobile — Canned Comment Tabs (compact). */}
                  <div x-show="item.tabs && (item.tabs.information || item.tabs.limitations || item.tabs.defects)" class="mt-4 rounded-xl border" style="border-color: #e2e8f0; background: rgba(255,255,255,0.6);">
                    <div class="flex items-center gap-1 px-2 py-1.5 border-b overflow-x-auto" style="border-color: #e2e8f0;">
                      <template x-for="tabName in ['information','limitations','defects']" x-bind:key="tabName">
                        <button type="button"
                          x-on:click="setActiveItemTab(tabName); activeItemId = item.id"
                          x-bind:class="(activeItemTab === tabName && activeItemId === item.id) ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'"
                          class="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold uppercase capitalize">
                          <span x-text="tabName"></span>
                          <span class="text-[10px] font-mono opacity-80"
                            x-text="tabBadgeCount(item.id, tabName) + '/' + tabBadgeTotal(item.id, tabName)"></span>
                        </button>
                      </template>
                    </div>
                    <div class="p-2 space-y-2">
                      <template x-for="entry in getTabEntries(item.id, (activeItemId === item.id ? activeItemTab : 'information'))" x-bind:key="entry.cannedId">
                        <div class="rounded-lg border p-2"
                          x-bind:class="entry.included ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'">
                          <label class="flex items-start gap-2 cursor-pointer">
                            <input type="checkbox"
                              x-bind:checked="entry.included"
                              x-on:change="toggleCannedComment(item.id, (activeItemId === item.id ? activeItemTab : 'information'), entry.cannedId)"
                              class="mt-1 rounded text-indigo-600" />
                            <div class="flex-1 min-w-0">
                              <span class="text-xs font-bold text-slate-900" x-text="entry.title"></span>
                              <p x-show="!entry.included" class="text-[11px] italic text-slate-500 line-clamp-2 mt-0.5" x-text="entry.comment"></p>
                              <textarea x-show="entry.included"
                                x-bind:value="entry.effectiveComment"
                                x-on:input="setCannedCommentText(item.id, (activeItemId === item.id ? activeItemTab : 'information'), entry.cannedId, $event.target.value)"
                                rows={2}
                                class="mt-1 w-full px-2 py-1.5 text-[12px] rounded border bg-white resize-y"
                                style="border-color: #e2e8f0"></textarea>
                              {/* Spec 5B P2B — AI Rewrite (mobile). */}
                              <div x-show="entry.included" class="mt-1 flex justify-end">
                                <button type="button"
                                  {...{ 'x-on:click.stop.prevent': 'rewriteCannedComment(item.id, (activeItemId === item.id ? activeItemTab : "information"), entry.cannedId, $event)' }}
                                  class="text-[10px] font-bold text-amber-700 px-1.5 py-0.5 rounded hover:bg-amber-50">
                                  ✨ Rewrite
                                </button>
                              </div>
                            </div>
                          </label>
                        </div>
                      </template>
                      <p x-show="getTabEntries(item.id, (activeItemId === item.id ? activeItemTab : 'information')).length === 0 && getCustomEntries(item.id, (activeItemId === item.id ? activeItemTab : 'information')).length === 0"
                         class="text-[11px] italic text-slate-400 text-center py-2">
                        No canned comments in this tab.
                      </p>
                      {/* Spec 5B P2B — Custom comments (mobile). */}
                      <template x-for="custom in getCustomEntries(item.id, (activeItemId === item.id ? activeItemTab : 'information'))" x-bind:key="custom.id">
                        <div class="rounded-lg border-2 border-dashed p-2 bg-amber-50/40" style="border-color: #fcd34d">
                          <div class="flex items-start gap-1.5">
                            <span class="mt-0.5 text-[8px] font-bold uppercase text-amber-700 bg-amber-100 px-1 py-0.5 rounded">Custom</span>
                            <div class="flex-1 min-w-0 space-y-1">
                              <input type="text"
                                x-bind:value="custom.title"
                                x-on:input="setCustomCommentTitle(item.id, (activeItemId === item.id ? activeItemTab : 'information'), custom.id, $event.target.value)"
                                placeholder="Title"
                                class="w-full px-1.5 py-0.5 text-[11px] font-bold rounded border bg-white"
                                style="border-color: #e2e8f0" />
                              <textarea
                                x-bind:value="custom.comment"
                                x-on:input="setCustomCommentText(item.id, (activeItemId === item.id ? activeItemTab : 'information'), custom.id, $event.target.value)"
                                rows={2}
                                class="w-full px-1.5 py-1 text-[11px] rounded border bg-white resize-y"
                                style="border-color: #e2e8f0"
                                placeholder="Comment..."></textarea>
                              <template x-if="(activeItemId === item.id ? activeItemTab : 'information') === 'defects'">
                                <div class="grid grid-cols-2 gap-1.5">
                                  <input type="text"
                                    x-bind:value="custom.location || ''"
                                    x-on:input="setCustomCommentLocation(item.id, custom.id, $event.target.value)"
                                    placeholder="Location"
                                    class="w-full px-1.5 py-0.5 text-[10px] rounded border bg-white"
                                    style="border-color: #e2e8f0" />
                                  <select
                                    x-bind:value="custom.category || 'maintenance'"
                                    x-on:change="setCustomCommentCategory(item.id, custom.id, $event.target.value)"
                                    class="w-full px-1.5 py-0.5 text-[10px] rounded border bg-white"
                                    style="border-color: #e2e8f0">
                                    <option value="maintenance">Maintenance</option>
                                    <option value="recommendation">Recommendation</option>
                                    <option value="safety">Safety</option>
                                  </select>
                                </div>
                              </template>
                            </div>
                            <div class="flex flex-col items-center gap-0.5">
                              {/* Sprint 1 A-6: AI rewrite button on custom rows (mobile) */}
                              <button type="button"
                                x-on:click="rewriteCustomComment(item.id, (activeItemId === item.id ? activeItemTab : 'information'), custom.id, $event)"
                                class="inline-flex items-center justify-center w-7 h-7 rounded-md text-amber-600 hover:bg-amber-50 active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-amber-500/30 text-xs"
                                aria-label="Rewrite with AI"
                                title="Rewrite with AI">{'✨'}</button>
                              <button type="button"
                                x-on:click="removeCustomComment(item.id, (activeItemId === item.id ? activeItemTab : 'information'), custom.id)"
                                class="inline-flex items-center justify-center w-7 h-7 rounded-md text-rose-500 hover:bg-rose-50 active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-rose-500/30 text-xs font-bold"
                                aria-label="Delete custom comment"
                                title="Delete">×</button>
                            </div>
                          </div>
                        </div>
                      </template>
                      <button type="button"
                        x-on:click="addCustomComment(item.id, (activeItemId === item.id ? activeItemTab : 'information'))"
                        class="w-full mt-1 py-1 text-[10px] font-bold rounded-lg border-2 border-dashed text-slate-500 hover:bg-white/60"
                        style="border-color: #e2e8f0">
                        + Add custom comment
                      </button>
                    </div>
                  </div>

                  {/* Phase T (T15) — photo thumbnails with Annotate overlay */}
                  <div x-show="(results[item.id]?.photos || []).length > 0" class="mt-3 grid grid-cols-3 gap-2">
                    <template x-for="(photo, pi) in (results[item.id]?.photos || [])" x-bind:key="pi">
                      <div class="relative group aspect-square overflow-hidden rounded-lg" style="background:#e2e8f0;">
                        <img x-bind:src="'/api/inspections/' + inspectionId + '/photos/' + encodeURIComponent(photo.annotatedKey || photo.key)"
                          class="w-full h-full object-cover" alt="Photo" />
                        <button type="button"
                          x-on:click="window.dispatchEvent(new CustomEvent('annotate', { detail: { inspectionId, itemId: item.id, photoIndex: pi, imageUrl: '/api/inspections/' + inspectionId + '/photos/' + encodeURIComponent(photo.key), existingNodesJson: photo.annotationsJson || null } }))"
                          class="absolute inset-0 bg-black/50 text-white text-[10px] font-bold opacity-0 group-hover:opacity-100 active:opacity-100 flex items-center justify-center transition">
                          Annotate
                        </button>
                      </div>
                    </template>
                  </div>
                </div>
              </div>
            </template>
            {/* Competitor parity App.E.3 — no-results state when search filters
                out every item in the current section. */}
            <div
              x-show="hasSearchQuery && searchMatchCount === 0"
              style="display:none"
              data-testid="editor-search-empty"
              class="mt-4 rounded-md bg-white border border-dashed border-slate-200 p-6 text-center"
            >
              <p class="text-sm text-slate-500">No matches for &ldquo;<span class="font-semibold text-slate-700" x-text="searchQuery"></span>&rdquo;.</p>
              <button x-on:click="clearSearch()" class="mt-2 text-xs font-semibold text-indigo-600 hover:underline">Clear search</button>
            </div>
          </div>

          {/* Spec 4D mobile — Inspection Events compact list */}
          <section x-data={`inspectionEventsSection('${inspectionId}')`} x-init="load()" class="mx-4 mb-24 mt-3 rounded-md bg-white p-4 ring-1 ring-slate-200">
            <header class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <h2 class="text-sm font-bold text-slate-900">Events</h2>
                <span class="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-500" x-show="events.length > 0" x-text="events.length"></span>
              </div>
              <button type="button" x-on:click="openCreate()" class="px-2.5 py-1 bg-indigo-600 text-white rounded-lg text-[11px] font-bold">+ Add</button>
            </header>
            <ul class="mt-2 space-y-1.5">
              <template x-for="ev in events" {...{ 'x-bind:key': 'ev.id' }}>
                <li class="flex items-center gap-2 p-2 bg-slate-50 rounded-lg text-xs">
                  <span class="w-2 h-2 rounded-full flex-shrink-0" {...{ 'x-bind:style': "'background:' + eventTypeColor(ev.eventTypeId)" }}></span>
                  <span class="font-bold text-slate-900 truncate" x-text="eventTypeName(ev.eventTypeId)"></span>
                  <span class="text-slate-500 text-[10px]" x-text="formatDate(ev.scheduledAt)"></span>
                  <span class="ml-auto text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full" x-text="(ev.status || '').replace('_', ' ')" {...{ 'x-bind:class': 'statusBadgeClass(ev.status)' }}></span>
                  <button type="button" x-show="ev.status === 'scheduled'" x-on:click="markComplete(ev.id)" class="text-emerald-600 text-xs font-bold" title="Done">&#10003;</button>
                  <button type="button" x-on:click="del(ev.id)" class="text-rose-600 text-xs font-bold" title="Delete">&times;</button>
                </li>
              </template>
              <li x-show="!events.length && !loading" class="text-[10px] text-slate-400 px-2">No events yet.</li>
            </ul>
          </section>

          {/* Bottom Bar */}
          {/* Spec 5G mobile field-flow (Round 12) — pad-bottom honors iOS
              safe-area (home indicator) so Publish never sits under it. */}
          <div class="fixed bottom-0 left-0 right-0 z-40 px-4 pt-3 flex gap-3" style="background: rgba(255,255,255,0.90); backdrop-filter: blur(16px); border-top: 1px solid rgba(226,232,240,0.6); padding-bottom: max(12px, env(safe-area-inset-bottom));">
            <button x-on:click="previewReport()" class="flex-1 min-h-[44px] py-3 text-sm font-semibold rounded-xl border" style="border-color: #e2e8f0; color: #475569">Preview</button>
            <button
              x-on:click="showPublishModal = true"
              x-bind:disabled="completionPercent < 100"
              class="flex-1 min-h-[44px] py-3 text-sm font-bold rounded-xl text-white disabled:opacity-40"
              style="background: #4f46e5"
            >Publish</button>
          </div>

          {/* Round 33 — Quick Rating Sheet (long-press fires this).
              Bottom-sheet with large rating buttons. Tap a level → applies +
              closes. Tap backdrop → close without change. */}
          <div
            x-show="showQuickRating"
            x-cloak
            class="fixed inset-0 z-[60] flex items-end"
            {...{ 'x-on:click.self': 'closeQuickRating()' }}
            style="background: rgba(0,0,0,0.4)"
          >
            <div class="w-full rounded-t-3xl p-5 pb-8" style="background: #ffffff; box-shadow: 0 -8px 32px rgba(0,0,0,0.15)">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-base font-bold" style="color: #0f172a">Quick Rate</h3>
                <button x-on:click="closeQuickRating()" class="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center" aria-label="Close">
                  <svg class="w-4 h-4" style="color: #64748b" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <template x-for="level in ratingLevels" x-bind:key="level.id">
                  <button
                    x-on:click="setQuickRating(level.id)"
                    class="px-4 py-4 rounded-xl text-sm font-semibold text-white border transition-all"
                    x-bind:style="'background:' + level.color + '; border-color: transparent'"
                  >
                    <span x-text="level.label"></span>
                  </button>
                </template>
                <button
                  x-on:click="setQuickRating(null)"
                  class="col-span-2 px-4 py-3 rounded-xl text-sm font-semibold text-gray-500 border"
                  style="background: #f1f5f9; border-color: #e2e8f0"
                >
                  Clear rating
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ===== Desktop View ===== */}
        <div x-show="isDesktop" class="hidden lg:flex min-h-screen">
          {/* Left Sidebar — hidden in focus mode (⌘2) */}
          <aside x-show="viewMode !== 'focus'" class="w-[220px] sticky top-0 h-screen flex-shrink-0 flex flex-col border-r overflow-y-auto" style="background: rgba(255,255,255,0.6); backdrop-filter: blur(12px); border-color: rgba(226,232,240,0.6);">
            <div class="px-5 pt-6 pb-4 border-b" style="border-color: rgba(226,232,240,0.5)">
              <a href="/dashboard" class="flex items-center gap-2 text-xs mb-3 hover:text-indigo-600 transition-colors" style="color: #94a3b8">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
                Dashboard
              </a>
              <h2 class="text-sm font-bold" style="color: #0f172a" x-text="inspection.propertyAddress || 'Loading...'"></h2>
              <p class="text-[10px] font-mono mt-1" style="color: #cbd5e1" x-text="formattedDate"></p>
            </div>
            {/* R7-20: surface what the progress bar measures so inspectors
                stop wondering how it's computed. */}
            <div class="px-5 py-3" title="Percent of inspection items that have a rating set (Sat / Mon / Defect / NI / NP).">
              <div class="flex justify-between text-[10px] font-mono mb-1" style="color: #94a3b8">
                <span>Progress · items rated</span>
                <span x-text="completionPercent + '%'"></span>
              </div>
              <div class="h-1.5 rounded-full" style="background: #e2e8f0">
                <div class="h-full rounded-full transition-all duration-500" x-bind:style="'width:' + completionPercent + '%; background: var(--ih-primary, #6366f1)'"></div>
              </div>
              <div class="mt-2 text-[10px] font-mono" style="color: #94a3b8">
                <span x-show="saveState === 'saving'" x-cloak class="text-amber-500">Saving...</span>
                <span x-show="saveState === 'saved'" x-cloak class="text-emerald-500">All changes saved</span>
                <span x-show="saveState === 'error'" x-cloak class="text-red-500">Save failed</span>
              </div>
            </div>
            {/* Report Access */}
            <div class="px-4 py-3 border-t space-y-2" style="border-color: rgba(226,232,240,0.5)">
              <div class="text-[10px] font-mono font-semibold uppercase tracking-wide mb-2" style="color: #94a3b8">Report Access</div>
              <label class="flex items-center justify-between cursor-pointer">
                <span class="text-xs" style="color: #475569">Require Payment</span>
                <button
                  x-on:click={`authFetch('/api/inspections/${inspectionId}', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({paymentRequired:!inspection.paymentRequired})}).then(r=>r.json()).then(d=>{ if(d.success) inspection.paymentRequired=!inspection.paymentRequired; })`}
                  x-bind:class="inspection.paymentRequired ? 'bg-indigo-500' : 'bg-slate-200'"
                  class="relative w-8 h-5 rounded-full transition-colors flex-shrink-0"
                >
                  <span x-bind:class="inspection.paymentRequired ? 'translate-x-3' : 'translate-x-0.5'" class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform" />
                </button>
              </label>
              <label class="flex items-center justify-between cursor-pointer">
                <span class="text-xs" style="color: #475569">Require Agreement</span>
                <button
                  x-on:click={`authFetch('/api/inspections/${inspectionId}', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({agreementRequired:!inspection.agreementRequired})}).then(r=>r.json()).then(d=>{ if(d.success) inspection.agreementRequired=!inspection.agreementRequired; })`}
                  x-bind:class="inspection.agreementRequired ? 'bg-indigo-500' : 'bg-slate-200'"
                  class="relative w-8 h-5 rounded-full transition-colors flex-shrink-0"
                >
                  <span x-bind:class="inspection.agreementRequired ? 'translate-x-3' : 'translate-x-0.5'" class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform" />
                </button>
              </label>
              {/* Spec 5H P2 — Agreement Status badge: shows latest signing request state for this inspection */}
              <div x-show="inspection.agreementRequired"
                   x-data={`{ req: null, async load() { try { const r = await authFetch('/api/admin/agreements/requests'); const j = await r.json(); const all = j.data?.requests || []; this.req = all.find(x => x.inspectionId === '${inspectionId}') || null; } catch(_) {} } }`}
                   x-init="load()"
                   class="mt-2">
                <template x-if="req">
                  <a x-bind:href="'/verify/' + req.id" target="_blank" class="block rounded-lg border p-2 transition hover:shadow-sm"
                     x-bind:style="req.status === 'signed' ? 'border-color:#a7f3d0; background:#ecfdf5' : (req.status === 'declined' ? 'border-color:#fecaca; background:#fef2f2' : (req.status === 'viewed' ? 'border-color:#bfdbfe; background:#eff6ff' : 'border-color:#fde68a; background:#fffbeb'))">
                    <div class="flex items-center justify-between">
                      <span class="text-[10px] font-bold uppercase tracking-wide"
                            x-bind:style="req.status === 'signed' ? 'color:#15803d' : (req.status === 'declined' ? 'color:#b91c1c' : (req.status === 'viewed' ? 'color:#1d4ed8' : 'color:#b45309'))"
                            x-text="req.status"></span>
                      <span class="text-[9px] text-slate-400" x-text="req.signedAt ? new Date(req.signedAt).toLocaleDateString() : (req.sentAt ? 'sent ' + new Date(req.sentAt).toLocaleDateString() : '')"></span>
                    </div>
                    <div class="text-[10px] text-slate-500 mt-0.5">Verify → opens public chain</div>
                  </a>
                </template>
                <template x-if="!req">
                  <p class="text-[10px] italic text-slate-400 px-1">No signing request sent yet</p>
                </template>
              </div>
              {/* R7-19 fix: Theme Override is rare per-inspection use. Collapse
                  by default; only expanded if a non-default theme is already set
                  or the inspector clicks "Advanced". Keeps Spectora-style focus
                  on common per-inspection actions (Require Payment / Agreement). */}
              <div class="mt-2" x-data={`{ open: !!inspection.reportThemeOverride }`}>
                <button
                  type="button"
                  x-on:click="open = !open"
                  class="flex items-center gap-1 text-[10px] font-mono font-semibold uppercase tracking-wide hover:underline"
                  style="color: #94a3b8"
                  title="Override the default report theme for this inspection only"
                >
                  <svg class="w-2.5 h-2.5 transition-transform" x-bind:class="open ? 'rotate-90' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                  <span>Advanced</span>
                  <span x-show="!open && inspection.reportThemeOverride" class="text-[9px] font-bold ml-1 px-1 rounded" style="background: #f1f5f9; color: #475569" x-text="inspection.reportThemeOverride"></span>
                </button>
                <div x-show="open" class="mt-2">
                  <label class="block text-[10px] font-mono font-semibold uppercase tracking-wide mb-1" style="color: #94a3b8">Report Theme Override</label>
                  <select
                    x-bind:value="inspection.reportThemeOverride || ''"
                    x-on:change={`const v=$event.target.value||null;authFetch('/api/inspections/${inspectionId}', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({reportThemeOverride:v})}).then(r=>r.json()).then(d=>{if(d.success)inspection.reportThemeOverride=v;});`}
                    class="w-full px-2 py-1 text-xs border rounded bg-white"
                    style="border-color: rgba(226,232,240,0.6); color: #475569"
                  >
                    <option value="">Use tenant default</option>
                    <option value="modern">Modern</option>
                    <option value="classic">Classic</option>
                    <option value="minimal">Minimal</option>
                  </select>
                </div>
              </div>
              <div class="mt-1">
                <span x-show="inspection.paymentStatus === 'paid'" class="text-[10px] font-bold px-2 py-0.5 rounded-full" style="background: #dcfce7; color: #16a34a">Paid</span>
                <span x-show="inspection.paymentStatus !== 'paid'" class="text-[10px] font-bold px-2 py-0.5 rounded-full" style="background: #fee2e2; color: #dc2626" x-text="'Unpaid · $' + ((inspection.price || 0) / 100).toFixed(2)"></span>
              </div>
              {/* Share with Agent */}
              <div x-data="{ agentUrl: '', copying: false, agentErr: '' }" class="pt-1">
                <button
                  x-show="!agentUrl"
                  x-on:click={`copying=true; authFetch('/api/inspections/'+inspectionId+'/agent-token',{method:'POST'}).then(r=>r.json()).then(j=>{agentUrl=j.data?.url||'';copying=false;}).catch(()=>{agentErr='Failed to generate link';copying=false;});`}
                  x-bind:disabled="copying"
                  x-text="copying ? 'Generating...' : 'Share with Agent'"
                  class="text-xs px-3 py-1.5 rounded-lg font-semibold w-full text-left"
                  style="background: #f1f5f9; color: #475569"
                />
                <div x-show="agentUrl" class="flex items-center gap-1 mt-1">
                  <input x-bind:value="agentUrl" readonly class="flex-1 text-[10px] border rounded px-2 py-1 bg-white" style="border-color: rgba(226,232,240,0.6)" />
                  <button x-on:click="navigator.clipboard.writeText(agentUrl)" class="text-[10px] px-2 py-1 rounded font-bold" style="background: #4f46e5; color: white">Copy</button>
                </div>
                <div x-show="agentErr" x-text="agentErr" class="text-[10px] mt-1" style="color: #dc2626" />
              </div>
            </div>
            {/* Property Info Card */}
            <div
                x-data="{ editing: false, fields: {} }"
                x-init={`fields = {
                    yearBuilt: inspection.yearBuilt || '',
                    sqft: inspection.sqft || '',
                    foundationType: inspection.foundationType || '',
                    bedrooms: inspection.bedrooms || '',
                    bathrooms: inspection.bathrooms || '',
                    unit: inspection.unit || '',
                    /* Spec 5D — auto-fill county from geocoded place
                       when user hasn't manually overridden. */
                    county: inspection.county || inspection.addressCounty || ''
                }`}
                class="px-4 py-3 border-t space-y-2"
                style="border-color: rgba(226,232,240,0.5)"
            >
                <div class="flex items-center justify-between">
                    <div class="text-[10px] font-mono font-semibold uppercase tracking-wide" style="color: #94a3b8">Property Info</div>
                    <button x-show="!editing" x-on:click="editing=true" class="text-[10px] text-indigo-600 font-semibold">Edit</button>
                    <div x-show="editing" class="flex gap-1">
                        <button
                            x-on:click={`authFetch('/api/inspections/${inspectionId}', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({yearBuilt:fields.yearBuilt?parseInt(fields.yearBuilt):null,sqft:fields.sqft?parseInt(fields.sqft):null,foundationType:fields.foundationType||null,bedrooms:fields.bedrooms?parseInt(fields.bedrooms):null,bathrooms:fields.bathrooms?parseFloat(fields.bathrooms):null,unit:fields.unit||null,county:fields.county||null})}).then(r=>r.json()).then(d=>{if(d.success){Object.assign(inspection,{yearBuilt:fields.yearBuilt?parseInt(fields.yearBuilt):null,sqft:fields.sqft?parseInt(fields.sqft):null,foundationType:fields.foundationType||null,bedrooms:fields.bedrooms?parseInt(fields.bedrooms):null,bathrooms:fields.bathrooms?parseFloat(fields.bathrooms):null,unit:fields.unit||null,county:fields.county||null});editing=false;}})`}
                            class="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded-md font-semibold"
                        >Save</button>
                        <button x-on:click="editing=false" class="text-[10px] text-slate-400">×</button>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-1 text-[11px]">
                    {[
                        { key: 'yearBuilt',  label: 'Year Built', type: 'number' },
                        { key: 'sqft',       label: 'Sq Ft',      type: 'number' },
                        { key: 'bedrooms',   label: 'Beds',       type: 'number' },
                        { key: 'bathrooms',  label: 'Baths',      type: 'number' },
                        { key: 'unit',       label: 'Unit',       type: 'text' },
                        { key: 'county',     label: 'County',     type: 'text' },
                    ].map(({ key, label, type }) => (
                        <div key={key}>
                            <div class="text-[9px] font-mono uppercase text-slate-400">{label}</div>
                            <div x-show="!editing" class="font-semibold" style="color: #0f172a" x-text={`fields.${key} || '—'`} />
                            <input x-show="editing" x-model={`fields.${key}`} type={type}
                                   class="w-full text-[11px] border border-slate-200 rounded px-1.5 py-0.5 bg-white" />
                        </div>
                    ))}
                    <div class="col-span-2">
                        <div class="text-[9px] font-mono uppercase text-slate-400">Foundation</div>
                        <div x-show="!editing" class="font-semibold" style="color: #0f172a" x-text="fields.foundationType || '—'" />
                        <select x-show="editing" x-model="fields.foundationType"
                                class="w-full text-[11px] border border-slate-200 rounded px-1 py-0.5 bg-white">
                            <option value="">—</option>
                            <option value="basement">Basement</option>
                            <option value="slab">Slab</option>
                            <option value="crawlspace">Crawlspace</option>
                            <option value="other">Other</option>
                        </select>
                    </div>
                </div>
            </div>
            <div class="flex-1 px-3 py-2 space-y-0.5">
              <template x-for="(sec, idx) in sections" x-bind:key="sec.id">
                <button
                  x-on:click="selectSection(idx)"
                  x-show="sectionMatchesSearch(sec)"
                  class="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left text-sm transition-all"
                  x-bind:style="currentSectionIdx === idx ? 'background: #eef2ff; color: var(--ih-primary, #6366f1)' : 'color: #64748b'"
                >
                  <span class="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    x-bind:style="currentSectionIdx === idx ? 'background: rgba(99,102,241,0.12)' : 'background: #f1f5f9'">
                    <template x-if="getSectionIconSvg(sec.icon)">
                      <span x-html="getSectionIconSvg(sec.icon)"></span>
                    </template>
                    <template x-if="!getSectionIconSvg(sec.icon)">
                      <span class="text-xs font-bold" x-text="(sec.title || '').charAt(0)"></span>
                    </template>
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="font-semibold truncate" x-text="sec.title"></div>
                    <div class="text-[10px] font-mono opacity-60" x-text="sec.items.length + ' items'"></div>
                  </div>
                  <span x-show="sectionDefectCount(sec.id) > 0"
                    class="w-5 h-5 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center"
                    x-text="sectionDefectCount(sec.id)"></span>
                </button>
              </template>
            </div>
          </aside>

          {/* Center Content */}
          <main class="flex-1 min-w-0">
            {/* Sprint 2 S2-2 — request switcher banner.
                Renders only when the inspection belongs to a multi-service
                booking (request.inspections.length > 1). The banner shows
                "Part X of Y in request ABC123" plus chip links to siblings.
                Hidden during initial fetch and for single-service inspections. */}
            <div
              x-data={`requestSwitcher('${inspectionId}')`}
              x-init="load()"
              x-show="hasSiblings"
              style="display:none"
              class="mx-6 mt-3 flex flex-wrap items-center gap-2 px-3 py-2 bg-indigo-50 rounded-md border border-indigo-200"
              role="region"
              aria-label="Inspection request siblings"
            >
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white ring-1 ring-inset ring-indigo-200 text-[11px] font-bold text-indigo-700">
                Part <span x-text="partIndex"></span> of <span x-text="partTotal"></span>
              </span>
              <span class="text-[11px] text-slate-500">
                in request <span class="font-mono font-semibold text-slate-700" x-text="requestIdShort"></span>
              </span>
              <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 ml-2">Switch:</span>
              <template x-for="s in siblings" {...{ 'x-bind:key': 's.id' }}>
                <a
                  x-bind:href="'/inspections/' + s.id + '/report'"
                  x-bind:class="isCurrent(s.id) ? 'px-2.5 py-1 rounded-md bg-white border border-indigo-300 text-indigo-700 text-[11px] font-bold' : 'px-2.5 py-1 rounded-md text-slate-600 text-[11px] font-medium hover:bg-white hover:text-slate-900 transition-colors'"
                  x-text="s.templateName"
                ></a>
              </template>
            </div>
            {/* Toolbar */}
            <div class="sticky top-0 z-40 px-3 py-2 flex items-center justify-between" style="background: rgba(255,255,255,0.85); backdrop-filter: blur(16px) saturate(1.5); border-bottom: 1px solid rgba(226,232,240,0.6);">
              <div class="flex items-center gap-3">
                <h2 class="text-2xl font-bold" style="color: #0f172a" x-text="currentSection?.title || ''"></h2>
                <span class="text-xs font-mono px-2 py-1 rounded-lg" style="background: #f1f5f9; color: #94a3b8" x-text="'SECTION ' + (currentSectionIdx + 1) + '/' + sections.length"></span>
                {/* Spec 5G M1 — keyboard hints inline next to section title (Mockup 01) */}
                <span class="hidden lg:flex items-center gap-1.5 text-[10px] text-slate-400 ml-2" title="Keyboard shortcuts (press ? for full HUD)">
                  <kbd class="px-1.5 py-0.5 bg-white/80 border border-slate-200 rounded font-mono">↑↓</kbd> nav
                  <kbd class="px-1.5 py-0.5 bg-white/80 border border-slate-200 rounded font-mono">1-5</kbd> rate
                  <kbd class="px-1.5 py-0.5 bg-white/80 border border-slate-200 rounded font-mono">/</kbd> lib
                  <kbd class="px-1.5 py-0.5 bg-white/80 border border-slate-200 rounded font-mono">⏎</kbd> next
                </span>
                <button
                  x-on:click="batchMode = !batchMode"
                  class="px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all"
                  x-bind:style="batchMode ? 'background: #eef2ff; color: var(--ih-primary, #6366f1); border-color: #c7d2fe' : 'border-color: #e2e8f0; color: #64748b'"
                >Batch</button>
              </div>
              <div class="flex items-center gap-2">
                {/* Competitor parity App.E.3 (Spectora) — full-text search box.
                    Filters every visible section + item live as the user
                    types. Empty query restores the normal section/item tree. */}
                <div class="relative" data-testid="editor-search">
                  <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 105.5 5.5a7.5 7.5 0 0011.15 11.15z" />
                    </svg>
                  </span>
                  <input
                    type="search"
                    x-model="searchQuery"
                    placeholder="Search entire report…"
                    aria-label="Search the entire report"
                    data-testid="editor-search-input"
                    class="w-56 pl-8 pr-7 py-1.5 text-xs rounded-lg border bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-all"
                    style="border-color: #e2e8f0"
                  />
                  <button
                    type="button"
                    x-show="hasSearchQuery"
                    style="display:none"
                    x-on:click="clearSearch()"
                    aria-label="Clear search"
                    data-testid="editor-search-clear"
                    class="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center"
                  >
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <span
                  x-show="hasSearchQuery"
                  style="display:none"
                  data-testid="editor-search-count"
                  class="text-[11px] font-mono text-slate-500"
                  x-text="searchMatchCount + ' match' + (searchMatchCount === 1 ? '' : 'es')"
                ></span>
                <button x-on:click="previewReport()" class="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl" style="color: #64748b">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  Preview
                </button>
                <button
                  x-on:click="showPublishModal = true"
                  class="flex items-center gap-2 px-5 py-2 text-sm font-bold rounded-xl text-white"
                  style="background: #4f46e5"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                  Publish
                </button>
              </div>
            </div>

            {/* Batch Mode Toolbar */}
            <div x-show="batchMode" class="px-6 py-2 flex items-center gap-3 text-sm" style="background: #eef2ff; border-bottom: 1px solid #c7d2fe">
              <span class="font-semibold" style="color: var(--ih-primary, #6366f1)" x-text="'Selected ' + selectedBatchCount + '/' + currentSectionItems.length"></span>
              <button x-on:click="batchSelectAll()" class="px-3 py-1 rounded-lg text-xs font-semibold" style="background: white; color: var(--ih-primary, #6366f1)">Select All</button>
              <template x-for="level in ratingLevels" x-bind:key="level.id">
                <button
                    x-on:click="batchSetRating(level.id)"
                    x-bind:aria-label="'Set ' + level.label"
                    class="px-3 py-1 rounded-lg text-xs font-semibold"
                    style="background: white; color: #475569"
                >
                  <span class="hidden sm:inline" x-text="'Set ' + level.label"></span>
                  <span class="sm:hidden" x-text="'Set ' + level.abbreviation"></span>
                </button>
              </template>
              <button x-on:click="batchMode = false; batchSelected = {}" class="ml-auto px-3 py-1 rounded-lg text-xs font-semibold" style="color: #64748b">Exit</button>
            </div>

            {/* Status Machine Bar */}
            <div
                x-data="{ showCancelModal: false, cancelReason: 'client_cancelled', cancelNotes: '' }"
                class="mx-6 mt-3 bg-white border rounded-xl px-4 py-2.5 flex items-center justify-between gap-3"
                style="border-color: rgba(226,232,240,0.6)"
            >
                <div class="flex items-center gap-2">
                    <span class="text-[10px] font-mono uppercase" style="color: #94a3b8">Status</span>
                    <span
                        x-text="(inspection.status||'').replace('_',' ').toUpperCase()"
                        x-bind:class={`{
                            'bg-slate-100 text-slate-600': inspection.status === 'scheduled' || inspection.status === 'draft',
                            'bg-blue-50 text-blue-700': inspection.status === 'confirmed',
                            'bg-green-50 text-green-700': inspection.status === 'in_progress' || inspection.status === 'completed',
                            'bg-red-50 text-red-700': inspection.status === 'cancelled',
                        }`}
                        class="text-[10px] font-bold px-2.5 py-0.5 rounded-full"
                    />
                </div>
                <div class="flex gap-1.5">
                    <button
                        x-show="inspection.status === 'scheduled' || inspection.status === 'draft'"
                        x-on:click={`authFetch('/api/inspections/${inspectionId}/confirm',{method:'POST'}).then(r=>r.json()).then(d=>{if(d.success)inspection.status='confirmed'})`}
                        class="text-[11px] bg-blue-600 text-white px-3 py-1 rounded-lg font-bold"
                        title="Confirm this inspection — locks the schedule and sends client notification"
                    >Confirm</button>
                    <button
                        x-show="inspection.status !== 'cancelled' && inspection.status !== 'completed'"
                        x-on:click="showCancelModal=true"
                        class="text-[11px] border text-red-600 px-3 py-1 rounded-lg font-bold"
                        style="border-color: #fecaca; background: #fef2f2"
                        title="Cancel this inspection — you'll be asked for a reason and refund handling"
                    >Cancel</button>
                    <button
                        x-show="inspection.status === 'cancelled'"
                        x-on:click={`authFetch('/api/inspections/${inspectionId}/uncancel',{method:'POST'}).then(r=>r.json()).then(d=>{if(d.success)inspection.status='scheduled'})`}
                        class="text-[11px] bg-slate-100 text-slate-700 px-3 py-1 rounded-lg font-bold"
                        title="Restore this cancelled inspection back to scheduled state"
                    >Restore</button>
                </div>
                {/* Cancel Modal */}
                <Modal
                    name="showCancelModal"
                    title="Cancel Inspection"
                    size="sm"
                    footer={
                        <ModalFooter
                            cancelText="Back"
                            onCancel="showCancelModal = false"
                            onConfirm={`authFetch('/api/inspections/${inspectionId}/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:cancelReason,notes:cancelNotes||undefined})}).then(r=>r.json()).then(d=>{if(d.success){inspection.status='cancelled';showCancelModal=false;}})`}
                            confirmText="Cancel Inspection"
                            danger={true}
                        />
                    }
                >
                    <label class="block text-xs font-bold text-slate-600 mb-1">Reason</label>
                    <select x-model="cancelReason" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-3 bg-white">
                        <option value="client_cancelled">Client Cancelled</option>
                        <option value="scheduling_conflict">Scheduling Conflict</option>
                        <option value="weather">Weather</option>
                        <option value="other">Other</option>
                    </select>
                    <label class="block text-xs font-bold text-slate-600 mb-1">Notes (optional)</label>
                    <textarea x-model="cancelNotes" rows={3} class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                </Modal>
            </div>

            {/* Inspection Events (Spec 4D.T9) */}
            <section x-data={`inspectionEventsSection('${inspectionId}')`} x-init="load()" class="mx-6 mt-3 rounded-md bg-white p-5 ring-1 ring-slate-200">
                <header class="flex items-center justify-between gap-3">
                    <div class="flex items-center gap-2">
                        <h2 class="text-base font-bold text-slate-900">Events</h2>
                        <span class="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-500" x-show="events.length > 0" x-text="events.length + ' total'"></span>
                    </div>
                    <button type="button" x-on:click="openCreate()" class="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700">+ Add event</button>
                </header>
                <ul class="mt-3 space-y-2">
                    <template x-for="ev in events" {...{ 'x-bind:key': 'ev.id' }}>
                        <li class="flex items-center gap-3 p-3 bg-slate-50 rounded-lg text-sm">
                            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" {...{ 'x-bind:style': "'background:' + eventTypeColor(ev.eventTypeId)" }}></span>
                            <span class="font-bold text-slate-900" x-text="eventTypeName(ev.eventTypeId)"></span>
                            <span class="text-slate-500 text-xs" x-text="formatDate(ev.scheduledAt)"></span>
                            <span class="text-slate-400 text-xs" x-show="ev.durationMin" x-text="(ev.durationMin || 0) + ' min'"></span>
                            <span class="ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" x-text="(ev.status || '').replace('_', ' ')" {...{ 'x-bind:class': 'statusBadgeClass(ev.status)' }}></span>
                            <button type="button" x-show="ev.status === 'scheduled'" x-on:click="markComplete(ev.id)" class="text-emerald-600 text-xs font-bold hover:underline" title="Mark complete">&#10003;</button>
                            <button type="button" x-on:click="del(ev.id)" class="text-rose-600 text-xs font-bold hover:underline" title="Delete">&times;</button>
                        </li>
                    </template>
                    <li x-show="!events.length && !loading" class="text-xs text-slate-400">No events yet. Add a radon pickup, sewer scope, follow-up visit, etc.</li>
                </ul>

                {/* Create modal */}
                <Modal
                    name="showCreate"
                    title="New event"
                    size="md"
                    footer={
                        <ModalFooter
                            onCancel="showCreate = false"
                            onConfirm="submitCreate()"
                            confirmDisabled="saving"
                            confirmTextExpr="saving ? 'Saving...' : 'Add event'"
                        />
                    }
                >
                    <div class="space-y-3">
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">Type</label>
                            <select x-model="form.eventTypeId" x-on:change="onTypeChange()" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">
                                <option value="">— Select —</option>
                                <template x-for="t in types" {...{ 'x-bind:key': 't.id' }}>
                                    <option {...{ 'x-bind:value': 't.id' }} x-text="t.name"></option>
                                </template>
                            </select>
                            <p x-show="!types.length" class="text-[10px] text-amber-600 mt-1">No event types defined. <a href="/settings/event-types" class="underline">Create one</a> first.</p>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">Date &amp; time</label>
                            <input type="datetime-local" x-model="form.scheduledAt" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-xs font-bold text-slate-600 mb-1">Duration (min)</label>
                                <input type="number" {...{ 'x-model.number': 'form.durationMin' }} min="1" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-600 mb-1">Price (cents)</label>
                                <input type="number" {...{ 'x-model.number': 'form.priceCents' }} min="0" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">Inspector (optional)</label>
                            <select x-model="form.inspectorId" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">
                                <option value="">Unassigned</option>
                                <template x-for="i in inspectors" {...{ 'x-bind:key': 'i.id' }}>
                                    <option {...{ 'x-bind:value': 'i.id' }} x-text="i.name || i.email"></option>
                                </template>
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">Notes (optional)</label>
                            <textarea x-model="form.notes" rows={2} class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"></textarea>
                        </div>
                    </div>
                </Modal>
            </section>

            {/* Card Grid */}
            <div class="p-6 grid grid-cols-2 xl:grid-cols-3 gap-4">
              <template x-for="item in currentSectionItems" x-bind:key="item.id">
                <div
                  x-bind:data-item-id="item.id"
                  x-show="itemMatchesSearch(currentSection, item)"
                  class="rounded-md p-4 transition-all cursor-pointer group"
                  style="background: rgba(255,255,255,0.85); backdrop-filter: blur(16px) saturate(1.5); border: 1px solid rgba(255,255,255,0.7);"
                  x-bind:style="(activeItemId === item.id ? 'border-color: #6366f1; ' : '') + 'border-top: 4px solid ' + getRatingColor(getItemRating(item.id))"
                  x-bind:class="activeItemId === item.id ? 'ring-2 ring-indigo-100' : ''"
                  x-on:click="batchMode ? toggleBatchSelect(item.id) : (setActiveItem(item.id), toggleExpand(item.id))"
                >
                  <div x-show="batchMode" class="mb-2">
                    <input type="checkbox" x-bind:checked="batchSelected[item.id]" aria-label="Select item for batch rating" class="rounded" />
                  </div>
                  <div class="flex items-start justify-between mb-3">
                    <div>
                      <h3 class="font-bold text-sm group-hover:text-indigo-600 transition-colors" style="color: #0f172a" x-html="highlightSearchMatch(item.label)"></h3>
                      <span class="text-[10px] font-mono" style="color: #cbd5e1" x-text="item.number"></span>
                    </div>
                    <span
                      class="ih-pill"
                      x-show="getItemRating(item.id)"
                      x-text="getRatingLabel(getItemRating(item.id))"
                      x-bind:style="'background:' + getRatingColor(getItemRating(item.id)) + '20; color:' + getRatingColor(getItemRating(item.id))"
                    ></span>
                  </div>
                  {/* Rating Buttons (R7-16 — full label on ≥640px, abbreviation
                      on mobile; aria-label preserves the full name for AT). */}
                  <div class="flex flex-wrap gap-1.5 mb-3" x-on:click="$event.stopPropagation()">
                    <template x-for="level in ratingLevels" x-bind:key="level.id">
                      <button
                        x-on:click="setRating(item.id, level.id)"
                        x-bind:title="level.description ? level.label + ' — ' + level.description : level.label"
                        x-bind:aria-label="level.label"
                        class="px-2.5 py-1 text-[10px] font-semibold rounded-lg border transition-all"
                        x-bind:class="getItemRating(item.id) === level.id ? 'text-white border-transparent' : 'text-gray-400 hover:text-gray-600'"
                        x-bind:style="getItemRating(item.id) === level.id ? 'background:' + level.color + ';border-color:transparent' : 'border-color: #e2e8f0'"
                      >
                        <span class="hidden sm:inline" x-text="level.label"></span>
                        <span class="sm:hidden" x-text="level.abbreviation"></span>
                      </button>
                    </template>
                  </div>
                  {/* Round 39 — formerly the whole row had stopPropagation,
                      so '0 photos / 0 notes' looked clickable but actually
                      ate the click instead of expanding the card. Now only
                      the camera <label> stops propagation (its hidden file
                      <input> still opens the picker via native click); the
                      rest of the row falls through to the parent's expand
                      handler, and a chevron hints the card is expandable. */}
                  <div class="flex items-center gap-3 text-[10px] font-mono" style="color: #cbd5e1">
                    <label
                      x-on:click="$event.stopPropagation()"
                      class="flex items-center gap-1 px-1.5 py-0.5 rounded cursor-pointer hover:bg-indigo-50 hover:text-indigo-600 transition"
                      title="Add photo to this item">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      <span x-text="getPhotoCount(item.id) + ' photos'"></span>
                      <input type="file" accept="image/*" capture="environment" class="hidden" x-on:change="uploadPhoto(item.id, $event)" />
                    </label>
                    <span x-text="getItemNotes(item.id) ? '1 note' : '0 notes'"></span>
                    <svg class="w-3 h-3 ml-auto opacity-40 transition-transform"
                         x-bind:class="expanded[item.id] ? 'rotate-180' : ''"
                         fill="none" stroke="currentColor" viewBox="0 0 24 24"
                         aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>

                  {/* Expanded Detail (desktop) */}
                  <div x-show="expanded[item.id] && !batchMode" x-collapse="" class="mt-3 pt-3" style="border-top: 1px solid rgba(226,232,240,0.6)" x-on:click="$event.stopPropagation()">
                    {/* Sprint 1 A-10: simple-notes fallback hint when item has no tabs */}
                    <div x-show="!item.tabs || (!item.tabs.information && !item.tabs.limitations && !item.tabs.defects)" class="mb-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-50 border border-slate-200 text-[11px] text-slate-500">
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      <span>Simple notes mode.</span>
                      <a href="/templates" class="text-indigo-600 hover:underline">Upgrade to tabs →</a>
                    </div>
                    <div class="relative">
                      <textarea
                        x-bind:id="'notes-dsk-' + item.id"
                        x-model="results[item.id].notes"
                        x-on:input="debounceSave()"
                        data-slash-trigger="true"
                        placeholder="Add notes — type / for snippets"
                        class="w-full p-3 text-sm rounded-xl border resize-none"
                        style="background: #f1f5f9; border-color: #e2e8f0; color: #0f172a"
                        rows={3}
                      ></textarea>
                      <button type="button"
                        x-bind:data-mic-target="'notes-dsk-' + item.id"
                        x-init="window.__rebindMicButtons && window.__rebindMicButtons()"
                        class="absolute top-2 right-2 w-7 h-7 rounded-lg bg-white/90 border border-slate-200 flex items-center justify-center hover:bg-white"
                        title="Dictate (Web Speech)"
                        aria-label="Dictate notes">
                        <svg class="w-3.5 h-3.5 text-slate-500" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                          <path d="M19 11h-1.7c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72z"/>
                        </svg>
                      </button>
                    </div>
                    <div class="mt-2 flex gap-2 flex-wrap">
                      <label class="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer" style="background: #eef2ff; color: var(--ih-primary, #6366f1)">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        Camera
                        <input type="file" accept="image/*" class="hidden" x-on:change="uploadPhoto(item.id, $event)" />
                      </label>
                      <button type="button" onclick="openCommentPicker(this)" class="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors" style="background: #f0fdf4; color: #16a34a">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-3 3-3-3z"></path></svg>
                        Library
                      </button>
                      <button type="button"
                        x-on:click="suggestComment(item.label, section.title, document.getElementById('notes-dsk-' + item.id), $event)"
                        class="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors"
                        style="background: #fef3c7; color: #b45309">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>
                        Suggest
                      </button>
                    </div>

                    {/* Spec 5B — Canned Comment Tabs (Information / Limitations / Defects).
                        Only render for v2 'rich' items that ship template-side canned tabs. */}
                    <div x-show="item.tabs && (item.tabs.information || item.tabs.limitations || item.tabs.defects)" class="mt-4 rounded-xl border" style="border-color: #e2e8f0; background: rgba(255,255,255,0.6);">
                      <div class="flex items-center gap-1 px-2 py-1.5 border-b" style="border-color: #e2e8f0;">
                        <template x-for="tabName in ['information','limitations','defects']" x-bind:key="tabName">
                          <button type="button"
                            x-on:click="setActiveItemTab(tabName); activeItemId = item.id"
                            x-bind:class="(activeItemTab === tabName && activeItemId === item.id) ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'"
                            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wide capitalize">
                            <span x-text="tabName"></span>
                            <span class="text-[10px] font-mono opacity-80"
                              x-text="tabBadgeCount(item.id, tabName) + '/' + tabBadgeTotal(item.id, tabName)"></span>
                          </button>
                        </template>
                      </div>
                      <div class="p-3 space-y-2">
                        <template x-for="entry in getTabEntries(item.id, (activeItemId === item.id ? activeItemTab : 'information'))" x-bind:key="entry.cannedId">
                          <div class="rounded-lg border p-2.5"
                            x-bind:class="entry.included ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'">
                            <div class="flex items-start gap-2">
                              <input type="checkbox"
                                x-bind:checked="entry.included"
                                x-on:change="toggleCannedComment(item.id, (activeItemId === item.id ? activeItemTab : 'information'), entry.cannedId)"
                                class="mt-1 rounded text-indigo-600"
                                aria-label="Include this comment" />
                              <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2 flex-wrap">
                                  <span class="text-xs font-bold text-slate-900" x-text="entry.title"></span>
                                  {/* Defect-only category pill */}
                                  <template x-if="(activeItemId === item.id ? activeItemTab : 'information') === 'defects'">
                                    <span class="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded text-white"
                                      x-bind:style="entry.category === 'safety' ? 'background:#dc2626' : (entry.category === 'recommendation' ? 'background:#f59e0b' : 'background:#0ea5e9')"
                                      x-text="entry.category || ''"></span>
                                  </template>
                                </div>
                                {/* Comment override input — full-width textarea when included */}
                                <textarea
                                  x-show="entry.included"
                                  x-bind:value="entry.effectiveComment"
                                  x-on:input="setCannedCommentText(item.id, (activeItemId === item.id ? activeItemTab : 'information'), entry.cannedId, $event.target.value)"
                                  rows={2}
                                  class="mt-1.5 w-full px-2 py-1.5 text-[12px] rounded border bg-white resize-y"
                                  style="border-color: #e2e8f0; color: #1e293b"
                                  placeholder="Edit comment text..."></textarea>
                                {/* Spec 5B P2B — AI Rewrite button (canned). */}
                                <div x-show="entry.included" class="mt-1 flex items-center justify-end">
                                  <button type="button"
                                    x-on:click="rewriteCannedComment(item.id, (activeItemId === item.id ? activeItemTab : 'information'), entry.cannedId, $event)"
                                    class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold text-amber-700 hover:bg-amber-50 transition"
                                    title="Rewrite with AI">
                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>
                                    Rewrite
                                  </button>
                                </div>
                                {/* Read-only preview when not included */}
                                <p x-show="!entry.included" class="mt-1 text-[11px] italic text-slate-500 line-clamp-2" x-text="entry.comment"></p>
                                {/* Defect-only location + category override */}
                                <template x-if="entry.included && (activeItemId === item.id ? activeItemTab : 'information') === 'defects'">
                                  <div class="mt-2 space-y-2">
                                    <div class="grid grid-cols-2 gap-2">
                                      <div>
                                        <label class="block text-[9px] font-bold uppercase text-slate-400 mb-0.5">Location</label>
                                        <input type="text"
                                          x-bind:value="entry.location"
                                          x-on:input="setDefectLocation(item.id, entry.cannedId, $event.target.value)"
                                          placeholder="Northwest corner"
                                          class="w-full px-2 py-1 text-[11px] rounded border bg-white"
                                          style="border-color: #e2e8f0" />
                                      </div>
                                      <div>
                                        <label class="block text-[9px] font-bold uppercase text-slate-400 mb-0.5">Category</label>
                                        <select
                                          x-bind:value="entry.category"
                                          x-on:change="setDefectCategory(item.id, entry.cannedId, $event.target.value)"
                                          class="w-full px-2 py-1 text-[11px] rounded border bg-white"
                                          style="border-color: #e2e8f0">
                                          <option value="maintenance">Maintenance</option>
                                          <option value="recommendation">Recommendation</option>
                                          <option value="safety">Safety</option>
                                        </select>
                                      </div>
                                    </div>
                                    {/* Sprint 2 S2-3 — contractor recommendation dropdown.
                                        Inspector picks the trade so the published report
                                        renders the canonical "Recommend a qualified
                                        electrician..." phrase after the defect notes. */}
                                    <div>
                                      <label class="block text-[9px] font-bold uppercase text-slate-400 mb-0.5">Contact contractor</label>
                                      <select
                                        x-bind:value="entry.recommendationId || ''"
                                        x-on:change="setDefectRecommendation(item.id, entry.cannedId, $event.target.value)"
                                        class="w-full px-2 py-1 text-[11px] rounded border bg-white"
                                        style="border-color: #e2e8f0"
                                        data-testid="defect-recommendation">
                                        <option value="">No recommendation</option>
                                        <template x-for="grp in window.__OI_RECO_GROUPS || []" x-bind:key="grp.group">
                                          <optgroup x-bind:label="grp.group">
                                            <template x-for="cat in grp.items" x-bind:key="cat.id">
                                              <option x-bind:value="cat.id" x-text="(cat.icon ? cat.icon + ' ' : '') + cat.label"></option>
                                            </template>
                                          </optgroup>
                                        </template>
                                      </select>
                                    </div>
                                    {/* Sprint 2 S2-4 — repair estimate range (USD).
                                        Stored on the defect as estimateLow / estimateHigh
                                        in dollars (converted to cents server-side). */}
                                    <div class="grid grid-cols-2 gap-2">
                                      <div>
                                        <label class="block text-[9px] font-bold uppercase text-slate-400 mb-0.5">Estimate low ($)</label>
                                        <input type="number" min="0" step="50"
                                          x-bind:value="entry.estimateLow != null ? Math.round(entry.estimateLow / 100) : ''"
                                          x-on:input="setDefectEstimate(item.id, entry.cannedId, 'low', $event.target.value)"
                                          placeholder="500"
                                          class="w-full px-2 py-1 text-[11px] rounded border bg-white tabular-nums"
                                          style="border-color: #e2e8f0"
                                          data-testid="defect-estimate-low" />
                                      </div>
                                      <div>
                                        <label class="block text-[9px] font-bold uppercase text-slate-400 mb-0.5">Estimate high ($)</label>
                                        <input type="number" min="0" step="50"
                                          x-bind:value="entry.estimateHigh != null ? Math.round(entry.estimateHigh / 100) : ''"
                                          x-on:input="setDefectEstimate(item.id, entry.cannedId, 'high', $event.target.value)"
                                          placeholder="1500"
                                          class="w-full px-2 py-1 text-[11px] rounded border bg-white tabular-nums"
                                          style="border-color: #e2e8f0"
                                          data-testid="defect-estimate-high" />
                                      </div>
                                    </div>
                                  </div>
                                </template>
                              </div>
                            </div>
                          </div>
                        </template>
                        <p x-show="getTabEntries(item.id, (activeItemId === item.id ? activeItemTab : 'information')).length === 0 && getCustomEntries(item.id, (activeItemId === item.id ? activeItemTab : 'information')).length === 0"
                           class="text-[11px] italic text-slate-400 text-center py-2">
                          No canned comments in this tab.
                        </p>
                        {/* Spec 5B P2B — Custom (per-inspection) comments. */}
                        <template x-for="custom in getCustomEntries(item.id, (activeItemId === item.id ? activeItemTab : 'information'))" x-bind:key="custom.id">
                          <div class="rounded-lg border-2 border-dashed p-2.5 bg-amber-50/40"
                            style="border-color: #fcd34d">
                            <div class="flex items-start gap-2">
                              <span class="mt-1 text-[9px] font-bold uppercase text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">Custom</span>
                              <div class="flex-1 min-w-0 space-y-1.5">
                                <input type="text"
                                  x-bind:value="custom.title"
                                  x-on:input="setCustomCommentTitle(item.id, (activeItemId === item.id ? activeItemTab : 'information'), custom.id, $event.target.value)"
                                  placeholder="Title (e.g. Vegetation overgrowth)"
                                  class="w-full px-2 py-1 text-xs font-bold rounded border bg-white"
                                  style="border-color: #e2e8f0; color: #1e293b" />
                                <textarea
                                  x-bind:value="custom.comment"
                                  x-on:input="setCustomCommentText(item.id, (activeItemId === item.id ? activeItemTab : 'information'), custom.id, $event.target.value)"
                                  rows={2}
                                  class="w-full px-2 py-1.5 text-[12px] rounded border bg-white resize-y"
                                  style="border-color: #e2e8f0; color: #1e293b"
                                  placeholder="Comment text..."></textarea>
                                <template x-if="(activeItemId === item.id ? activeItemTab : 'information') === 'defects'">
                                  <div class="space-y-2">
                                    <div class="grid grid-cols-2 gap-2">
                                      <div>
                                        <label class="block text-[9px] font-bold uppercase text-slate-400 mb-0.5">Location</label>
                                        <input type="text"
                                          x-bind:value="custom.location || ''"
                                          x-on:input="setCustomCommentLocation(item.id, custom.id, $event.target.value)"
                                          placeholder="Northwest corner"
                                          class="w-full px-2 py-1 text-[11px] rounded border bg-white"
                                          style="border-color: #e2e8f0" />
                                      </div>
                                      <div>
                                        <label class="block text-[9px] font-bold uppercase text-slate-400 mb-0.5">Category</label>
                                        <select
                                          x-bind:value="custom.category || 'maintenance'"
                                          x-on:change="setCustomCommentCategory(item.id, custom.id, $event.target.value)"
                                          class="w-full px-2 py-1 text-[11px] rounded border bg-white"
                                          style="border-color: #e2e8f0">
                                          <option value="maintenance">Maintenance</option>
                                          <option value="recommendation">Recommendation</option>
                                          <option value="safety">Safety</option>
                                        </select>
                                      </div>
                                    </div>
                                    {/* Sprint 1 A-7: photos bound to this specific custom defect */}
                                    <div>
                                      <div class="flex items-center justify-between mb-1">
                                        <label class="block text-[9px] font-bold uppercase text-slate-400">Photos</label>
                                        <input type="file"
                                          accept="image/*"
                                          capture="environment"
                                          class="hidden"
                                          x-bind:id={"'custom-photo-' + custom.id"}
                                          x-on:change="uploadDefectPhoto(item.id, custom.id, $event); $event.target.value = ''"
                                        />
                                        <button type="button"
                                          x-on:click="document.getElementById('custom-photo-' + custom.id).click()"
                                          class="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-600 hover:bg-slate-100 active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-xs"
                                          aria-label="Add photo to this defect"
                                          title="Add photo">{'📷'}</button>
                                      </div>
                                      <div x-show="custom.photos && custom.photos.length > 0" class="flex gap-1.5 flex-wrap">
                                        <template x-for="(p, pi) in (custom.photos || [])" x-bind:key="pi">
                                          <img x-bind:src={"'/api/inspections/' + inspectionId + '/photos/' + encodeURIComponent(p.key)"}
                                            class="w-12 h-12 object-cover rounded-md border border-slate-200 hover:border-indigo-400 hover:-translate-y-0.5 transition-all"
                                            x-bind:alt={"'Defect photo ' + (pi + 1)"} />
                                        </template>
                                      </div>
                                    </div>
                                  </div>
                                </template>
                              </div>
                              <div class="flex flex-col items-center gap-0.5">
                                {/* Sprint 1 A-6: AI rewrite button on custom rows */}
                                <button type="button"
                                  x-on:click="rewriteCustomComment(item.id, (activeItemId === item.id ? activeItemTab : 'information'), custom.id, $event)"
                                  class="inline-flex items-center justify-center w-7 h-7 rounded-md text-amber-600 hover:bg-amber-50 active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                                  aria-label="Rewrite with AI"
                                  title="Rewrite with AI">{'✨'}</button>
                                <button type="button"
                                  x-on:click="removeCustomComment(item.id, (activeItemId === item.id ? activeItemTab : 'information'), custom.id)"
                                  class="inline-flex items-center justify-center w-7 h-7 rounded-md text-rose-500 hover:bg-rose-50 active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-rose-500/30 text-xs font-bold"
                                  aria-label="Delete custom comment"
                                  title="Delete custom comment">×</button>
                              </div>
                            </div>
                          </div>
                        </template>
                        <button type="button"
                          x-on:click="addCustomComment(item.id, (activeItemId === item.id ? activeItemTab : 'information'))"
                          class="w-full mt-1 py-1.5 text-[11px] font-bold rounded-lg border-2 border-dashed text-slate-500 hover:text-slate-800 hover:bg-white/60 transition"
                          style="border-color: #e2e8f0">
                          + Add custom comment
                        </button>
                      </div>
                    </div>

                    {/* Phase T (T15) — photo thumbnails with Annotate overlay */}
                    <div x-show="(results[item.id]?.photos || []).length > 0" class="mt-3 grid grid-cols-4 gap-2">
                      <template x-for="(photo, pi) in (results[item.id]?.photos || [])" x-bind:key="pi">
                        <div class="relative group aspect-square overflow-hidden rounded-lg" style="background:#e2e8f0;">
                          <img x-bind:src="'/api/inspections/' + inspectionId + '/photos/' + encodeURIComponent(photo.annotatedKey || photo.key)"
                            class="w-full h-full object-cover" alt="Photo" />
                          <button type="button"
                            x-on:click="window.dispatchEvent(new CustomEvent('annotate', { detail: { inspectionId, itemId: item.id, photoIndex: pi, imageUrl: '/api/inspections/' + inspectionId + '/photos/' + encodeURIComponent(photo.key), existingNodesJson: photo.annotationsJson || null } }))"
                            class="absolute inset-0 bg-black/50 text-white text-xs font-bold opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                            Annotate
                          </button>
                        </div>
                      </template>
                    </div>
                  </div>
                </div>
              </template>
              {/* Competitor parity App.E.3 — desktop no-results state. */}
              <div
                x-show="hasSearchQuery && searchMatchCount === 0"
                style="display:none"
                data-testid="editor-search-empty-desktop"
                class="col-span-2 xl:col-span-3 rounded-md bg-white border border-dashed border-slate-200 p-8 text-center"
              >
                <p class="text-sm text-slate-500">No matches for &ldquo;<span class="font-semibold text-slate-700" x-text="searchQuery"></span>&rdquo;.</p>
                <button x-on:click="clearSearch()" class="mt-2 text-xs font-semibold text-indigo-600 hover:underline">Clear search</button>
              </div>
            </div>
          </main>

          {/* Spec 5G M1 — Right pane: active item photos + quick comments.
              Hidden in focus mode (⌘2), on screens narrower than xl, and
              while the Comment Library drawer is open (Sprint 1 A-1: avoids
              the slash-trigger popover overlapping ACTIVE ITEM at 1024-1280px). */}
          <aside x-show="viewMode !== 'focus' && activeItem && !showCommentLibrary && !slashPickerOpen" class="hidden lg:flex w-[280px] sticky top-0 h-screen flex-shrink-0 flex-col border-l overflow-hidden" style="background: rgba(255,255,255,0.6); backdrop-filter: blur(12px); border-color: rgba(226,232,240,0.6);">
            <header class="px-4 py-3 border-b" style="border-color: rgba(226,232,240,0.5);">
              <h3 class="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Active Item</h3>
              <p class="text-sm font-bold text-slate-900 mt-0.5 leading-tight" x-text="activeItem?.label || activeItem?.name || ''"></p>
              <p class="text-[10px] font-mono text-slate-400 mt-0.5" x-text="activeItem?.number || ''"></p>
            </header>

            {/* Photos */}
            <section class="px-4 py-3 border-b" style="border-color: rgba(226,232,240,0.5);">
              <div class="flex items-center justify-between mb-2">
                <span class="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Photos · <span x-text="(results[activeItemId]?.photos || []).length"></span></span>
                <label class="text-[10px] text-indigo-500 hover:underline cursor-pointer">
                  + Add
                  <input type="file" accept="image/*" capture="environment" class="hidden" x-on:change="if (activeItemId) { uploadPhoto(activeItemId, $event); $event.target.value = ''; }" />
                </label>
              </div>
              <div class="grid grid-cols-2 gap-1.5" x-show="(results[activeItemId]?.photos || []).length > 0">
                <template x-for="(photo, pi) in (results[activeItemId]?.photos || []).slice(0, 8)" x-bind:key="pi">
                  <div class="aspect-[4/3] rounded overflow-hidden bg-slate-100 relative group">
                    <img x-bind:src="'/api/inspections/' + inspectionId + '/photos/' + encodeURIComponent(photo.annotatedKey || photo.key)" class="w-full h-full object-cover" alt="Photo" />
                    <button
                      x-on:click="window.dispatchEvent(new CustomEvent('annotate', { detail: { inspectionId, itemId: activeItemId, photoIndex: pi, imageUrl: '/api/inspections/' + inspectionId + '/photos/' + encodeURIComponent(photo.key), existingNodesJson: photo.annotationsJson || null } }))"
                      class="absolute bottom-0.5 right-0.5 px-1.5 py-0.5 rounded bg-white/90 text-[9px] font-bold opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Annotate"
                    >✎</button>
                  </div>
                </template>
              </div>
              <p x-show="(results[activeItemId]?.photos || []).length === 0" class="text-[11px] italic text-slate-400 py-2">
                No photos. Press <kbd class="px-1 bg-slate-100 border rounded font-mono">P</kbd> to add.
              </p>
            </section>

            {/* Quick comments */}
            <section class="px-4 py-3 flex-1 overflow-y-auto">
              <div class="flex items-center justify-between mb-2">
                <span class="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Quick Comments</span>
                <button x-on:click="openCommentLibrary()" class="text-[10px] text-indigo-500 hover:underline">Browse all</button>
              </div>
              <div class="space-y-1">
                <template x-for="(c, i) in quickCommentsForActive" x-bind:key="i">
                  <button x-on:click="insertComment(c.text)" class="w-full text-left p-2 rounded text-[11px] text-slate-700 leading-snug border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 transition-all">
                    <div class="flex items-start gap-1.5">
                      <span class="px-1 py-0.5 text-[8px] font-bold uppercase rounded text-white shrink-0 mt-0.5"
                        x-bind:style="c.rating === 'satisfactory' ? 'background:#10b981' : (c.rating === 'monitor' ? 'background:#f59e0b' : (c.rating === 'defect' ? 'background:#ef4444' : 'background:#64748b'))"
                        x-text="c.rating === 'all' ? 'GEN' : c.rating.slice(0, 3)"></span>
                      <span x-text="c.text"></span>
                    </div>
                  </button>
                </template>
              </div>
              <p class="text-[10px] text-slate-400 italic mt-3">
                Press <kbd class="px-1 bg-slate-100 border rounded font-mono">/</kbd> for full library
              </p>
            </section>

            {/* Keyboard hint footer */}
            <footer class="px-4 py-2 border-t text-[10px] text-slate-400" style="border-color: rgba(226,232,240,0.5);">
              <div class="flex items-center gap-1.5 flex-wrap">
                <kbd class="px-1 bg-slate-100 border rounded font-mono">↑↓</kbd> nav
                <kbd class="px-1 bg-slate-100 border rounded font-mono">1-5</kbd> rate
                <kbd class="px-1 bg-slate-100 border rounded font-mono">/</kbd> lib
                <kbd class="px-1 bg-slate-100 border rounded font-mono">?</kbd> all
              </div>
            </footer>
          </aside>
        </div>

        {/* Round-2 F1 — Multi-recipient Publish modal (Spectora §G.3).
             Lists every party (client, buyer's agent, listing agent) with
             per-recipient Email + Text checkboxes, plus a radio that switches
             between sending the report or the agreement. Footer:
                [Cancel]   [Send All]
             Send All disabled when nothing is checked. Empty-state shown
             when the inspection has no contacts. */}
        <PublishModal />
        <Modal
            name="showLegacyPublishOptions"
            title="Publish options"
            size="md"
            footer={
                <>
                    <button
                        type="button"
                        x-on:click="showLegacyPublishOptions = false"
                        class="flex-1 h-10 px-4 text-sm font-semibold rounded-xl border bg-white hover:bg-slate-50 transition-all"
                        style="border-color: #e2e8f0; color: #475569"
                    >
                        Done
                    </button>
                </>
            }
        >
            <div class="space-y-3">
                <label class="flex items-center justify-between">
                    <span class="text-sm" style="color: #475569">Require signature</span>
                    <input type="checkbox" x-model="publishOptions.requireSignature" class="rounded" />
                </label>
                <label class="flex items-center justify-between">
                    <span class="text-sm" style="color: #475569">Require payment</span>
                    <input type="checkbox" x-model="publishOptions.requirePayment" class="rounded" />
                </label>
                <div>
                    <div class="text-xs font-semibold mb-2" style="color: #94a3b8">THEME</div>
                    <div class="flex gap-2">
                        <template x-for="t in ['modern', 'classic', 'minimal']" x-bind:key="t">
                            <button
                                x-on:click="publishOptions.theme = t"
                                class="px-4 py-2 text-xs font-semibold rounded-lg border capitalize transition-all"
                                x-bind:style="publishOptions.theme === t ? 'background: var(--ih-primary, #6366f1); color: white; border-color: transparent' : 'border-color: #e2e8f0; color: #64748b'"
                                x-text="t"
                            ></button>
                        </template>
                    </div>
                </div>
            </div>
        </Modal>

        {/* Onboarding overlay (T6) */}
        <div x-data="inspectionOnboarding()" {...{'x-on:rating-levels-ready.window': 'init($event.detail)'}}>
            <div x-show="active" x-cloak class="fixed inset-0 z-50 flex items-center justify-center p-4" style="background:rgba(15,23,42,0.78);backdrop-filter:blur(6px);">
                <div class="rounded-lg p-8 max-w-md w-full shadow-2xl" style="background:rgba(255,255,255,0.96);border:1px solid rgba(255,255,255,0.6);">
                    <div class="flex items-center gap-3 mb-4">
                        <span x-show="currentStep.abbr" class="px-3 py-1 rounded-lg text-white font-mono font-bold text-sm"
                              x-bind:style="'background:' + currentStep.color"
                              x-text="currentStep.abbr"></span>
                        <h3 class="text-xl font-bold" style="color:#0f172a" x-text="currentStep.title"></h3>
                    </div>
                    <p class="text-sm leading-relaxed mb-6" style="color:#475569" x-text="currentStep.body"></p>
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-mono" style="color:#cbd5e1" x-text="(stepIdx + 1) + ' / ' + totalSteps"></span>
                        <div class="flex gap-2">
                            <button x-on:click="skip()" class="px-4 py-2 rounded-xl text-sm" style="color:#64748b">Skip</button>
                            <button x-on:click="next()" class="px-5 py-2 rounded-xl text-white text-sm font-semibold" style="background:var(--ih-primary, #6366f1)">
                                <span x-text="stepIdx + 1 === totalSteps ? 'Done' : 'Next'"></span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        {/* Spec 5G M2 — Comment Library slide-out (right drawer) */}
        <div x-cloak x-show="showCommentLibrary" class="fixed inset-0 z-[100]" {...{'x-transition.opacity': ''}}>
          <div class="absolute inset-0 bg-slate-900/40" x-on:click="showCommentLibrary = false"></div>
          <aside
            class="absolute right-0 top-0 bottom-0 w-full bg-white shadow-2xl flex flex-col"
            style="max-width: 480px;"
            {...{
              'x-transition:enter': 'transition ease-out duration-200 transform',
              'x-transition:enter-start': 'translate-x-full',
              'x-transition:enter-end': 'translate-x-0',
              'x-transition:leave': 'transition ease-in duration-150 transform',
              'x-transition:leave-start': 'translate-x-0',
              'x-transition:leave-end': 'translate-x-full',
            }}
          >
            <header class="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 class="text-sm font-bold text-slate-900">Comment Library</h2>
                <p class="text-[11px] text-slate-500 mt-0.5">
                  Inserting into <span class="font-semibold" x-text="activeItem?.label || activeItem?.name || ''"></span>
                </p>
              </div>
              <button x-on:click="showCommentLibrary = false" class="text-slate-400 hover:text-slate-700 text-xl leading-none" aria-label="Close">&times;</button>
            </header>
            <div class="px-5 pt-3 pb-2">
              <div class="relative">
                <input
                  id="comment-library-search"
                  type="text"
                  x-model="commentLibrarySearch"
                  x-on:input="commentLibrarySelectedIdx = 0"
                  placeholder="Search 248 comments…"
                  class="w-full px-3 py-2 pr-20 text-xs rounded-md border border-slate-200 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100"
                />
                <span class="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400" x-text="commentLibraryCount"></span>
              </div>
              <p class="text-[10px] text-slate-400 mt-1.5 italic">Use <kbd class="px-1 py-0.5 bg-slate-100 border rounded font-mono">↑↓</kbd> to navigate, <kbd class="px-1 py-0.5 bg-slate-100 border rounded font-mono">⏎</kbd> to insert</p>
            </div>
            <div class="px-5 pb-2 flex flex-wrap gap-1.5">
              <template x-for="f in ['all','satisfactory','monitor','defect','my-snippets']" x-bind:key="f">
                <button x-on:click="commentLibraryFilter = f; commentLibrarySelectedIdx = 0"
                  x-bind:class="commentLibraryFilter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
                  class="px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide"
                  x-text="f === 'my-snippets' ? 'My snippets' : f"></button>
              </template>
            </div>
            <div class="flex-1 overflow-y-auto px-5 py-2 space-y-1.5 border-t border-slate-100">
              <template x-for="(c, i) in commentLibraryItems" x-bind:key="i">
                <button
                  x-on:click="commentLibrarySelectedIdx = i; insertComment(c.text)"
                  x-on:mouseenter="commentLibrarySelectedIdx = i"
                  x-bind:class="commentLibrarySelectedIdx === i ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-100' : 'border-slate-200 hover:border-indigo-300'"
                  class="w-full text-left p-2.5 rounded-md border transition-all"
                >
                  <div class="flex items-start gap-2">
                    <span class="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded text-white shrink-0"
                      x-bind:style="c.rating === 'satisfactory' ? 'background:#10b981' : (c.rating === 'monitor' ? 'background:#f59e0b' : (c.rating === 'defect' ? 'background:#ef4444' : 'background:#64748b'))"
                      x-text="c.source === 'snippet' ? '★' : (c.rating === 'all' ? 'GEN' : c.rating.slice(0, 3))"></span>
                    <span class="text-xs text-slate-700 leading-snug flex-1" x-text="c.text"></span>
                    <span x-show="commentLibrarySelectedIdx === i" class="text-indigo-500 text-xs">⏎</span>
                  </div>
                </button>
              </template>
              <p x-show="commentLibraryItems.length === 0" class="text-xs text-slate-400 text-center py-8 italic">No comments match this filter.</p>
            </div>
            <footer class="px-5 py-2.5 border-t border-slate-100 text-[10px] text-slate-500 flex items-center justify-between gap-2 flex-wrap">
              <span class="flex items-center gap-1"><kbd class="px-1.5 py-0.5 bg-slate-100 border rounded font-mono">⏎</kbd> Insert</span>
              <span class="flex items-center gap-1"><kbd class="px-1.5 py-0.5 bg-slate-100 border rounded font-mono">⌘⏎</kbd> Insert+newline</span>
              <span class="flex items-center gap-1"><kbd class="px-1.5 py-0.5 bg-slate-100 border rounded font-mono">⌘D</kbd> Save snippet</span>
              <span class="flex items-center gap-1"><kbd class="px-1.5 py-0.5 bg-slate-100 border rounded font-mono">Esc</kbd> Close</span>
            </footer>
          </aside>
        </div>

        {/* Photo Annotator Modal (T13) */}
        <div x-data="photoAnnotator()" {...{'x-on:annotate.window': 'openPhoto($event.detail)'}} x-show="open" x-cloak class="fixed inset-0 z-50 flex flex-col" style="background:rgba(15,23,42,0.92);">
            {/* Toolbar */}
            <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-white" style="background:#1e293b;">
                <div class="flex items-center gap-1 flex-wrap">
                    <template x-for="tool in tools" x-bind:key="tool.id">
                        <button x-on:click="setTool(tool.id)"
                            x-bind:title="tool.label"
                            x-bind:class="currentTool === tool.id ? 'bg-blue-600' : 'hover:bg-slate-700'"
                            class="px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5">
                            <span x-text="tool.icon"></span>
                            <span class="hidden md:inline" x-text="tool.label"></span>
                        </button>
                    </template>
                </div>
                <div class="flex items-center gap-2">
                    <input type="color" x-model="color" class="w-9 h-9 rounded cursor-pointer border-0" title="Color" />
                    <select x-model="lineWidth" class="px-2 py-1 rounded bg-slate-700 text-white text-xs" title="Line width">
                        <option value="2">Thin</option>
                        <option value="4">Medium</option>
                        <option value="6">Thick</option>
                    </select>
                    <button x-on:click="undo()" class="px-3 py-2 hover:bg-slate-700 rounded text-xs" title="Undo">↶</button>
                    <button x-on:click="redo()" class="px-3 py-2 hover:bg-slate-700 rounded text-xs" title="Redo">↷</button>
                    <button x-on:click="clear()" class="px-3 py-2 hover:bg-slate-700 rounded text-xs" title="Clear">⌫</button>
                    <button x-on:click="cancel()" class="px-4 py-2 rounded-lg text-xs font-semibold hover:bg-slate-700">Cancel</button>
                    <button x-on:click="save()" x-bind:disabled="saving"
                        class="px-4 py-2 rounded-lg text-xs font-semibold"
                        style="background:#10b981;">
                        <span x-text="saving ? 'Saving...' : 'Save'"></span>
                    </button>
                </div>
            </div>
            {/* Canvas container */}
            <div class="flex-1 flex items-center justify-center overflow-hidden p-4">
                <div id="annotatorContainer" class="bg-white max-w-full max-h-full"></div>
            </div>
        </div>

        {/* Phase T (T23) — Inspector Messages panel (slide-in from right) */}
        <div x-data={`messagesInspector('${inspectionId}')`} x-init="init()">
            {/* Floating button */}
            <button x-on:click="open = !open" class="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full shadow-2xl text-white flex items-center justify-center" style="background:var(--ih-primary, #6366f1);">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                <span x-show="messages.length > 0" class="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center" x-text="messages.length"></span>
            </button>
            {/* Slide-in panel */}
            <div x-show="open" x-cloak class="fixed inset-y-0 right-0 z-50 w-full max-w-md flex flex-col shadow-2xl" style="background:#f8fafc;">
                <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                    <h2 class="text-lg font-bold text-slate-900">Messages</h2>
                    <button x-on:click="open = false" class="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500">×</button>
                </div>
                <div x-show="token" class="px-4 py-2 border-b border-slate-100 bg-slate-50">
                    <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Public link for client</p>
                    <input readonly x-bind:value="publicLink" class="w-full px-2 py-1.5 bg-white rounded text-xs font-mono text-slate-600 border border-slate-200" x-on:click="$event.target.select()" />
                </div>
                <div class="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                    <template x-for="m in messages" x-bind:key="m.id">
                        <div x-bind:class="m.fromRole === 'inspector' ? 'ml-12' : 'mr-12'" class="rounded-md p-3" x-bind:style="m.fromRole === 'inspector' ? 'background:#eef2ff;' : 'background:#f1f5f9;'">
                            <div class="flex items-center justify-between text-xs text-slate-500 mb-1">
                                <span x-text="(m.fromName || m.fromRole) + ' · ' + new Date(m.createdAt).toLocaleString()"></span>
                            </div>
                            <p class="text-sm whitespace-pre-wrap text-slate-900" x-text="m.body"></p>
                            <div x-show="m.attachments && m.attachments.length" class="mt-2 flex flex-wrap gap-2">
                                <template x-for="a in (m.attachments || [])" x-bind:key="a.id">
                                    <a x-bind:href="'/api/photos/' + encodeURIComponent(a.key)" target="_blank"
                                       class="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1 hover:bg-slate-50" x-text="a.name"></a>
                                </template>
                            </div>
                        </div>
                    </template>
                    <p x-show="messages.length === 0" class="text-center text-sm text-slate-400 py-8">No messages yet.</p>
                </div>
                <div class="border-t border-slate-200 p-3 bg-white">
                    <textarea x-model="composeBody" rows={3} placeholder="Reply..." class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm resize-none"></textarea>
                    <div class="mt-2 flex flex-wrap gap-2">
                        <template x-for="(a, i) in pendingAttachments" x-bind:key="a.id">
                            <span class="text-xs bg-slate-100 rounded-lg px-2 py-1 flex items-center gap-1">
                                <span x-text="a.name"></span>
                                <button x-on:click="pendingAttachments.splice(i,1)" class="text-rose-500 hover:text-rose-700">×</button>
                            </span>
                        </template>
                    </div>
                    <div class="mt-2 flex items-center justify-between">
                        <label class="cursor-pointer text-sm text-slate-600 hover:text-indigo-600 inline-flex items-center gap-1">
                            <span>📎</span> <span class="text-xs">Attach</span>
                            <input type="file" multiple class="hidden" x-on:change="upload($event.target.files)" />
                        </label>
                        <button x-on:click="send()" x-bind:disabled="!composeBody || sending"
                            class="px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
                            style="background:var(--ih-primary, #6366f1);">
                            <span x-text="sending ? 'Sending...' : 'Send'"></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        {/* Round 33 — Cheatsheet HUD (mobile help button + desktop ? key).
            Centered modal with two columns: gestures (mobile) + hotkeys
            (desktop). Same modal shown on both platforms; user gets context
            for the device they're on. */}
        <div
          x-show="showCheatsheet"
          x-cloak
          class="fixed inset-0 z-[70] flex items-center justify-center p-4"
          {...{ 'x-on:click.self': 'showCheatsheet = false', 'x-on:keydown.escape.window': 'showCheatsheet = false' }}
          style="background: rgba(0,0,0,0.5)"
        >
          <div class="w-full max-w-md rounded-md p-6 max-h-[85vh] overflow-y-auto" style="background: #ffffff; box-shadow: 0 16px 48px rgba(0,0,0,0.25)">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-bold" style="color: #0f172a">Gestures &amp; Shortcuts</h3>
              <button x-on:click="showCheatsheet = false" class="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center" aria-label="Close">
                <svg class="w-4 h-4" style="color: #64748b" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div x-show="!isDesktop">
              <p class="text-xs uppercase tracking-wide font-semibold mb-3" style="color: #94a3b8">Mobile Gestures</p>
              <ul class="space-y-3 text-sm" style="color: #0f172a">
                <li class="flex items-start gap-3"><span class="mt-0.5 inline-block px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold" style="background: #eef2ff; color: var(--ih-primary, #6366f1)">Swipe ←/→</span><span>Switch to next / previous section</span></li>
                <li class="flex items-start gap-3"><span class="mt-0.5 inline-block px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold" style="background: #eef2ff; color: var(--ih-primary, #6366f1)">Long-press item</span><span>Open Quick Rating sheet</span></li>
                <li class="flex items-start gap-3"><span class="mt-0.5 inline-block px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold" style="background: #eef2ff; color: var(--ih-primary, #6366f1)">Double-tap item</span><span>Enter Focus mode</span></li>
                <li class="flex items-start gap-3"><span class="mt-0.5 inline-block px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold" style="background: #eef2ff; color: var(--ih-primary, #6366f1)">Tap section chip</span><span>Jump directly to that section</span></li>
                <li class="flex items-start gap-3"><span class="mt-0.5 inline-block px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold" style="background: #eef2ff; color: var(--ih-primary, #6366f1)">Tap rating button</span><span>Set Sat / Mon / Def / N/A inline</span></li>
              </ul>
            </div>

            <div x-show="isDesktop">
              <p class="text-xs uppercase tracking-wide font-semibold mb-3" style="color: #94a3b8">Keyboard Shortcuts</p>
              <ul class="space-y-2 text-sm" style="color: #0f172a">
                <li class="flex items-start gap-3"><span class="mt-0.5 inline-block px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold" style="background: #eef2ff; color: var(--ih-primary, #6366f1)">1 / 2 / 3</span><span>Set rating Satisfactory / Monitor / Defect</span></li>
                <li class="flex items-start gap-3"><span class="mt-0.5 inline-block px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold" style="background: #eef2ff; color: var(--ih-primary, #6366f1)">4 / 5</span><span>Not Inspected / Not Present</span></li>
                <li class="flex items-start gap-3"><span class="mt-0.5 inline-block px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold" style="background: #eef2ff; color: var(--ih-primary, #6366f1)">0</span><span>Clear rating · <span class="font-mono">N</span> = N/A</span></li>
                <li class="flex items-start gap-3"><span class="mt-0.5 inline-block px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold" style="background: #eef2ff; color: var(--ih-primary, #6366f1)">↑ / ↓</span><span>Move active item · Enter = next · Shift+Enter = prev</span></li>
                <li class="flex items-start gap-3"><span class="mt-0.5 inline-block px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold" style="background: #eef2ff; color: var(--ih-primary, #6366f1)">G + 0–9</span><span>Jump to section by index</span></li>
                <li class="flex items-start gap-3"><span class="mt-0.5 inline-block px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold" style="background: #eef2ff; color: var(--ih-primary, #6366f1)">/</span><span>Open Comment Library · <span class="font-mono">;</span> = My Snippets</span></li>
                <li class="flex items-start gap-3"><span class="mt-0.5 inline-block px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold" style="background: #eef2ff; color: var(--ih-primary, #6366f1)">P</span><span>Add photo to active item</span></li>
                <li class="flex items-start gap-3"><span class="mt-0.5 inline-block px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold" style="background: #eef2ff; color: var(--ih-primary, #6366f1)">⌘1 / ⌘2 / ⌘3</span><span>Split / Focus / Preview view mode</span></li>
                <li class="flex items-start gap-3"><span class="mt-0.5 inline-block px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold" style="background: #eef2ff; color: var(--ih-primary, #6366f1)">⌘K</span><span>Command palette (coming soon)</span></li>
                <li class="flex items-start gap-3"><span class="mt-0.5 inline-block px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold" style="background: #eef2ff; color: var(--ih-primary, #6366f1)">?</span><span>Toggle this cheatsheet · <span class="font-mono">Esc</span> = close</span></li>
              </ul>
            </div>

            <div class="mt-5 pt-4 border-t text-xs" style="color: #94a3b8; border-color: #e2e8f0">
              Tip: most shortcuts work even when not focused on an input. Press <span class="font-mono font-semibold">?</span> any time to reopen.
            </div>
          </div>
        </div>
      </div>
      {/* commentPicker uses canonical rounded-md (B-7 codemod sweep) */}
      <div id="commentPicker" class="hidden fixed z-[200] bg-white rounded-md shadow-2xl border border-slate-100 p-3 w-72 max-h-64 overflow-y-auto"></div>

      {/* Sprint 1 A-9: section picker popover (G then S leader-keys) */}
      <div
        x-show="sectionPickerOpen"
        style="display:none"
        {...{
          'x-cloak': '',
          'x-on:keydown.escape.window': 'if (sectionPickerOpen) closeSectionPicker()',
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Section picker"
        aria-keyshortcuts="g s"
        class="fixed inset-0 z-[55] flex items-start justify-center pt-[12vh] px-4"
      >
        <div
          class="absolute inset-0 bg-slate-900/30"
          style="backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);"
          x-on:click="closeSectionPicker()"
          x-transition:enter="ease-out duration-200" x-transition:enter-start="opacity-0" x-transition:enter-end="opacity-100"
          x-transition:leave="ease-in duration-150" x-transition:leave-start="opacity-100" x-transition:leave-end="opacity-0"
        ></div>
        <div
          class="relative w-80 rounded-lg bg-white border border-slate-200"
          style="box-shadow: 0 12px 32px rgba(15,23,42,0.12);"
          x-transition:enter="ease-out duration-200" x-transition:enter-start="opacity-0 translate-y-2 scale-[0.97]" x-transition:enter-end="opacity-100 translate-y-0 scale-100"
          x-transition:leave="ease-in duration-150" x-transition:leave-start="opacity-100 translate-y-0 scale-100" x-transition:leave-end="opacity-0 translate-y-1 scale-[0.98]"
        >
          <div class="px-4 py-3 border-b border-slate-100">
            <input
              id="section-picker-input"
              type="text"
              x-model="sectionPickerQuery"
              x-on:input="sectionPickerIdx = 0"
              x-on:keydown="onSectionPickerKeydown($event)"
              placeholder="Jump to section…"
              class="w-full h-8 px-3 rounded-md border border-slate-200 outline-none text-[13px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors"
              aria-label="Section search"
            />
          </div>
          <div class="max-h-72 overflow-y-auto py-1" role="listbox">
            <template x-for="(s, i) in filteredSectionsForPicker" x-bind:key="s.idx">
              <button
                type="button"
                x-on:click="pickSection(s.idx)"
                x-bind:aria-selected="sectionPickerIdx === i"
                x-bind:class="sectionPickerIdx === i ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'"
                class="block w-full text-left px-3 py-2 text-[13px] font-medium transition-colors focus:outline-none"
                role="option"
              >
                <span x-text="s.title"></span>
              </button>
            </template>
            <p x-show="filteredSectionsForPicker.length === 0" class="px-3 py-3 text-[12px] italic text-slate-400">No sections match.</p>
          </div>
          <div class="px-4 py-2 border-t border-slate-100 bg-slate-50/50 rounded-b-lg text-[11px] text-slate-400 font-medium flex items-center gap-2">
            <kbd class="inline-flex items-center px-1 rounded bg-slate-100 text-slate-600 text-[10px]">↑↓</kbd> navigate
            <kbd class="inline-flex items-center px-1 rounded bg-slate-100 text-slate-600 text-[10px]">↵</kbd> jump
            <kbd class="inline-flex items-center px-1 rounded bg-slate-100 text-slate-600 text-[10px]">Esc</kbd> close
          </div>
        </div>
      </div>


      <script src="/js/auth.js"></script>
      <script src="/js/modal-dialog.js"></script>
      <script src="/js/comments-library.js"></script>
      <script src="/js/toast.js"></script>
      {/* Spec 5G M2 — load 248 canned comments before editor inits */}
      <script src="/js/canned-comments.js"></script>
      {/* Sprint 2 S2-3 — expose the contractor recommendation catalog as a
          window global so the inspection-edit.js Alpine template can populate
          the per-defect dropdown without an extra round-trip. JSON.stringify
          escapes correctly for embedding inside <script>. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `window.__OI_RECO_GROUPS = ${JSON.stringify(recoGroups)};`,
        }}
      ></script>
      <script src="/js/inspection-edit.js"></script>
      <script src="/js/inspection-events.js"></script>
      {/* Sprint 2 S2-2 — request switcher Alpine factory. */}
      <script src="/js/request-switcher.js"></script>
      {/* Phase T (T14) — Konva-based photo annotator. konva.min.js (~150KB) is
          lazy-loaded by photo-annotator.js on the first `annotate` event so it
          doesn't block first paint of the inspection edit page. */}
      <script src="/js/photo-annotator.js"></script>
      <script src="/js/onboarding.js"></script>
      <script src="/js/voice-input.js"></script>
      {/* Phase T (T23) — Messages panel script */}
      <script src="/js/messages-inspector.js"></script>
      </>
    ),
  });
}

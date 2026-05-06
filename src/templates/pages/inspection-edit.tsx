// src/templates/pages/inspection-edit.tsx
import { BareLayout } from '../layouts/main-layout';
import type { BrandingConfig } from '../../types/auth';

interface InspectionEditProps {
  inspectionId: string;
  branding?: BrandingConfig | undefined;
}

export function InspectionEditPage({ inspectionId, branding }: InspectionEditProps) {
  const siteName = branding?.siteName || 'OpenInspection';

  return BareLayout({
    title: `${siteName} | Edit Inspection`,
    branding,
    extraHead: (
      <>
        <link rel="stylesheet" href="/fonts.css" />
        <style dangerouslySetInnerHTML={{ __html: `
          body { font-family: 'DM Sans', system-ui, sans-serif; }
          .font-heading { font-family: 'Bricolage Grotesque', system-ui, sans-serif; }
          .font-mono { font-family: 'JetBrains Mono', monospace; }
          .hide-scrollbar::-webkit-scrollbar { display: none; }
          .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
          [x-cloak] { display: none !important; }
        ` }} />
      </>
    ),
    children: (
      <>
      <div
        x-data={`inspectionEditor('${inspectionId}')`}
        class="min-h-screen"
        style="background: #faf9f7; background-image: radial-gradient(circle, #d5d0c8 0.6px, transparent 0.6px); background-size: 20px 20px;"
      >
        {/* P2 — AI Suggest Comment popover (shared scope with inspectionEditor) */}
        <div x-cloak x-show="showAiPopover" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div {...{ 'x-on:click.stop': '$event' }}
               class="w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 space-y-4"
               {...{ 'x-transition:enter': 'transition ease-out duration-150', 'x-transition:enter-start': 'opacity-0 scale-95', 'x-transition:enter-end': 'opacity-100 scale-100' }}>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <svg class="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>
                <h3 class="font-bold text-slate-900">AI Suggestions</h3>
              </div>
              <button type="button" x-on:click="showAiPopover = false" class="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500" aria-label="Close">×</button>
            </div>
            <p class="text-xs text-slate-500">Pick one to insert into the notes field.</p>
            <div class="space-y-2">
              <template x-for="(s, idx) in aiSuggestions" x-bind:key="idx">
                <button type="button" x-on:click="insertSuggestion(s)" class="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-amber-400 hover:bg-amber-50 transition-all text-sm text-slate-700">
                  <span x-text="s"></span>
                </button>
              </template>
            </div>
            <div class="flex justify-end pt-2">
              <button type="button" x-on:click="showAiPopover = false" class="px-4 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100">Cancel</button>
            </div>
          </div>
        </div>

        {/* ===== Mobile View ===== */}
        <div x-show="!isDesktop" class="lg:hidden">
          {/* Sticky Header */}
          <div class="sticky top-0 z-50" style="background: rgba(255,253,250,0.82); backdrop-filter: blur(16px) saturate(1.5); border-bottom: 1px solid rgba(232,228,221,0.5);">
            <div class="px-4 py-3 flex items-center justify-between">
              <div class="flex items-center gap-3">
                <a href="/dashboard" class="w-8 h-8 rounded-xl bg-white/60 flex items-center justify-center">
                  <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
                </a>
                <div>
                  <h1 class="text-sm font-bold leading-tight" style="color: #1a1815" x-text="inspection.propertyAddress || 'Loading...'"></h1>
                  <p class="text-[10px] font-mono" style="color: #b0aaa3" x-text="formattedDate"></p>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span x-show="saveState === 'saving'" x-cloak class="text-[10px] font-semibold text-amber-500">Saving...</span>
                <span x-show="saveState === 'saved'" x-cloak class="text-[10px] font-semibold text-emerald-500">Saved</span>
                <span x-show="saveState === 'error'" x-cloak class="text-[10px] font-semibold text-red-500">Error</span>
                <span class="text-xs font-mono font-semibold px-2 py-1 rounded-lg" style="background: #eef4ff; color: #4a72ff" x-text="completionPercent + '%'"></span>
                <button x-on:click="showMenu = !showMenu" class="w-8 h-8 rounded-xl bg-white/60 flex items-center justify-center">
                  <svg class="w-4 h-4" style="color: #6b6560" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01" /></svg>
                </button>
              </div>
            </div>

            {/* Section Chips */}
            <div class="px-4 pb-3 flex gap-2 overflow-x-auto hide-scrollbar">
              <template x-for="(sec, idx) in sections" x-bind:key="sec.id">
                <button
                  x-on:click="selectSection(idx)"
                  class="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap"
                  x-bind:class="currentSectionIdx === idx ? 'text-white' : 'bg-white/60 text-gray-600'"
                  x-bind:style="currentSectionIdx === idx ? 'background: #4a72ff' : ''"
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

          {/* Item Cards */}
          <div class="px-4 py-4 space-y-3 pb-24">
            <template x-for="item in currentSectionItems" x-bind:key="item.id">
              <div
                class="rounded-2xl p-4 transition-all"
                style="background: rgba(255,253,250,0.82); backdrop-filter: blur(16px) saturate(1.5); border: 1px solid rgba(255,255,255,0.7); border-left: 3px solid transparent;"
                x-bind:style="'border-left-color:' + getRatingColor(getItemRating(item.id))"
              >
                <div class="flex items-start justify-between mb-3">
                  <div>
                    <h3 class="font-bold text-sm font-heading" style="color: #1a1815" x-text="item.label"></h3>
                    <span class="text-[10px] font-mono" style="color: #b0aaa3" x-text="item.number"></span>
                  </div>
                  <span class="w-3 h-3 rounded-full" x-bind:style="'background:' + getRatingColor(getItemRating(item.id))"></span>
                </div>

                {/* Rating Buttons — `data-rating-row` is the anchor target the
                    onboarding overlay (T6 / step 0) highlights so the user
                    knows which buttons the tour is talking about. */}
                <div data-rating-row class="flex flex-wrap gap-1.5 mb-3">
                  <template x-for="level in ratingLevels" x-bind:key="level.id">
                    <button
                      x-on:click="setRating(item.id, level.id)"
                      x-bind:title="level.description ? level.label + ' — ' + level.description : level.label"
                      x-bind:aria-label="level.label"
                      class="px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all"
                      x-bind:class="getItemRating(item.id) === level.id ? 'text-white border-transparent' : 'text-gray-400 hover:text-gray-600'"
                      x-bind:style="getItemRating(item.id) === level.id ? 'background:' + level.color + ';border-color:transparent' : 'border-color: #e8e4dd'"
                      x-text="level.abbreviation"
                    ></button>
                  </template>
                </div>

                {/* Expand Toggle */}
                <div class="flex items-center gap-3 text-xs" style="color: #908a83">
                  <button x-on:click="toggleExpand(item.id)" class="flex items-center gap-1 hover:text-gray-700">
                    <svg class="w-3 h-3 transition-transform" x-bind:class="expanded[item.id] ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                    <span x-text="expanded[item.id] ? 'Collapse' : 'Expand'"></span>
                  </button>
                  <span x-text="getPhotoCount(item.id) + ' photos'"></span>
                  <span x-text="getItemNotes(item.id) ? '1 note' : '0 notes'"></span>
                </div>

                {/* Expanded Detail */}
                <div x-show="expanded[item.id]" x-collapse="" class="mt-3 pt-3" style="border-top: 1px solid rgba(232,228,221,0.5)">
                  <div class="relative">
                    <textarea
                      x-bind:id="'notes-mob-' + item.id"
                      x-model="results[item.id].notes"
                      x-on:input="debounceSave()"
                      placeholder="Add notes..."
                      class="w-full p-3 text-sm rounded-xl border resize-none"
                      style="background: #f3f1ed; border-color: #e8e4dd; color: #1a1815"
                      rows={3}
                    ></textarea>
                    <button type="button"
                      x-bind:data-mic-target="'notes-mob-' + item.id"
                      x-init="window.__rebindMicButtons && window.__rebindMicButtons()"
                      class="absolute top-2 right-2 w-7 h-7 rounded-lg bg-white/90 border border-surface-200 flex items-center justify-center hover:bg-white"
                      title="Dictate (Web Speech)"
                      aria-label="Dictate notes">
                      <svg class="w-3.5 h-3.5 text-ink-500" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                        <path d="M19 11h-1.7c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72z"/>
                      </svg>
                    </button>
                  </div>
                  <div class="mt-2 flex gap-2 flex-wrap">
                    <label class="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer" style="background: #eef4ff; color: #4a72ff">
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
                  {/* Phase T (T15) — photo thumbnails with Annotate overlay */}
                  <div x-show="(results[item.id]?.photos || []).length > 0" class="mt-3 grid grid-cols-3 gap-2">
                    <template x-for="(photo, pi) in (results[item.id]?.photos || [])" x-bind:key="pi">
                      <div class="relative group aspect-square overflow-hidden rounded-lg" style="background:#e8e4dd;">
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
          </div>

          {/* Spec 4D mobile — Inspection Events compact list */}
          <section x-data={`inspectionEventsSection('${inspectionId}')`} x-init="load()" class="mx-4 mb-24 mt-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
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
          <div class="fixed bottom-0 left-0 right-0 z-40 px-4 py-3 flex gap-3" style="background: rgba(255,253,250,0.90); backdrop-filter: blur(16px); border-top: 1px solid rgba(232,228,221,0.5);">
            <button x-on:click="previewReport()" class="flex-1 py-3 text-sm font-semibold rounded-xl border" style="border-color: #e8e4dd; color: #46423c">Preview</button>
            <button
              x-on:click="showPublishModal = true"
              x-bind:disabled="completionPercent < 100"
              class="flex-1 py-3 text-sm font-bold rounded-xl text-white disabled:opacity-40"
              style="background: #4a72ff"
            >Publish</button>
          </div>
        </div>

        {/* ===== Desktop View ===== */}
        <div x-show="isDesktop" class="hidden lg:flex min-h-screen">
          {/* Left Sidebar */}
          <aside class="w-[220px] sticky top-0 h-screen flex-shrink-0 flex flex-col border-r overflow-y-auto" style="background: rgba(255,255,255,0.6); backdrop-filter: blur(12px); border-color: rgba(232,228,221,0.5);">
            <div class="px-5 pt-6 pb-4 border-b" style="border-color: rgba(232,228,221,0.4)">
              <a href="/dashboard" class="flex items-center gap-2 text-xs mb-3 hover:text-blue-600 transition-colors" style="color: #908a83">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
                Dashboard
              </a>
              <h2 class="text-sm font-bold font-heading" style="color: #1a1815" x-text="inspection.propertyAddress || 'Loading...'"></h2>
              <p class="text-[10px] font-mono mt-1" style="color: #b0aaa3" x-text="formattedDate"></p>
            </div>
            <div class="px-5 py-3">
              <div class="flex justify-between text-[10px] font-mono mb-1" style="color: #908a83">
                <span>Progress</span>
                <span x-text="completionPercent + '%'"></span>
              </div>
              <div class="h-1.5 rounded-full" style="background: #e8e4dd">
                <div class="h-full rounded-full transition-all duration-500" x-bind:style="'width:' + completionPercent + '%; background: #4a72ff'"></div>
              </div>
              <div class="mt-2 text-[10px] font-mono" style="color: #908a83">
                <span x-show="saveState === 'saving'" x-cloak class="text-amber-500">Saving...</span>
                <span x-show="saveState === 'saved'" x-cloak class="text-emerald-500">All changes saved</span>
                <span x-show="saveState === 'error'" x-cloak class="text-red-500">Save failed</span>
              </div>
            </div>
            {/* Report Access */}
            <div class="px-4 py-3 border-t space-y-2" style="border-color: rgba(232,228,221,0.4)">
              <div class="text-[10px] font-mono font-semibold uppercase tracking-wide mb-2" style="color: #908a83">Report Access</div>
              <label class="flex items-center justify-between cursor-pointer">
                <span class="text-xs" style="color: #46423c">Require Payment</span>
                <button
                  x-on:click={`authFetch('/api/inspections/${inspectionId}', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({paymentRequired:!inspection.paymentRequired})}).then(r=>r.json()).then(d=>{ if(d.success) inspection.paymentRequired=!inspection.paymentRequired; })`}
                  x-bind:class="inspection.paymentRequired ? 'bg-indigo-500' : 'bg-slate-200'"
                  class="relative w-8 h-5 rounded-full transition-colors flex-shrink-0"
                >
                  <span x-bind:class="inspection.paymentRequired ? 'translate-x-3' : 'translate-x-0.5'" class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform" />
                </button>
              </label>
              <label class="flex items-center justify-between cursor-pointer">
                <span class="text-xs" style="color: #46423c">Require Agreement</span>
                <button
                  x-on:click={`authFetch('/api/inspections/${inspectionId}', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({agreementRequired:!inspection.agreementRequired})}).then(r=>r.json()).then(d=>{ if(d.success) inspection.agreementRequired=!inspection.agreementRequired; })`}
                  x-bind:class="inspection.agreementRequired ? 'bg-indigo-500' : 'bg-slate-200'"
                  class="relative w-8 h-5 rounded-full transition-colors flex-shrink-0"
                >
                  <span x-bind:class="inspection.agreementRequired ? 'translate-x-3' : 'translate-x-0.5'" class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform" />
                </button>
              </label>
              <div class="mt-2">
                <label class="block text-[10px] font-mono font-semibold uppercase tracking-wide mb-1" style="color: #908a83">Report Theme Override</label>
                <select
                  x-bind:value="inspection.reportThemeOverride || ''"
                  x-on:change={`const v=$event.target.value||null;authFetch('/api/inspections/${inspectionId}', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({reportThemeOverride:v})}).then(r=>r.json()).then(d=>{if(d.success)inspection.reportThemeOverride=v;});`}
                  class="w-full px-2 py-1 text-xs border rounded bg-white"
                  style="border-color: rgba(232,228,221,0.6); color: #46423c"
                >
                  <option value="">Use tenant default</option>
                  <option value="modern">Modern</option>
                  <option value="classic">Classic</option>
                  <option value="minimal">Minimal</option>
                </select>
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
                  style="background: #f1ede8; color: #46423c"
                />
                <div x-show="agentUrl" class="flex items-center gap-1 mt-1">
                  <input x-bind:value="agentUrl" readonly class="flex-1 text-[10px] border rounded px-2 py-1 bg-white" style="border-color: rgba(232,228,221,0.6)" />
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
                    county: inspection.county || ''
                }`}
                class="px-4 py-3 border-t space-y-2"
                style="border-color: rgba(232,228,221,0.4)"
            >
                <div class="flex items-center justify-between">
                    <div class="text-[10px] font-mono font-semibold uppercase tracking-wide" style="color: #908a83">Property Info</div>
                    <button x-show="!editing" x-on:click="editing=true" class="text-[10px] text-blue-600 font-semibold">Edit</button>
                    <div x-show="editing" class="flex gap-1">
                        <button
                            x-on:click={`authFetch('/api/inspections/${inspectionId}', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({yearBuilt:fields.yearBuilt?parseInt(fields.yearBuilt):null,sqft:fields.sqft?parseInt(fields.sqft):null,foundationType:fields.foundationType||null,bedrooms:fields.bedrooms?parseInt(fields.bedrooms):null,bathrooms:fields.bathrooms?parseFloat(fields.bathrooms):null,unit:fields.unit||null,county:fields.county||null})}).then(r=>r.json()).then(d=>{if(d.success){Object.assign(inspection,{yearBuilt:fields.yearBuilt?parseInt(fields.yearBuilt):null,sqft:fields.sqft?parseInt(fields.sqft):null,foundationType:fields.foundationType||null,bedrooms:fields.bedrooms?parseInt(fields.bedrooms):null,bathrooms:fields.bathrooms?parseFloat(fields.bathrooms):null,unit:fields.unit||null,county:fields.county||null});editing=false;}})`}
                            class="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded-md font-semibold"
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
                            <div x-show="!editing" class="font-semibold" style="color: #1a1815" x-text={`fields.${key} || '—'`} />
                            <input x-show="editing" x-model={`fields.${key}`} type={type}
                                   class="w-full text-[11px] border border-slate-200 rounded px-1.5 py-0.5 bg-white" />
                        </div>
                    ))}
                    <div class="col-span-2">
                        <div class="text-[9px] font-mono uppercase text-slate-400">Foundation</div>
                        <div x-show="!editing" class="font-semibold" style="color: #1a1815" x-text="fields.foundationType || '—'" />
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
                  class="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left text-sm transition-all"
                  x-bind:style="currentSectionIdx === idx ? 'background: #eef4ff; color: #4a72ff' : 'color: #6b6560'"
                >
                  <span class="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    x-bind:style="currentSectionIdx === idx ? 'background: rgba(74,114,255,0.12)' : 'background: #f3f1ed'">
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
            {/* Toolbar */}
            <div class="sticky top-0 z-40 px-6 py-3 flex items-center justify-between" style="background: rgba(255,253,250,0.82); backdrop-filter: blur(16px) saturate(1.5); border-bottom: 1px solid rgba(232,228,221,0.5);">
              <div class="flex items-center gap-3">
                <h2 class="text-2xl font-bold font-heading" style="color: #1a1815" x-text="currentSection?.title || ''"></h2>
                <span class="text-xs font-mono px-2 py-1 rounded-lg" style="background: #f3f1ed; color: #908a83" x-text="'SECTION ' + (currentSectionIdx + 1) + '/' + sections.length"></span>
                <button
                  x-on:click="batchMode = !batchMode"
                  class="px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all"
                  x-bind:style="batchMode ? 'background: #eef4ff; color: #4a72ff; border-color: #bcd2ff' : 'border-color: #e8e4dd; color: #6b6560'"
                >Batch</button>
              </div>
              <div class="flex items-center gap-2">
                <button x-on:click="previewReport()" class="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl" style="color: #6b6560">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  Preview
                </button>
                <button
                  x-on:click="showPublishModal = true"
                  class="flex items-center gap-2 px-5 py-2 text-sm font-bold rounded-xl text-white"
                  style="background: #4a72ff"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                  Publish
                </button>
              </div>
            </div>

            {/* Batch Mode Toolbar */}
            <div x-show="batchMode" class="px-6 py-2 flex items-center gap-3 text-sm" style="background: #eef4ff; border-bottom: 1px solid #bcd2ff">
              <span class="font-semibold" style="color: #4a72ff" x-text="'Selected ' + selectedBatchCount + '/' + currentSectionItems.length"></span>
              <button x-on:click="batchSelectAll()" class="px-3 py-1 rounded-lg text-xs font-semibold" style="background: white; color: #4a72ff">Select All</button>
              <template x-for="level in ratingLevels" x-bind:key="level.id">
                <button x-on:click="batchSetRating(level.id)" class="px-3 py-1 rounded-lg text-xs font-semibold" style="background: white; color: #46423c" x-text="'Set ' + level.abbreviation"></button>
              </template>
              <button x-on:click="batchMode = false; batchSelected = {}" class="ml-auto px-3 py-1 rounded-lg text-xs font-semibold" style="color: #6b6560">Exit</button>
            </div>

            {/* Status Machine Bar */}
            <div
                x-data="{ showCancelModal: false, cancelReason: 'client_cancelled', cancelNotes: '' }"
                class="mx-6 mt-3 bg-white border rounded-xl px-4 py-2.5 flex items-center justify-between gap-3"
                style="border-color: rgba(232,228,221,0.5)"
            >
                <div class="flex items-center gap-2">
                    <span class="text-[10px] font-mono uppercase" style="color: #908a83">Status</span>
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
                    >Confirm</button>
                    <button
                        x-show="inspection.status !== 'cancelled' && inspection.status !== 'completed'"
                        x-on:click="showCancelModal=true"
                        class="text-[11px] border text-red-600 px-3 py-1 rounded-lg font-bold"
                        style="border-color: #fecaca; background: #fef2f2"
                    >Cancel</button>
                    <button
                        x-show="inspection.status === 'cancelled'"
                        x-on:click={`authFetch('/api/inspections/${inspectionId}/uncancel',{method:'POST'}).then(r=>r.json()).then(d=>{if(d.success)inspection.status='scheduled'})`}
                        class="text-[11px] bg-slate-100 text-slate-700 px-3 py-1 rounded-lg font-bold"
                    >Restore</button>
                </div>
                {/* Cancel Modal */}
                <div x-show="showCancelModal" class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" {...{'x-cloak': ''}}>
                    <div class="bg-white rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
                        <h3 class="text-base font-bold mb-4" style="color: #1a1815">Cancel Inspection</h3>
                        <label class="block text-xs font-bold text-slate-600 mb-1">Reason</label>
                        <select x-model="cancelReason" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-3 bg-white">
                            <option value="client_cancelled">Client Cancelled</option>
                            <option value="scheduling_conflict">Scheduling Conflict</option>
                            <option value="weather">Weather</option>
                            <option value="other">Other</option>
                        </select>
                        <label class="block text-xs font-bold text-slate-600 mb-1">Notes (optional)</label>
                        <textarea x-model="cancelNotes" rows={3} class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-4" />
                        <div class="flex gap-2">
                            <button
                                x-on:click={`authFetch('/api/inspections/${inspectionId}/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:cancelReason,notes:cancelNotes||undefined})}).then(r=>r.json()).then(d=>{if(d.success){inspection.status='cancelled';showCancelModal=false;}})`}
                                class="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm font-bold"
                            >Cancel Inspection</button>
                            <button x-on:click="showCancelModal=false" class="px-4 text-slate-500 text-sm">Back</button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Inspection Events (Spec 4D.T9) */}
            <section x-data={`inspectionEventsSection('${inspectionId}')`} x-init="load()" class="mx-6 mt-3 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
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
                <div x-show="showCreate" x-cloak class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" {...{ 'x-on:click': 'if ($event.target === $el) showCreate = false' }}>
                    <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
                        <h3 class="text-lg font-bold text-slate-900 mb-4">New event</h3>
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
                        <div class="flex gap-3 justify-end mt-5">
                            <button type="button" x-on:click="showCreate = false" class="px-4 py-2 rounded-lg ring-2 ring-slate-200 text-slate-600 text-xs font-bold">Cancel</button>
                            <button type="button" x-on:click="submitCreate()" {...{ 'x-bind:disabled': 'saving' }} class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold disabled:opacity-50">
                                <span x-text="saving ? 'Saving...' : 'Add event'"></span>
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            {/* Card Grid */}
            <div class="p-6 grid grid-cols-2 xl:grid-cols-3 gap-4">
              <template x-for="item in currentSectionItems" x-bind:key="item.id">
                <div
                  class="rounded-2xl p-4 transition-all cursor-pointer group"
                  style="background: rgba(255,253,250,0.82); backdrop-filter: blur(16px) saturate(1.5); border: 1px solid rgba(255,255,255,0.7);"
                  x-bind:style="'border-top: 4px solid ' + getRatingColor(getItemRating(item.id))"
                  x-on:click="batchMode ? toggleBatchSelect(item.id) : toggleExpand(item.id)"
                >
                  <div x-show="batchMode" class="mb-2">
                    <input type="checkbox" x-bind:checked="batchSelected[item.id]" aria-label="Select item for batch rating" class="rounded" />
                  </div>
                  <div class="flex items-start justify-between mb-3">
                    <div>
                      <h3 class="font-bold text-sm group-hover:text-blue-600 transition-colors font-heading" style="color: #1a1815" x-text="item.label"></h3>
                      <span class="text-[10px] font-mono" style="color: #b0aaa3" x-text="item.number"></span>
                    </div>
                    <span
                      class="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase"
                      x-show="getItemRating(item.id)"
                      x-text="getRatingLabel(getItemRating(item.id))"
                      x-bind:style="'background:' + getRatingColor(getItemRating(item.id)) + '20; color:' + getRatingColor(getItemRating(item.id))"
                    ></span>
                  </div>
                  {/* Rating Buttons */}
                  <div class="flex flex-wrap gap-1.5 mb-3" x-on:click="$event.stopPropagation()">
                    <template x-for="level in ratingLevels" x-bind:key="level.id">
                      <button
                        x-on:click="setRating(item.id, level.id)"
                        x-bind:title="level.description ? level.label + ' — ' + level.description : level.label"
                        x-bind:aria-label="level.label"
                        class="px-2.5 py-1 text-[10px] font-semibold rounded-lg border transition-all"
                        x-bind:class="getItemRating(item.id) === level.id ? 'text-white border-transparent' : 'text-gray-400 hover:text-gray-600'"
                        x-bind:style="getItemRating(item.id) === level.id ? 'background:' + level.color + ';border-color:transparent' : 'border-color: #e8e4dd'"
                        x-text="level.abbreviation"
                      ></button>
                    </template>
                  </div>
                  <div class="flex items-center gap-3 text-[10px] font-mono" style="color: #b0aaa3">
                    <span x-text="getPhotoCount(item.id) + ' photos'"></span>
                    <span x-text="getItemNotes(item.id) ? '1 note' : '0 notes'"></span>
                  </div>

                  {/* Expanded Detail (desktop) */}
                  <div x-show="expanded[item.id] && !batchMode" x-collapse="" class="mt-3 pt-3" style="border-top: 1px solid rgba(232,228,221,0.5)" x-on:click="$event.stopPropagation()">
                    <div class="relative">
                      <textarea
                        x-bind:id="'notes-dsk-' + item.id"
                        x-model="results[item.id].notes"
                        x-on:input="debounceSave()"
                        placeholder="Add notes..."
                        class="w-full p-3 text-sm rounded-xl border resize-none"
                        style="background: #f3f1ed; border-color: #e8e4dd; color: #1a1815"
                        rows={3}
                      ></textarea>
                      <button type="button"
                        x-bind:data-mic-target="'notes-dsk-' + item.id"
                        x-init="window.__rebindMicButtons && window.__rebindMicButtons()"
                        class="absolute top-2 right-2 w-7 h-7 rounded-lg bg-white/90 border border-surface-200 flex items-center justify-center hover:bg-white"
                        title="Dictate (Web Speech)"
                        aria-label="Dictate notes">
                        <svg class="w-3.5 h-3.5 text-ink-500" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                          <path d="M19 11h-1.7c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72z"/>
                        </svg>
                      </button>
                    </div>
                    <div class="mt-2 flex gap-2 flex-wrap">
                      <label class="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer" style="background: #eef4ff; color: #4a72ff">
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
                    {/* Phase T (T15) — photo thumbnails with Annotate overlay */}
                    <div x-show="(results[item.id]?.photos || []).length > 0" class="mt-3 grid grid-cols-4 gap-2">
                      <template x-for="(photo, pi) in (results[item.id]?.photos || [])" x-bind:key="pi">
                        <div class="relative group aspect-square overflow-hidden rounded-lg" style="background:#e8e4dd;">
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
            </div>
          </main>
        </div>

        {/* ===== Publish Modal ===== */}
        <div {...{'x-cloak': ''}} x-show="showPublishModal" x-transition:enter="transition ease-out duration-200" x-transition:enter-start="opacity-0" x-transition:enter-end="opacity-100" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div class="w-full max-w-md rounded-3xl p-6 shadow-xl" style="background: rgba(255,253,250,0.95); backdrop-filter: blur(20px);" x-on:click="if ($event.target === $el) showPublishModal = false">
            <h3 class="text-lg font-bold mb-4 font-heading" style="color: #1a1815">Publish Report</h3>
            <div class="space-y-4">
              <div class="p-3 rounded-xl" style="background: #f3f1ed">
                <div class="text-xs font-mono" style="color: #908a83">Report Summary</div>
                <div class="text-sm mt-1" style="color: #2d2a26" x-text="reportStats.total + ' items  |  ' + reportStats.defect + ' defects  |  ' + reportStats.monitor + ' monitors'"></div>
              </div>
              <div class="space-y-3">
                <label class="flex items-center justify-between">
                  <span class="text-sm" style="color: #46423c">Email client</span>
                  <input type="checkbox" x-model="publishOptions.notifyClient" class="rounded" checked />
                </label>
                <label class="flex items-center justify-between">
                  <span class="text-sm" style="color: #46423c">Email agent</span>
                  <input type="checkbox" x-model="publishOptions.notifyAgent" class="rounded" checked />
                </label>
                <label class="flex items-center justify-between">
                  <span class="text-sm" style="color: #46423c">Require signature</span>
                  <input type="checkbox" x-model="publishOptions.requireSignature" class="rounded" />
                </label>
                <label class="flex items-center justify-between">
                  <span class="text-sm" style="color: #46423c">Require payment</span>
                  <input type="checkbox" x-model="publishOptions.requirePayment" class="rounded" />
                </label>
              </div>
              <div>
                <div class="text-xs font-semibold mb-2" style="color: #908a83">THEME</div>
                <div class="flex gap-2">
                  <template x-for="t in ['modern', 'classic', 'minimal']" x-bind:key="t">
                    <button
                      x-on:click="publishOptions.theme = t"
                      class="px-4 py-2 text-xs font-semibold rounded-lg border capitalize transition-all"
                      x-bind:style="publishOptions.theme === t ? 'background: #4a72ff; color: white; border-color: transparent' : 'border-color: #e8e4dd; color: #6b6560'"
                      x-text="t"
                    ></button>
                  </template>
                </div>
              </div>
            </div>
            <div class="flex gap-3 mt-6">
              <button x-on:click="showPublishModal = false" class="flex-1 py-3 text-sm font-semibold rounded-xl border" style="border-color: #e8e4dd; color: #46423c">Cancel</button>
              <button
                type="button"
                {...{ 'x-on:click': 'sendReportPdf()' }}
                {...{ 'x-bind:disabled': 'sendingPdf' }}
                class="px-5 py-3 rounded-xl bg-emerald-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50 transition-all"
              >
                <span x-show="!sendingPdf">📧 Send PDF to Client</span>
                <span x-show="sendingPdf">Sending…</span>
              </button>
              <button x-on:click="publish()" class="flex-1 py-3 text-sm font-bold rounded-xl text-white" style="background: #4a72ff" x-bind:disabled="publishing">
                <span x-text="publishing ? 'Publishing...' : 'Confirm Publish'"></span>
              </button>
            </div>
          </div>
        </div>

        {/* Onboarding overlay (T6) */}
        <div x-data="inspectionOnboarding()" {...{'x-on:rating-levels-ready.window': 'init($event.detail)'}}>
            <div x-show="active" x-cloak class="fixed inset-0 z-50 flex items-center justify-center p-4" style="background:rgba(15,23,42,0.78);backdrop-filter:blur(6px);">
                <div class="rounded-3xl p-8 max-w-md w-full shadow-2xl" style="background:rgba(255,253,250,0.96);border:1px solid rgba(255,255,255,0.6);">
                    <div class="flex items-center gap-3 mb-4">
                        <span x-show="currentStep.abbr" class="px-3 py-1 rounded-lg text-white font-mono font-bold text-sm"
                              x-bind:style="'background:' + currentStep.color"
                              x-text="currentStep.abbr"></span>
                        <h3 class="text-xl font-bold" style="color:#1a1815" x-text="currentStep.title"></h3>
                    </div>
                    <p class="text-sm leading-relaxed mb-6" style="color:#46423c" x-text="currentStep.body"></p>
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-mono" style="color:#b0aaa3" x-text="(stepIdx + 1) + ' / ' + totalSteps"></span>
                        <div class="flex gap-2">
                            <button x-on:click="skip()" class="px-4 py-2 rounded-xl text-sm" style="color:#6b6560">Skip</button>
                            <button x-on:click="next()" class="px-5 py-2 rounded-xl text-white text-sm font-semibold" style="background:#4a72ff">
                                <span x-text="stepIdx + 1 === totalSteps ? 'Done' : 'Next'"></span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
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
            <button x-on:click="open = !open" class="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full shadow-2xl text-white flex items-center justify-center" style="background:#4a72ff;">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                <span x-show="messages.length > 0" class="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center" x-text="messages.length"></span>
            </button>
            {/* Slide-in panel */}
            <div x-show="open" x-cloak class="fixed inset-y-0 right-0 z-50 w-full max-w-md flex flex-col shadow-2xl" style="background:#faf9f7;">
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
                        <div x-bind:class="m.fromRole === 'inspector' ? 'ml-12' : 'mr-12'" class="rounded-2xl p-3" x-bind:style="m.fromRole === 'inspector' ? 'background:#eef4ff;' : 'background:#f3f1ed;'">
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
                            style="background:#4a72ff;">
                            <span x-text="sending ? 'Sending...' : 'Send'"></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
      </div>
      <div id="commentPicker" class="hidden fixed z-[200] bg-white rounded-2xl shadow-2xl border border-slate-100 p-3 w-72 max-h-64 overflow-y-auto"></div>
      <script src="/js/auth.js"></script>
      <script src="/js/modal-dialog.js"></script>
      <script src="/js/comments-library.js"></script>
      <script src="/js/toast.js"></script>
      <script src="/js/inspection-edit.js"></script>
      <script src="/js/inspection-events.js"></script>
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

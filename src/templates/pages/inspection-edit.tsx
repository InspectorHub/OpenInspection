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

                {/* Rating Buttons */}
                <div class="flex flex-wrap gap-1.5 mb-3">
                  <template x-for="level in ratingLevels" x-bind:key="level.id">
                    <button
                      x-on:click="setRating(item.id, level.id)"
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
                  <textarea
                    x-model="results[item.id].notes"
                    x-on:input="debounceSave()"
                    placeholder="Add notes..."
                    class="w-full p-3 text-sm rounded-xl border resize-none"
                    style="background: #f3f1ed; border-color: #e8e4dd; color: #1a1815"
                    rows={3}
                  ></textarea>
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
                  </div>
                </div>
              </div>
            </template>
          </div>

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
                    <textarea
                      x-model="results[item.id].notes"
                      x-on:input="debounceSave()"
                      placeholder="Add notes..."
                      class="w-full p-3 text-sm rounded-xl border resize-none"
                      style="background: #f3f1ed; border-color: #e8e4dd; color: #1a1815"
                      rows={3}
                    ></textarea>
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
              <button x-on:click="publish()" class="flex-1 py-3 text-sm font-bold rounded-xl text-white" style="background: #4a72ff" x-bind:disabled="publishing">
                <span x-text="publishing ? 'Publishing...' : 'Confirm Publish'"></span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div id="commentPicker" class="hidden fixed z-[200] bg-white rounded-2xl shadow-2xl border border-slate-100 p-3 w-72 max-h-64 overflow-y-auto"></div>
      <script src="/js/auth.js"></script>
      <script src="/js/comments-library.js"></script>
      <script src="/js/toast.js"></script>
      <script src="/js/inspection-edit.js"></script>
      </>
    ),
  });
}

import { BareLayout } from '../layouts/main-layout';
import { AtmosphericBg } from '../components/atmospheric-bg';
import { BrandingConfig } from '../../types/auth';

export const FormRendererPage = (props: { inspectionId: string, branding?: BrandingConfig | undefined }): JSX.Element => {
    const { inspectionId, branding } = props;
    
    return (
        <BareLayout title="Inspection Field Tool" branding={branding}>
            <div class="min-h-screen bg-slate-50 text-slate-900 overflow-x-hidden relative" x-data={`inspectionForm('${inspectionId}')`}>
                <AtmosphericBg />

                {/* Main Viewport */}
                <div class="max-w-4xl mx-auto px-6 py-8 relative z-10">
                    {/* Sticky Professional Header */}
                    <div class="sticky top-6 z-50 mb-10 transition-all duration-500" x-bind:class="{ 'translate-y-[-12px]': scrolled }">
                        <div class="glass-panel flex items-center justify-between px-8 py-5 rounded-[2.5rem] shadow-2xl shadow-indigo-100/30 ring-1 ring-white/60">
                            <div>
                                <h1 class="text-2xl font-black tracking-tightest text-slate-900 leading-tight" x-text="inspection?.propertyAddress || 'Loading...'"></h1>
                                <div class="flex items-center gap-2 mt-1">
                                    <span class="text-[10px] font-black uppercase tracking-widest text-indigo-600/60" x-text="template?.name || 'Inspection Template'"></span>
                                    <span class="w-1 h-1 bg-slate-200 rounded-full"></span>
                                    <span class="text-[10px] font-black uppercase tracking-widest text-slate-400" x-text="inspectionId.substring(0,8).toUpperCase()"></span>
                                </div>
                            </div>
                            <div class="flex items-center gap-6">
                                <div class="flex flex-col items-end">
                                    <span class="flex items-center gap-2 px-3 py-1.5 rounded-full ring-1 transition-all duration-300"
                                        x-bind:class="online ? 'bg-emerald-50 text-emerald-600 ring-emerald-100' : 'bg-rose-50 text-rose-600 ring-rose-100'">
                                        <span class="w-2 h-2 rounded-full shadow-sm" x-bind:class="online ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'"></span>
                                        <span class="text-[10px] font-black uppercase tracking-widest" x-text="online ? 'Live' : 'Local Cache'"></span>
                                    </span>
                                </div>
                                <button x-on:click="syncData" 
                                    class="w-12 h-12 flex items-center justify-center rounded-2xl bg-white shadow-xl shadow-indigo-100/20 hover:bg-slate-50 transition-all active:scale-95 group"
                                    x-bind:disabled="syncing" 
                                    x-bind:class="{ 'opacity-50': syncing }">
                                    <svg class="w-5 h-5 text-slate-400 group-hover:text-indigo-600 transition-colors" x-bind:class="{ 'animate-spin': syncing }" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                </button>
                            </div>
                        </div>
                        
                        {/* Progress Bar */}
                        <div class="mt-4 px-2">
                            <div class="h-2 w-full bg-slate-200/50 rounded-full overflow-hidden backdrop-blur-sm shadow-inner p-0.5">
                                <div class="h-full bg-gradient-to-r from-indigo-600 to-blue-500 rounded-full transition-all duration-1000 ease-out shadow-[0_0_12px_rgba(79,70,229,0.4)]" 
                                    x-bind:style="'width: ' + completionPercentage + '%'">
                                </div>
                            </div>
                            <div class="flex justify-between mt-2 px-2">
                                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Progress</p>
                                <p class="text-[10px] font-black text-indigo-600 uppercase tracking-widest tabular-nums" x-text="completionPercentage + '%'"></p>
                            </div>
                        </div>
                    </div>

                    {/* Inspection Architecture Loop */}
                    <div class="space-y-8 animate-slide-in">
                        <template x-for="section in templateSchema.sections" x-bind:key="section.id">
                            <div class="glass-panel rounded-[2.5rem] overflow-hidden shadow-2xl shadow-indigo-100/10 border-white/40 transition-all duration-500"
                                x-bind:class="openSections.includes(section.id) ? 'ring-2 ring-indigo-500/10' : ''">
                                
                                <button x-on:click="toggleSection(section.id)" class="w-full px-10 py-8 flex justify-between items-center bg-white/40 hover:bg-white/60 transition-all group">
                                    <div class="flex items-center gap-4">
                                        <div class="w-10 h-10 rounded-2xl flex items-center justify-center transition-all bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white group-hover:rotate-6">
                                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                                        </div>
                                        <h2 class="text-2xl font-black tracking-tightest text-slate-900" x-text="section.title"></h2>
                                    </div>
                                    <div class="flex items-center gap-4">
                                        <span class="text-[10px] font-black uppercase tracking-widest text-slate-400" x-text="section.items ? section.items.length + ' points' : ''"></span>
                                        <div class="w-8 h-8 rounded-full flex items-center justify-center transition-transform duration-300 bg-slate-50" x-bind:class="{ 'rotate-180': openSections.includes(section.id) }">
                                            <svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                                        </div>
                                    </div>
                                </button>

                                <div x-show="openSections.includes(section.id)" x-collapse="true">
                                    <div class="p-10 pt-4 space-y-12 divide-y divide-slate-100/50">
                                        <template x-for="item in section.items" x-bind:key="item.id">
                                            <div class="pt-10 first:pt-0">
                                                <div class="flex justify-between items-start mb-6">
                                                    <div class="max-w-xl">
                                                        <h3 class="text-lg font-black tracking-tightest text-slate-900" x-text="item.label"></h3>
                                                        <p class="mt-2 text-sm text-slate-400 font-medium leading-relaxed" x-text="item.description" x-show="item.description"></p>
                                                    </div>
                                                </div>

                                                {/* Point-Specific Status Matrix */}
                                                <div class="grid grid-cols-3 gap-3 mb-8">
                                                    <template x-for="status in ['Satisfactory', 'Monitor', 'Defect']">
                                                        <button
                                                            x-on:click="setItemStatus(item.id, status)"
                                                            class="py-4 px-3 rounded-[1.25rem] text-[10px] font-black uppercase tracking-widest border-2 transition-all flex flex-col items-center justify-center gap-2 active:scale-95 shadow-sm"
                                                            x-bind:class="{
                                                              'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-emerald-100': results[item.id]?.status === 'Satisfactory' && status === 'Satisfactory',
                                                              'bg-amber-50 border-amber-500 text-amber-700 shadow-amber-100': results[item.id]?.status === 'Monitor' && status === 'Monitor',
                                                              'bg-rose-50 border-rose-500 text-rose-700 shadow-rose-100': results[item.id]?.status === 'Defect' && status === 'Defect',
                                                              'bg-slate-50 border-transparent text-slate-400 grayscale opacity-40 scale-[0.98]': results[item.id]?.status && results[item.id]?.status !== status,
                                                              'bg-white border-slate-100 text-slate-500 hover:border-slate-300': !results[item.id]?.status
                                                            }"
                                                        >
                                                            <div class="w-1.5 h-1.5 rounded-full" x-bind:class="{
                                                                'bg-emerald-500': status === 'Satisfactory',
                                                                'bg-amber-500': status === 'Monitor',
                                                                'bg-rose-500': status === 'Defect'
                                                            }"></div>
                                                            <span x-text="status"></span>
                                                        </button>
                                                    </template>
                                                </div>

                                                {/* Observations Field */}
                                                <div class="relative group mb-8">
                                                    <textarea
                                                        x-model="results[item.id].notes"
                                                        {...{ 'x-on:input.debounce.500ms': 'saveLocally' }}
                                                        placeholder="Record clinical observations..."
                                                        class="w-full bg-slate-50/50 border-2 border-transparent rounded-[1.5rem] p-6 text-sm font-medium focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none min-h-[140px] transition-all placeholder:text-slate-300 leading-relaxed"
                                                    ></textarea>

                                                    {/* AI Synthesis Intelligence */}
                                                    <button
                                                        x-on:click="assistComment(item.id, item.label)"
                                                        class="absolute bottom-4 right-4 py-2 px-4 bg-white shadow-2xl shadow-indigo-200 text-indigo-600 rounded-2xl opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all border border-indigo-100 hover:bg-indigo-50 active:scale-95 flex items-center gap-2 ring-4 ring-white"
                                                        title="AI Professionalize"
                                                    >
                                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                                                        <span class="text-[10px] font-black uppercase tracking-widest">Synthesis</span>
                                                    </button>
                                                </div>

                                                {/* Multimedia Evidence Architecture */}
                                                <div class="space-y-6">
                                                    <div class="flex items-center gap-4">
                                                        <button
                                                            x-on:click={`$refs['file_input_' + item.id].click()`}
                                                            class="flex items-center gap-3 px-6 py-3 bg-indigo-600 text-white rounded-[1.25rem] text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all active:scale-95"
                                                            x-bind:disabled="uploading[item.id]"
                                                        >
                                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" x-show="!uploading[item.id]"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                                            <svg class="w-4 h-4 animate-spin text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" x-show="uploading[item.id]"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                                            <span x-text="uploading[item.id] ? 'Capturing...' : 'Capture Evidence'"></span>
                                                        </button>
                                                        <input
                                                            type="file"
                                                            {...{ 'x-bind:x-ref': `'file_input_' + item.id` }}
                                                            x-on:change="handleFileUpload(item.id, $event)"
                                                            accept="image/*"
                                                            capture="environment"
                                                            class="hidden"
                                                        />
                                                    </div>

                                                    {/* Optimized Horizontal Evidence Grid */}
                                                    <div class="flex gap-4 overflow-x-auto pb-4 pt-2 -mx-2 px-2 scrollbar-hide">
                                                        <template x-for="(photo, index) in (results[item.id].photos || [])" x-bind:key="photo.key">
                                                            <div class="relative flex-shrink-0 w-32 h-32 rounded-[2rem] overflow-hidden bg-slate-100 group shadow-2xl shadow-indigo-100/10 border-4 border-white">
                                                                <img x-bind:src="photo.pending && photo.dataUrl ? photo.dataUrl : '/api/inspections/files/' + photo.key" class="w-full h-full object-cover" />

                                                                {/* Photo Metadata Overlay */}
                                                                <div x-show="photo.pending" class="absolute inset-0 bg-amber-600/60 backdrop-blur-[2px] flex items-center justify-center">
                                                                    <span class="text-[9px] font-black uppercase tracking-[0.2em] text-white">Queued</span>
                                                                </div>

                                                                {/* Destructive Action Overlay */}
                                                                <button
                                                                    x-on:click="removePhoto(item.id, index)"
                                                                    class="absolute top-2 right-2 p-2 bg-rose-500 text-white rounded-2xl opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100 transition-all z-20 shadow-xl"
                                                                >
                                                                     <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                                                </button>

                                                                {/* Deep Analysis/Annotation Interactive Tier */}
                                                                <button
                                                                    x-on:click="!photo.pending && startAnnotation(item.id, photo.key, index)"
                                                                    x-bind:class="photo.pending ? 'cursor-not-allowed' : ''"
                                                                    class="absolute inset-0 bg-indigo-900/40 text-white flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 backdrop-blur-[4px] transition-all transform translate-y-4 group-hover:translate-y-0"
                                                                >
                                                                    <template x-if="!photo.pending">
                                                                        <div class="flex flex-col items-center justify-center px-4">
                                                                            <svg class="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                                                            <span class="text-[9px] font-black uppercase tracking-[0.15em] text-center leading-tight">Annotation Engine</span>
                                                                        </div>
                                                                    </template>
                                                                    <template x-if="photo.pending">
                                                                        <span class="text-[8px] font-black uppercase tracking-widest px-4 text-center">Awaiting Transmission</span>
                                                                    </template>
                                                                </button>
                                                            </div>
                                                        </template>
                                                    </div>
                                                </div>
                                            </div>
                                        </template>
                                    </div>
                                </div>
                            </div>
                        </template>
                    </div>

                    {/* Inspection Completion */}
                    <div class="mt-20 flex flex-col gap-8 pb-32">
                        <div x-show="!isDelivered && inspection?.status !== 'completed'">
                            <button
                                x-on:click="finishInspection"
                                class="premium-button w-full py-6 bg-slate-900 text-white rounded-[2.5rem] font-bold shadow-[0_35px_60px_-15px_rgba(0,0,0,0.3)] active:scale-95 transition-all hover:bg-black flex items-center justify-center gap-4 group"
                                x-bind:class="{ 'opacity-50 pointer-events-none': !isComplete }"
                                x-bind:disabled="syncing"
                            >
                                <span class="text-xl tracking-tightest" x-text="syncing ? 'Submitting...' : 'Complete Inspection'"></span>
                                <svg class="w-6 h-6 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" x-show="!syncing"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                <svg class="w-6 h-6 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" x-show="syncing"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                            </button>
                        </div>

                        <div x-show="isDelivered || inspection?.status === 'completed'" class="animate-slide-in">
                            <div class="glass-panel p-10 rounded-[2.5rem] text-center mb-8 border-emerald-100 shadow-2xl shadow-emerald-100/20 bg-emerald-50/10">
                                <div class="w-20 h-20 bg-emerald-500 rounded-3xl flex items-center justify-center mx-auto mb-6 text-white shadow-2xl shadow-emerald-200 group hover:rotate-6 transition-transform">
                                    <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                                </div>
                                <h3 class="text-3xl font-black tracking-tightest text-slate-900 mb-3">Inspection Complete</h3>
                                <p class="text-lg text-slate-500 font-medium max-w-md mx-auto">The inspection has been finalized and the report is ready for download.</p>
                            </div>
                            <a
                                x-bind:href={`'/api/inspections/' + inspectionId + '/report'`}
                                target="_blank"
                                class="premium-button w-full py-6 bg-indigo-600 text-white rounded-[2.5rem] font-bold shadow-2xl shadow-indigo-100 active:scale-95 transition-all hover:bg-indigo-700 flex items-center justify-center gap-4"
                            >
                                <span class="text-xl tracking-tightest">Review Certified Documentation</span>
                                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                            </a>
                        </div>

                        <button x-on:click="backToDashboard" class="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-indigo-600 transition-colors py-4">Return to Operational Control</button>
                    </div>

                    {/* Annotation Intelligence Interface */}
                    <div
                        x-show="showAnnotationModal"
                        {...{ 'x-transition:enter': 'transition ease-out duration-300' }}
                        {...{ 'x-transition:enter-start': 'opacity-0 scale-95' }}
                        {...{ 'x-transition:enter-end': 'opacity-100 scale-100' }}
                        x-cloak="true"
                        class="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-xl"
                    >
                        <div class="bg-white rounded-[3rem] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)] max-w-5xl w-full max-h-[92vh] overflow-hidden flex flex-col relative animate-slide-in">
                            {/* Modal High-End Header */}
                            <div class="px-12 py-8 border-b border-slate-50 flex justify-between items-center bg-slate-50/30">
                                <div>
                                    <h3 class="text-3xl font-black tracking-tightest text-slate-900">Annotation Studio</h3>
                                    <p class="text-sm text-slate-400 font-medium">Precision markup engine for evidence clarification</p>
                                </div>
                                <button x-on:click="showAnnotationModal = false" class="w-12 h-12 flex items-center justify-center rounded-2xl hover:bg-slate-100 text-slate-400 hover:text-slate-900 transition-all active:scale-95">
                                    <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                </button>
                            </div>

                            {/* Canvas Simulation Tier */}
                            <div class="flex-1 overflow-auto bg-slate-100 flex items-center justify-center relative shadow-inner">
                                <div class="relative bg-white shadow-2xl rounded-2xl overflow-hidden ring-8 ring-white">
                                    <canvas
                                        x-ref="annotationCanvas"
                                        x-on:mousedown="handleCanvasStart"
                                        x-on:mousemove="handleCanvasMove"
                                        x-on:mouseup="handleCanvasEnd"
                                        {...{ 'x-on:touchstart.passive': 'handleCanvasStart' }}
                                        {...{ 'x-on:touchmove.passive': 'handleCanvasMove' }}
                                        {...{ 'x-on:touchend.passive': 'handleCanvasEnd' }}
                                        class="cursor-crosshair touch-none max-w-full h-auto"
                                    ></canvas>
                                </div>
                            </div>

                            {/* Control Surface */}
                            <div class="px-12 py-10 bg-white space-y-8">
                                <div class="flex items-center justify-between">
                                    <div class="flex gap-4">
                                        <button
                                            x-on:click="drawingMode = 'circle'"
                                            class="flex items-center gap-3 px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm"
                                            x-bind:class="drawingMode === 'circle' ? 'bg-rose-500 text-white shadow-rose-200' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'"
                                        >
                                            <div class="w-3 h-3 rounded-full border-2 border-current"></div>
                                            Elliptical Highlight
                                        </button>
                                        <button
                                            x-on:click="drawingMode = 'arrow'"
                                            class="flex items-center gap-3 px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm"
                                            x-bind:class="drawingMode === 'arrow' ? 'bg-rose-500 text-white shadow-rose-200' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'"
                                        >
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3"></path></svg>
                                            Vector Pointer
                                        </button>
                                    </div>

                                    <button x-on:click="clearAnnotation" class="text-[10px] font-black text-slate-300 hover:text-rose-500 transition-colors uppercase tracking-[0.2em]">
                                        Clear Drawing Layer
                                    </button>
                                </div>

                                <div class="flex gap-6">
                                    <button
                                        x-on:click="showAnnotationModal = false"
                                        class="flex-1 py-5 rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 transition-all"
                                    >
                                        Discard Changes
                                    </button>
                                    <button
                                        x-on:click="saveAnnotation"
                                        class="flex-[2] premium-button py-5 bg-indigo-600 text-white rounded-[1.5rem] font-bold shadow-2xl shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center justify-center gap-3"
                                        x-bind:disabled="syncing"
                                    >
                                        <svg x-show="syncing" class="w-5 h-5 animate-spin text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                        <span class="tracking-tightest text-lg" x-text="syncing ? 'Saving...' : 'Save Markup'"></span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <script src="/js/modal-dialog.js"></script>
                <script src="/js/form-renderer.js"></script>
            </div>
        </BareLayout>
    );
};

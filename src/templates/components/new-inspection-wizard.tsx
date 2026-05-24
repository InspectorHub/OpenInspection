/**
 * Design System 0520 subsystem B phase 5 task 5.4 — NewInspectionWizard.
 *
 * 4-step modal replacing dashboard's single-step "New Inspection" form.
 * State + step validation lives in the standalone Alpine factory
 * window.newInspectionWizard() (public/js/new-inspection-wizard.js).
 *
 * Steps:
 *   1. Property — address + year built + sqft + property type
 *   2. Services — checkbox grid; at least one required
 *   3. Schedule — date + start time + duration minutes
 *   4. Team    — visible only when teamMode toggle is on; picks lead +
 *                helpers from the cached roster
 *
 * Submit → POST /api/inspections/wizard → redirect to /inspections/:id/edit.
 *
 * Entry: window.dispatchEvent(new CustomEvent('open-new-inspection-wizard'))
 * from dashboard "+ New Inspection" button.
 */

const STEP_LABELS: ReadonlyArray<string> = ['Property', 'Services', 'Schedule', 'Team'];
const SERVICE_CHOICES: ReadonlyArray<{ id: string; name: string }> = [
    { id: 'general',     name: 'General inspection' },
    { id: 'pool',        name: 'Pool + spa' },
    { id: 'sewer_scope', name: 'Sewer scope' },
    { id: 'mold',        name: 'Mold' },
    { id: 'radon',       name: 'Radon' },
    { id: 'termite',     name: 'WDO / termite' },
];

export function NewInspectionWizard(): JSX.Element {
    return (
        <div
            x-data="newInspectionWizard()"
            x-show="open"
            x-cloak
            style="display:none"
            class="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-6"
            role="dialog"
            aria-modal="true"
            aria-label="New inspection wizard"
        >
            <div class="ih-card max-w-2xl w-full max-h-[90vh] overflow-y-auto bg-white">
                {/* Step pills */}
                <nav class="flex border-b border-slate-200">
                    {STEP_LABELS.map((label, i) => (
                        <div
                            class="flex-1 px-4 py-3 text-center text-sm border-b-2"
                            x-bind:class={`step === ${i + 1} ? 'border-indigo-600 text-indigo-700 font-semibold bg-indigo-50' : (step > ${i + 1} ? 'border-emerald-500 text-emerald-700' : 'border-slate-200 text-slate-500')`}
                            key={label}
                        >
                            <div class="ih-eyebrow">Step {i + 1}</div>
                            <div class="mt-0.5">{label}</div>
                        </div>
                    ))}
                </nav>

                <div class="p-6 space-y-4">
                    {/* Step 1: Property */}
                    <div x-show="step === 1" class="space-y-4">
                        <label class="block">
                            <span class="ih-eyebrow block mb-1">Address</span>
                            <input
                                type="text"
                                class="ih-input w-full"
                                x-model="property.address"
                                placeholder="123 Main St, Anytown"
                                autocomplete="off"
                                aria-label="Property address"
                            />
                        </label>
                        <div class="grid grid-cols-2 gap-4">
                            <label class="block">
                                <span class="ih-eyebrow block mb-1">Year built</span>
                                <input
                                    type="number"
                                    min="1700"
                                    max="2100"
                                    class="ih-input w-full"
                                    {...{ 'x-model.number': 'property.yearBuilt' }}
                                />
                            </label>
                            <label class="block">
                                <span class="ih-eyebrow block mb-1">Sqft</span>
                                <input
                                    type="number"
                                    min="100"
                                    max="50000"
                                    class="ih-input w-full"
                                    {...{ 'x-model.number': 'property.sqft' }}
                                />
                            </label>
                        </div>
                        <label class="block">
                            <span class="ih-eyebrow block mb-1">Property type</span>
                            <select class="ih-input w-full" x-model="property.propertyType">
                                <option value="">— Select —</option>
                                <option value="single_family">Single family</option>
                                <option value="condo">Condo</option>
                                <option value="townhouse">Townhouse</option>
                                <option value="multi_family">Multi-family</option>
                                <option value="commercial">Commercial</option>
                            </select>
                        </label>
                        <div x-show="property.propertyType === 'commercial'" x-cloak class="mt-3">
                            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">Commercial subtype</label>
                            <select x-model="property.commercialSubtype" class="ih-input w-full">
                                <option value="">Select subtype...</option>
                                <option value="office">Office</option>
                                <option value="retail">Retail</option>
                                <option value="hospitality">Hospitality</option>
                                <option value="industrial">Industrial</option>
                                <option value="institutional">Institutional</option>
                                <option value="mixed-use">Mixed-use</option>
                            </select>
                        </div>
                    </div>

                    {/* Step 2: Services */}
                    <div x-show="step === 2" class="space-y-2">
                        <p class="ih-meta">Select at least one service.</p>
                        {SERVICE_CHOICES.map(s => (
                            <label class="flex items-center gap-2" key={s.id}>
                                <input
                                    type="checkbox"
                                    x-bind:value={`'${s.id}'`}
                                    x-model="services"
                                />
                                <span>{s.name}</span>
                            </label>
                        ))}
                    </div>

                    {/* Step 3: Schedule */}
                    <div x-show="step === 3" class="space-y-4">
                        <label class="block">
                            <span class="ih-eyebrow block mb-1">Date</span>
                            <input type="date" class="ih-input w-full" x-model="schedule.date" />
                        </label>
                        <div class="grid grid-cols-2 gap-4">
                            <label class="block">
                                <span class="ih-eyebrow block mb-1">Start time</span>
                                <input type="time" class="ih-input w-full" x-model="schedule.startTime" />
                            </label>
                            <label class="block">
                                <span class="ih-eyebrow block mb-1">Duration (minutes)</span>
                                <input
                                    type="number"
                                    min="30"
                                    max="720"
                                    step="15"
                                    class="ih-input w-full"
                                    {...{ 'x-model.number': 'schedule.durationMinutes' }}
                                />
                            </label>
                        </div>
                    </div>

                    {/* Step 4: Team */}
                    <div x-show="step === 4" class="space-y-4">
                        <label class="flex items-center gap-2">
                            <input type="checkbox" x-model="teamMode" />
                            <span>Make this a team inspection</span>
                        </label>
                        <div x-show="teamMode" class="space-y-3 pl-6 border-l-2 border-indigo-200">
                            <label class="block">
                                <span class="ih-eyebrow block mb-1">Lead inspector</span>
                                <select class="ih-input w-full" x-model="leadInspectorId">
                                    <option value="">— Select —</option>
                                    <template x-for="m in roster" x-bind:key="m.id">
                                        <option x-bind:value="m.id" x-text="m.name || m.email"></option>
                                    </template>
                                </select>
                            </label>
                            <div>
                                <span class="ih-eyebrow block mb-1">Helpers</span>
                                <template x-for="m in roster" x-bind:key="m.id">
                                    <label class="flex items-center gap-2">
                                        <input type="checkbox" x-bind:value="m.id" x-model="helperInspectorIds" />
                                        <span x-text="m.name || m.email"></span>
                                    </label>
                                </template>
                                <p class="ih-meta" x-show="roster.length === 0">No additional team members in this tenant yet.</p>
                            </div>
                        </div>
                    </div>
                </div>

                <footer class="px-6 py-4 border-t border-slate-200 flex justify-between">
                    <button type="button" class="ih-btn ih-btn--ghost" x-on:click="cancel()">Cancel</button>
                    <div class="flex gap-2">
                        <button type="button" class="ih-btn ih-btn--secondary" x-show="step > 1" x-on:click="step--">Back</button>
                        <button type="button" class="ih-btn ih-btn--primary" x-show="step < 4" x-on:click="next()">Next</button>
                        <button
                            type="button"
                            class="ih-btn ih-btn--primary"
                            x-show="step === 4"
                            x-on:click="submit()"
                            x-bind:disabled="submitting"
                        >
                            <span x-show="!submitting">Create</span>
                            <span x-show="submitting" style="display:none">Creating…</span>
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
}

/**
 * Gap 15 — PropertyInfoForm full-screen view.
 *
 * Shown when activeView === 'property' in the inspection editor.
 * Renders a 4-column grid of property metadata fields sourced from
 * the template's propertyMetadataFields array. Falls back to the
 * default 7-field set when the template has no preset.
 *
 * Alpine state lives on the parent inspectionEditor factory:
 *   inspection      — the inspection record (read/write)
 *   template        — the parsed TemplateSchemaV2
 *   propertyProgress() — { rated, total, percent }
 *   savePropertyField(key, value) — PATCH + sync
 */
import type { FC } from 'hono/jsx';

/** Default fields when the template defines no propertyMetadataFields. */
const DEFAULT_FIELDS = `[
  {id:"yearBuilt",label:"Year Built",type:"number",group:"Property facts"},
  {id:"sqft",label:"Sq Ft",type:"number",group:"Property facts"},
  {id:"foundationType",label:"Foundation",type:"select",group:"Property facts",options:["basement","slab","crawlspace","other"]},
  {id:"bedrooms",label:"Bedrooms",type:"number",group:"Property facts"},
  {id:"bathrooms",label:"Bathrooms",type:"number",group:"Property facts"},
  {id:"unit",label:"Unit",type:"text",group:"Property facts"},
  {id:"county",label:"County",type:"text",group:"Property facts"}
]`;

export const PropertyInfoForm: FC = () => (
    <div
        x-data={`{
            get metaFields() {
                return (this.template && this.template.propertyMetadataFields && this.template.propertyMetadataFields.length)
                    ? this.template.propertyMetadataFields
                    : ${DEFAULT_FIELDS};
            },
            get filled() {
                var c = 0;
                for (var f of this.metaFields) { if (this.inspection[f.id]) c++; }
                return c;
            },
            get groups() {
                var g = [], seen = {};
                for (var f of this.metaFields) {
                    var k = f.group || 'General';
                    if (!seen[k]) { seen[k] = true; g.push(k); }
                }
                return g;
            },
            fieldsByGroup(g) {
                return this.metaFields.filter(f => (f.group || 'General') === g);
            },
            save(field) {
                var val = this.inspection[field.id];
                if (typeof savePropertyField === 'function') { savePropertyField(field.id, val); return; }
                authFetch('/api/inspections/' + this.inspectionId, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ [field.id]: val ?? null })
                });
            }
        }`}
        class="px-6 py-6 max-w-5xl"
        data-testid="property-info-form"
    >
        {/* Eyebrow + status */}
        <header class="mb-6">
            <div class="flex items-center gap-2 mb-1">
                <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                    Property Info &middot; <span x-text="filled"></span> of <span x-text="metaFields.length"></span> fields complete
                </p>
                <span
                    x-show="filled === metaFields.length"
                    x-cloak
                    class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 ring-1 ring-inset ring-emerald-200 dark:ring-emerald-700"
                >Complete</span>
            </div>
            <h2
                class="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100"
                x-text="inspection.propertyAddress || 'Property Info'"
            ></h2>
        </header>

        {/* Grouped 4-column grid */}
        <template x-for="g in groups" {...{ 'x-bind:key': 'g' }}>
            <fieldset class="mb-6">
                <legend class="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 mb-2" x-text="g"></legend>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <template x-for="f in fieldsByGroup(g)" {...{ 'x-bind:key': 'f.id' }}>
                        <label class="block">
                            <span class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                <span x-text="f.label"></span>
                                <span
                                    x-show="inspection['_prefilled_' + f.id]"
                                    x-cloak
                                    class="text-[9px] font-semibold text-indigo-500 dark:text-indigo-400 normal-case tracking-normal"
                                >Prefilled</span>
                            </span>

                            {/* text / number / date */}
                            <template x-if="f.type === 'text' || f.type === 'number' || f.type === 'date'">
                                <input
                                    {...{ 'x-bind:type': 'f.type' }}
                                    {...{ 'x-model': 'inspection[f.id]' }}
                                    {...{ 'x-on:change': 'save(f)' }}
                                    {...{ 'x-bind:placeholder': "f.unit || '—'" }}
                                    class="ih-input mt-1 w-full"
                                />
                            </template>

                            {/* select */}
                            <template x-if="f.type === 'select'">
                                <select
                                    {...{ 'x-model': 'inspection[f.id]' }}
                                    {...{ 'x-on:change': 'save(f)' }}
                                    class="ih-input mt-1 w-full"
                                >
                                    <option value="">—</option>
                                    <template x-for="opt in (f.options || [])" {...{ 'x-bind:key': 'opt' }}>
                                        <option {...{ 'x-bind:value': 'opt' }} x-text="opt"></option>
                                    </template>
                                </select>
                            </template>

                            {/* boolean — checkbox style */}
                            <template x-if="f.type === 'boolean'">
                                <div class="mt-1 flex items-center h-10">
                                    <input
                                        type="checkbox"
                                        {...{ 'x-model': 'inspection[f.id]' }}
                                        {...{ 'x-on:change': 'save(f)' }}
                                        class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30"
                                    />
                                </div>
                            </template>
                        </label>
                    </template>
                </div>
            </fieldset>
        </template>
    </div>
);

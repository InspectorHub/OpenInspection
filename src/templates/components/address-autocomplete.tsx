/**
 * Sprint 1 Sub-spec C-5 — Public, keyboard-accessible address autocomplete
 * for the unauthenticated booking page.
 *
 * Server-side: queries `/api/public/geocode?q=…`. When the upstream provider
 * (Google Places) returns no results or the worker has no API key configured,
 * the endpoint replies with `{ data: [], reason: 'NO_API_KEY' }` and this
 * component degrades gracefully to a plain text input — no dropdown, no
 * error noise. The customer can still type a manual address and submit.
 *
 * Accessibility:
 *   * `role="listbox"` / `role="option"` with `aria-selected`
 *   * arrow up/down to move focus, Enter to select, Esc to close
 *   * `aria-controls` / `aria-expanded` reflect visibility
 *   * Hidden form fields expose parsed address parts (city/state/zip) so
 *     the booking handler can server-side validate.
 */
export interface AddressAutocompleteProps {
    name?:        string;
    placeholder?: string;
    required?:    boolean;
    initial?:     string;
}

export const AddressAutocomplete = ({
    name = 'address',
    placeholder = 'Start typing the property address',
    required = true,
    initial = '',
}: AddressAutocompleteProps): JSX.Element => {
    const escaped = initial.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return (
        <div x-data={`addressAutocomplete('${escaped}')`} class="relative">
            <label class="block">
                <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Site address</span>
                <input
                    type="text"
                    name={name}
                    x-model="value"
                    {...{
                        'x-on:input.debounce.250ms': 'search()',
                        'x-on:focus':                'if (value && results.length === 0) search()',
                        'x-on:keydown.arrow-down.prevent': 'moveFocus(1)',
                        'x-on:keydown.arrow-up.prevent':   'moveFocus(-1)',
                        'x-on:keydown.enter.prevent':      'selectFocused()',
                        'x-on:keydown.escape':             'results = []',
                        'x-bind:aria-expanded':            'results.length > 0',
                    }}
                    placeholder={placeholder}
                    required={required}
                    autocomplete="off"
                    class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-[14px] font-medium transition-colors"
                    aria-autocomplete="list"
                    aria-controls="address-listbox"
                />
            </label>

            <ul
                x-show="results.length > 0"
                style="display:none"
                {...{
                    'x-transition:enter':       'ease-out duration-150',
                    'x-transition:enter-start': 'opacity-0 -translate-y-1',
                    'x-transition:enter-end':   'opacity-100 translate-y-0',
                }}
                id="address-listbox"
                role="listbox"
                class="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-md bg-white border border-slate-200 shadow-lg"
            >
                <template
                    x-for="(r, idx) in results"
                    {...{ 'x-bind:key': 'r.placeId + idx' }}
                >
                    <li
                        role="option"
                        {...{
                            'x-bind:aria-selected': 'idx === focusIdx',
                            'x-on:click':           'select(r)',
                            'x-on:mouseenter':      'focusIdx = idx',
                            'x-bind:class':         "idx === focusIdx ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700'",
                        }}
                        class="px-3 py-2 text-[13px] cursor-pointer transition-colors"
                    >
                        <span x-text="r.label"></span>
                    </li>
                </template>
            </ul>

            {/* Hidden fields for form submit — populated when user selects
                a suggestion. Empty when the user types a free-form address
                (fallback / NO_API_KEY case) — server treats them as hints. */}
            <input type="hidden" name="addressCity"  {...{ 'x-bind:value': "selected?.city || ''" }} />
            <input type="hidden" name="addressState" {...{ 'x-bind:value': "selected?.state || ''" }} />
            <input type="hidden" name="addressZip"   {...{ 'x-bind:value': "selected?.zip || ''" }} />
            <input type="hidden" name="addressPlaceId" {...{ 'x-bind:value': "selected?.placeId || ''" }} />
        </div>
    );
};

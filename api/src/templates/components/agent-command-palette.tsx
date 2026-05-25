/**
 * Agent ⌘K Command Palette — UC-A-6 (quick property lookup).
 *
 * Mounted on every authenticated agent surface (agent-dashboard,
 * agent-inspectors, agent-settings/profile). Scoped to the agent's
 * mental model — Pages (jump nav) + Actions (sign out, copy booking
 * link per linked inspector).
 *
 * This palette is intentionally **vanilla Alpine** (x-data is a JSON
 * literal, no Alpine.data() factory required) so it can drop into the
 * agent's standalone HTML pages without depending on the inspector's
 * registered `commandPalette` factory. The page only needs Alpine 3
 * loaded (we add the script reference next to <AgentCommandPalette/>).
 *
 * Keyboard:
 *   - meta+k OR ctrl+/  toggles open
 *   - Esc                closes
 *   - ↑↓                 navigates
 *   - Enter              activates highlighted item
 *
 * Accepts pre-rendered items so the server emits a single chunk of JSON
 * with the full search index — no client-side data fetching needed.
 */
export interface AgentCommandPaletteInspector {
    name: string | null;
    slug: string | null;
    tenantSubdomain: string;
}

export interface AgentCommandPaletteProps {
    inspectors: AgentCommandPaletteInspector[];
    agentSlug: string | null;
    /**
     * Host the agent dashboard is served on. Combined with each inspector's
     * `tenantSubdomain` as `https://${bookingHost}/book/${tenantSubdomain}/${slug}`
     * (path-tenant URL shape introduced by PR 2).
     */
    bookingHost: string;
}

interface PaletteItem {
    id: string;
    group: 'Pages' | 'Actions';
    label: string;
    hint?: string;
    /** href for navigation items */
    href?: string;
    /** action key for non-navigation items (signout, copy) */
    action?: 'signout' | 'copy';
    /** clipboard payload for copy actions */
    payload?: string;
}

function buildItems(props: AgentCommandPaletteProps): PaletteItem[] {
    const items: PaletteItem[] = [
        { id: 'page-dashboard',  group: 'Pages',   label: 'Dashboard',  hint: 'G then D', href: '/agent-dashboard' },
        { id: 'page-inspectors', group: 'Pages',   label: 'Inspectors', hint: 'G then I', href: '/agent-inspectors' },
        { id: 'page-settings',   group: 'Pages',   label: 'Settings',   hint: 'G then S', href: '/agent-settings/profile' },
        { id: 'action-signout',  group: 'Actions', label: 'Sign out',   hint: 'log out',  action: 'signout' },
    ];
    const ref = props.agentSlug ? `?ref=${encodeURIComponent(props.agentSlug)}` : '';
    for (const insp of props.inspectors) {
        if (!insp.slug) continue;
        const url = `https://${props.bookingHost}/book/${insp.tenantSubdomain}/${insp.slug}${ref}`;
        const displayName = insp.name?.trim() || insp.slug;
        items.push({
            id: `copy-${insp.tenantSubdomain}-${insp.slug}`,
            group: 'Actions',
            label: `Copy booking link — ${displayName}`,
            hint: 'copy',
            action: 'copy',
            payload: url,
        });
    }
    return items;
}

export const AgentCommandPalette = (props: AgentCommandPaletteProps): JSX.Element => {
    const items = buildItems(props);
    // x-data is a JSON literal — Alpine accepts JSON-as-expression. We
    // include a small set of inline methods via `init` won't work for
    // pure-JSON, so the keyboard + click handlers run inline expressions
    // that reference the reactive state. The `visible()` getter recomputes
    // the filtered list each access; cheap because the list is small (~20
    // items even for a busy agent).
    const xData = JSON.stringify({
        open: false,
        query: '',
        highlighted: 0,
        items,
    });

    // The activate expression runs when an item is clicked or Enter is
    // pressed. Kept as a single inline string so we don't need a registered
    // factory — vanilla x-data only.
    const activateExpr =
        "if (!item) return; " +
        "if (item.href) { window.location.href = item.href; return; } " +
        "if (item.action === 'signout') { fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {}).then(() => { window.location.href = '/login'; }); return; } " +
        "if (item.action === 'copy' && item.payload) { if (navigator.clipboard) { navigator.clipboard.writeText(item.payload).then(() => { window.dispatchEvent(new CustomEvent('agent-cmdk-toast', { detail: 'Copied ' + item.payload })); }).catch(() => {}); } open = false; return; }";

    // visible() helper — recomputed inline. Returns items matching query.
    const visibleExpr = "items.filter(i => !query || (i.label || '').toLowerCase().includes(query.toLowerCase()))";

    return (
        <div
            x-data={xData}
            {...{
                'x-on:keydown.window': "const k = $event.key; const meta = $event.metaKey || $event.ctrlKey; if (meta && k === 'k') { open = !open; if (open) { query = ''; highlighted = 0; $nextTick(() => $refs.queryInput?.focus()); } $event.preventDefault(); } else if (meta && k === '/') { open = !open; if (open) { query = ''; highlighted = 0; $nextTick(() => $refs.queryInput?.focus()); } $event.preventDefault(); }",
                'x-on:keydown.escape.window': 'if (open) { open = false; $event.stopPropagation(); }',
                'x-cloak': '',
            }}
            x-show="open"
            class="agent-cmdk-root"
            style="display:none"
            role="dialog"
            aria-modal="true"
            aria-label="Agent command palette"
            data-testid="agent-command-palette"
        >
            <style dangerouslySetInnerHTML={{ __html: `
                .agent-cmdk-root {
                    position: fixed; inset: 0; z-index: 10000;
                    display: flex; align-items: flex-start; justify-content: center;
                    padding: 12vh 1rem 1rem;
                }
                .agent-cmdk-backdrop {
                    position: absolute; inset: 0;
                    background: rgba(28, 25, 23, 0.5);
                    backdrop-filter: blur(4px);
                    -webkit-backdrop-filter: blur(4px);
                }
                .agent-cmdk-shell {
                    position: relative;
                    width: 100%; max-width: 36rem;
                    background: #ffffff;
                    border: 1px solid #e7e5e4;
                    border-radius: 1rem;
                    box-shadow: 0 24px 48px -12px rgba(0,0,0,0.25);
                    display: flex; flex-direction: column;
                    overflow: hidden;
                    max-height: 70vh;
                    font-family: 'DM Sans', system-ui, sans-serif;
                }
                .agent-cmdk-header {
                    display: flex; align-items: center; gap: 0.75rem;
                    padding: 1rem 1.25rem;
                    border-bottom: 1px solid #f5f5f4;
                }
                .agent-cmdk-header-title {
                    font-family: 'Fraunces', serif;
                    font-weight: 700;
                    font-size: 1.125rem;
                    letter-spacing: -0.01em;
                    color: #1c1917;
                    margin-right: auto;
                }
                .agent-cmdk-esc {
                    font-size: 0.6875rem;
                    color: #78716c;
                    padding: 0.25rem 0.5rem;
                    border: 1px solid #e7e5e4;
                    border-radius: 6px;
                    font-family: ui-monospace, 'SF Mono', monospace;
                }
                .agent-cmdk-search {
                    display: flex; align-items: center; gap: 0.625rem;
                    padding: 0.625rem 1.25rem 0.875rem;
                    border-bottom: 1px solid #f5f5f4;
                }
                .agent-cmdk-search input {
                    flex: 1;
                    border: 0; outline: 0; background: transparent;
                    font-family: inherit;
                    font-size: 0.9375rem;
                    color: #1c1917;
                    padding: 0.25rem 0;
                }
                .agent-cmdk-search input::placeholder { color: #a8a29e; }
                .agent-cmdk-search-icon {
                    width: 1.125rem; height: 1.125rem;
                    color: #a8a29e; flex-shrink: 0;
                }
                .agent-cmdk-results {
                    flex: 1; overflow-y: auto;
                    padding-bottom: 0.5rem;
                }
                .agent-cmdk-group-label {
                    padding: 0.75rem 1.25rem 0.375rem;
                    font-size: 0.6875rem;
                    font-weight: 700;
                    letter-spacing: 0.18em;
                    text-transform: uppercase;
                    color: #a8a29e;
                }
                .agent-cmdk-empty {
                    padding: 2.5rem 1.25rem;
                    text-align: center;
                    color: #78716c;
                    font-size: 0.875rem;
                }
                .agent-cmdk-item {
                    display: flex; align-items: center; gap: 0.75rem;
                    width: 100%;
                    padding: 0.625rem 1.25rem;
                    background: transparent;
                    border: 0;
                    text-align: left;
                    cursor: pointer;
                    font-family: inherit;
                    font-size: 0.9375rem;
                    color: #1c1917;
                    transition: background 0.1s;
                }
                .agent-cmdk-item-label { flex: 1; min-width: 0; }
                .agent-cmdk-item-hint {
                    font-size: 0.6875rem;
                    color: #a8a29e;
                    text-transform: uppercase;
                    letter-spacing: 0.12em;
                    font-weight: 600;
                }
                .agent-cmdk-item.is-active {
                    background: var(--primary-soft, rgba(79,70,229,0.08));
                    color: var(--primary, #4f46e5);
                }
                .agent-cmdk-item.is-active .agent-cmdk-item-hint {
                    color: var(--primary, #4f46e5);
                }
                .agent-cmdk-footer {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 0.625rem 1.25rem;
                    border-top: 1px solid #f5f5f4;
                    background: #fafaf9;
                    font-size: 0.6875rem;
                    color: #78716c;
                    letter-spacing: 0.04em;
                }
                .agent-cmdk-footer kbd {
                    background: #ffffff;
                    border: 1px solid #e7e5e4;
                    border-radius: 4px;
                    padding: 0.125rem 0.375rem;
                    font-family: ui-monospace, 'SF Mono', monospace;
                    font-size: 0.625rem;
                    color: #1c1917;
                    margin: 0 0.125rem;
                }
                .agent-cmdk-toast {
                    position: fixed;
                    bottom: 1.5rem; left: 50%;
                    transform: translateX(-50%);
                    background: #1c1917;
                    color: #ffffff;
                    padding: 0.625rem 1rem;
                    border-radius: 999px;
                    font-family: 'DM Sans', system-ui, sans-serif;
                    font-size: 0.8125rem;
                    box-shadow: 0 8px 24px -8px rgba(0,0,0,0.4);
                    z-index: 10001;
                }
                html[data-color-scheme="dark"] .agent-cmdk-backdrop { background: rgba(0,0,0,0.55); }
                html[data-color-scheme="dark"] .agent-cmdk-shell { background: #1e293b; border-color: rgba(255,255,255,0.10); box-shadow: 0 24px 48px -12px rgba(0,0,0,0.5); }
                html[data-color-scheme="dark"] .agent-cmdk-header { border-bottom-color: rgba(255,255,255,0.06); }
                html[data-color-scheme="dark"] .agent-cmdk-header-title { color: #f1f5f9; }
                html[data-color-scheme="dark"] .agent-cmdk-esc { color: #94a3b8; border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.03); }
                html[data-color-scheme="dark"] .agent-cmdk-search { border-bottom-color: rgba(255,255,255,0.06); }
                html[data-color-scheme="dark"] .agent-cmdk-search input { color: #f1f5f9; }
                html[data-color-scheme="dark"] .agent-cmdk-search input::placeholder { color: #64748b; }
                html[data-color-scheme="dark"] .agent-cmdk-search-icon { color: #64748b; }
                html[data-color-scheme="dark"] .agent-cmdk-group-label { color: #64748b; }
                html[data-color-scheme="dark"] .agent-cmdk-empty { color: #94a3b8; }
                html[data-color-scheme="dark"] .agent-cmdk-item { color: #e2e8f0; }
                html[data-color-scheme="dark"] .agent-cmdk-item-hint { color: #64748b; }
                html[data-color-scheme="dark"] .agent-cmdk-footer { background: rgba(255,255,255,0.02); border-top-color: rgba(255,255,255,0.06); color: #94a3b8; }
                html[data-color-scheme="dark"] .agent-cmdk-footer kbd { background: #162032; border-color: rgba(255,255,255,0.10); color: #cbd5e1; }
                html[data-color-scheme="dark"] .agent-cmdk-toast { background: #f1f5f9; color: #0f172a; }
            ` }} />

            {/* Backdrop */}
            <div
                class="agent-cmdk-backdrop"
                x-on:click="open = false"
                x-transition:enter="ease-out duration-150"
                x-transition:enter-start="opacity-0"
                x-transition:enter-end="opacity-100"
            />

            {/* Shell */}
            <div
                class="agent-cmdk-shell"
                x-transition:enter="ease-out duration-150"
                x-transition:enter-start="opacity-0"
                x-transition:enter-end="opacity-100"
            >
                <div class="agent-cmdk-header">
                    <span class="agent-cmdk-header-title">Quick search</span>
                    <span class="agent-cmdk-esc">Esc to close</span>
                </div>

                <div class="agent-cmdk-search">
                    <svg class="agent-cmdk-search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M16.5 10.5a6 6 0 11-12 0 6 6 0 0112 0z"></path></svg>
                    <input
                        x-ref="queryInput"
                        x-model="query"
                        x-on:input="highlighted = 0"
                        {...{
                            'x-on:keydown.down.prevent':  `const v = ${visibleExpr}; if (v.length) highlighted = (highlighted + 1) % v.length;`,
                            'x-on:keydown.up.prevent':    `const v = ${visibleExpr}; if (v.length) highlighted = (highlighted - 1 + v.length) % v.length;`,
                            'x-on:keydown.enter.prevent': `const v = ${visibleExpr}; const item = v[highlighted]; ${activateExpr}`,
                        }}
                        type="text"
                        autocomplete="off"
                        spellcheck={false}
                        placeholder="Jump to a page or run a quick action…"
                    />
                </div>

                <div class="agent-cmdk-results">
                    <template x-if={`${visibleExpr}.length === 0`}>
                        <div class="agent-cmdk-empty">No matches.</div>
                    </template>

                    {/* Pages group */}
                    <template x-if={`${visibleExpr}.some(i => i.group === 'Pages')`}>
                        <div>
                            <div class="agent-cmdk-group-label">Pages</div>
                            <template
                                x-for={`(item, vi) in ${visibleExpr}`}
                                {...{ 'x-bind:key': 'item.id' }}
                            >
                                <template x-if="item.group === 'Pages'">
                                    <button
                                        type="button"
                                        {...{
                                            'x-bind:class': "highlighted === vi ? 'agent-cmdk-item is-active' : 'agent-cmdk-item'",
                                            'x-bind:data-testid': "'agent-cmdk-item-' + item.id",
                                        }}
                                        x-on:mouseenter="highlighted = vi"
                                        x-on:click={activateExpr}
                                    >
                                        <span class="agent-cmdk-item-label" x-text="item.label"></span>
                                        <span class="agent-cmdk-item-hint" x-show="item.hint" x-text="item.hint"></span>
                                    </button>
                                </template>
                            </template>
                        </div>
                    </template>

                    {/* Actions group */}
                    <template x-if={`${visibleExpr}.some(i => i.group === 'Actions')`}>
                        <div>
                            <div class="agent-cmdk-group-label">Actions</div>
                            <template
                                x-for={`(item, vi) in ${visibleExpr}`}
                                {...{ 'x-bind:key': 'item.id' }}
                            >
                                <template x-if="item.group === 'Actions'">
                                    <button
                                        type="button"
                                        {...{
                                            'x-bind:class': "highlighted === vi ? 'agent-cmdk-item is-active' : 'agent-cmdk-item'",
                                            'x-bind:data-testid': "'agent-cmdk-item-' + item.id",
                                        }}
                                        x-on:mouseenter="highlighted = vi"
                                        x-on:click={activateExpr}
                                    >
                                        <span class="agent-cmdk-item-label" x-text="item.label"></span>
                                        <span class="agent-cmdk-item-hint" x-show="item.hint" x-text="item.hint"></span>
                                    </button>
                                </template>
                            </template>
                        </div>
                    </template>
                </div>

                <div class="agent-cmdk-footer">
                    <span><kbd>↑</kbd><kbd>↓</kbd> navigate · <kbd>⏎</kbd> open · <kbd>⌘K</kbd> toggle</span>
                    <span>{props.inspectors.length} {props.inspectors.length === 1 ? 'inspector' : 'inspectors'}</span>
                </div>
            </div>

            {/* Toast for copy confirmation. Lives outside the shell so it
                renders even after the palette closes. */}
            <div
                {...{
                    'x-data': '{ msg: "", show: false, timer: null }',
                    'x-on:agent-cmdk-toast.window': 'msg = $event.detail; show = true; if (timer) clearTimeout(timer); timer = setTimeout(() => { show = false; }, 1800);',
                }}
                x-show="show"
                class="agent-cmdk-toast"
                style="display:none"
                x-text="msg"
            ></div>
        </div>
    );
};

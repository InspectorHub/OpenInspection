// ⌘K Command Palette data — handoff-decisions §3.
//
// Sources merged into a single ranked list:
//   - Top-level pages + Settings sub-pages (always-on, instant)
//   - Recent inspections (lazy-loaded once)
//   - Contacts (search hits /api/contacts on every keystroke, debounced)
//   - Comment-library snippets (lazy-loaded once)
//   - Create actions (always-on)
//
// Prefix filters:
//   ">" → actions only
//   "@" → people only (contacts)
//
// Keyboard:
//   ↑↓ navigates, Enter activates, Esc closes (window-level).
//
// Requires Alpine + same-origin auth cookie (uses authFetch from auth.js).

(function () {
    'use strict';

    // ───────── Static sources ─────────

    const ICONS = {
        page: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>',
        gear:    '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>',
        plus:    '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>',
        person:  '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>',
        clip:    '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>',
        chat:    '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-4 4v-4z"/></svg>',
    };

    const PAGES = [
        { label: 'Inspections',    href: '/dashboard',       hint: 'G then I' },
        { label: 'Reports',        href: '/reports',         hint: 'G then R' },
        { label: 'Templates',      href: '/templates',       hint: 'G then T' },
        { label: 'Marketplace',    href: '/marketplace' },
        { label: 'Agreements',     href: '/agreements' },
        { label: 'Comments',       href: '/comments' },
        { label: 'Recommendations',href: '/recommendations' },
        { label: 'Contacts',       href: '/contacts',        hint: 'G then C' },
        { label: 'Calendar',       href: '/calendar' },
        { label: 'Invoices',       href: '/invoices' },
        { label: 'Team',           href: '/team' },
        { label: 'Metrics',        href: '/metrics' },
        { label: 'Notifications',  href: '/notifications' },
    ];

    const SETTINGS_PAGES = [
        { label: 'Settings',                       href: '/settings' },
        { label: 'Settings · Profile',             href: '/settings/profile' },
        { label: 'Settings · Branding',            href: '/settings/workspace/branding' },
        { label: 'Settings · Report Theme',        href: '/settings/workspace/theme' },
        { label: 'Settings · Telemetry',           href: '/settings/workspace/telemetry' },
        { label: 'Settings · Services & Pricing',  href: '/settings/catalog/services' },
        { label: 'Settings · Event Types',         href: '/settings/catalog/event-types' },
        { label: 'Settings · Embed Widget',        href: '/settings/catalog/widget' },
        { label: 'Settings · Email',               href: '/settings/communication/email' },
        { label: 'Settings · Automations',         href: '/settings/communication/automations' },
        { label: 'Settings · Attention Rules',     href: '/settings/communication/automations#attention-rules' },
        { label: 'Settings · Apple Calendar',      href: '/settings/communication/calendar' },
        { label: 'Settings · Integrations',        href: '/settings/communication/integrations' },
        { label: 'Settings · Change Password',     href: '/settings/account/password' },
        { label: 'Settings · Two-factor (2FA)',    href: '/settings/account/security' },
        { label: 'Settings · Bot Protection',      href: '/settings/account/bot-protection' },
        { label: 'Settings · Payments',            href: '/settings/advanced/payments' },
        { label: 'Settings · AI',                  href: '/settings/advanced/ai' },
        { label: 'Settings · Data Import / Export',href: '/settings/advanced/data' },
    ];

    const ACTIONS = [
        { label: 'New inspection',  hint: 'create', run: () => { window.location.href = '/dashboard?new=1'; } },
        { label: 'New template',    hint: 'create', run: () => { window.location.href = '/templates?new=1'; } },
        { label: 'New contact',     hint: 'create', run: () => { window.location.href = '/contacts?new=1'; } },
        { label: 'New comment snippet', hint: 'create', run: () => { window.location.href = '/comments?new=1'; } },
        { label: 'Sign out',        hint: 'action', run: () => { document.getElementById('logoutBtn')?.click(); } },
    ];

    // ───────── Fuzzy ranking ─────────
    // Subsequence match with bonus for prefix and word-boundary hits.
    function score(label, query) {
        if (!query) return 1;
        const l = label.toLowerCase();
        const q = query.toLowerCase();
        if (l === q) return 1000;
        if (l.startsWith(q)) return 500 + (q.length / l.length) * 100;
        const idx = l.indexOf(q);
        if (idx >= 0) return 200 + (q.length / l.length) * 100 - idx;
        // Subsequence fallback
        let li = 0, qi = 0, hits = 0;
        while (li < l.length && qi < q.length) {
            if (l[li] === q[qi]) { hits++; qi++; }
            li++;
        }
        return qi === q.length ? hits : -1;
    }

    function fmtAddress(insp) {
        const parts = [insp.address1, insp.city, insp.state].filter(Boolean);
        return parts.join(', ') || (insp.id ? `Inspection #${String(insp.id).slice(0, 6)}` : 'Inspection');
    }

    function register() {
        if (!window.Alpine) return;
        Alpine.data('commandPalette', () => ({
            open: false,
            loading: false,
            query: '',
            highlighted: 0,
            // lazy-loaded sources
            _recentInspections: null,
            _snippets: null,
            // contacts is keystroke-driven, no cache
            _contacts: [],
            _contactsTimer: null,
            // grouped output (computed on demand)
            groups: [],

            init() {
                // Build initial groups synchronously so the empty state shows
                // page + action results.
                this.recompute();
                this.$watch('query', () => this.onQueryChange());
                this.$watch('open', (v) => {
                    if (v) {
                        this.query = '';
                        this.highlighted = 0;
                        this.recompute();
                        this.lazyLoad();
                    }
                });
            },

            async lazyLoad() {
                if (this._recentInspections === null) {
                    this._recentInspections = [];
                    try {
                        const r = await authFetch('/api/inspections?pageSize=10');
                        if (r.ok) {
                            const j = await r.json();
                            this._recentInspections = (j?.data || []).slice(0, 10);
                            this.recompute();
                        }
                    } catch {}
                }
                if (this._snippets === null) {
                    this._snippets = [];
                    try {
                        const r = await authFetch('/api/admin/comments');
                        if (r.ok) {
                            const j = await r.json();
                            this._snippets = (j?.data?.comments || []).slice(0, 50);
                            this.recompute();
                        }
                    } catch {}
                }
            },

            onQueryChange() {
                this.recompute();
                this.maybeSearchContacts();
            },

            maybeSearchContacts() {
                const q = this.query.replace(/^@\s*/, '').trim();
                if (q.length < 2) {
                    this._contacts = [];
                    this.recompute();
                    return;
                }
                if (this._contactsTimer) clearTimeout(this._contactsTimer);
                this._contactsTimer = setTimeout(async () => {
                    try {
                        const r = await authFetch('/api/contacts?search=' + encodeURIComponent(q) + '&limit=10');
                        if (r.ok) {
                            const j = await r.json();
                            this._contacts = (j?.data?.contacts || []).slice(0, 10);
                            this.recompute();
                        }
                    } catch {}
                }, 150);
            },

            recompute() {
                const raw = this.query.trim();
                const isActions = raw.startsWith('>');
                const isPeople = raw.startsWith('@');
                const q = raw.replace(/^[>@]\s*/, '');

                const out = [];

                const collect = (label, items, build) => {
                    const ranked = items
                        .map((src) => {
                            const item = build(src);
                            const s = score(item.label, q);
                            return s < 0 ? null : { ...item, _score: s };
                        })
                        .filter(Boolean)
                        .sort((a, b) => b._score - a._score)
                        .slice(0, 8);
                    if (ranked.length) out.push({ label, items: ranked });
                };

                if (isActions) {
                    collect('Actions', ACTIONS, (a) => ({
                        kind: 'action',
                        label: a.label,
                        hint: a.hint,
                        iconHtml: ICONS.plus,
                        run: a.run,
                    }));
                } else if (isPeople) {
                    collect('People', this._contacts, (c) => ({
                        kind: 'contact',
                        label: c.name + (c.email ? ' · ' + c.email : ''),
                        hint: c.type,
                        iconHtml: ICONS.person,
                        run: () => { window.location.href = '/contacts?id=' + encodeURIComponent(c.id); },
                    }));
                } else {
                    collect('Pages', PAGES, (p) => ({
                        kind: 'page',
                        label: p.label,
                        hint: p.hint || '',
                        iconHtml: ICONS.page,
                        run: () => { window.location.href = p.href; },
                    }));

                    collect('Recent inspections', this._recentInspections || [], (i) => ({
                        kind: 'inspection',
                        label: fmtAddress(i),
                        hint: i.status || '',
                        iconHtml: ICONS.clip,
                        run: () => { window.location.href = '/inspections/' + i.id + '/edit'; },
                    }));

                    collect('People', this._contacts, (c) => ({
                        kind: 'contact',
                        label: c.name + (c.email ? ' · ' + c.email : ''),
                        hint: c.type,
                        iconHtml: ICONS.person,
                        run: () => { window.location.href = '/contacts?id=' + encodeURIComponent(c.id); },
                    }));

                    collect('Comment snippets', this._snippets || [], (s) => ({
                        kind: 'snippet',
                        label: s.text || s.title || '(snippet)',
                        hint: s.section || '',
                        iconHtml: ICONS.chat,
                        // Snippets aren't directly addressable — jump to the library page.
                        run: () => { window.location.href = '/comments?id=' + encodeURIComponent(s.id); },
                    }));

                    collect('Settings', SETTINGS_PAGES, (p) => ({
                        kind: 'settings',
                        label: p.label,
                        hint: '',
                        iconHtml: ICONS.gear,
                        run: () => { window.location.href = p.href; },
                    }));

                    collect('Actions', ACTIONS, (a) => ({
                        kind: 'action',
                        label: a.label,
                        hint: a.hint,
                        iconHtml: ICONS.plus,
                        run: a.run,
                    }));
                }

                // Sort groups by their best item score so the most relevant
                // group surfaces first (e.g. "attention" → Settings before
                // Comment snippets even though comment snippets were collected
                // earlier). Empty query keeps original order.
                if (q) {
                    out.sort((a, b) => {
                        const aBest = a.items[0]?._score ?? 0;
                        const bBest = b.items[0]?._score ?? 0;
                        return bBest - aBest;
                    });
                }

                // Re-index all items into a flat highlight order.
                let n = 0;
                for (const g of out) {
                    for (const it of g.items) {
                        it._idx = n++;
                        // Stable id so x-for can key.
                        it.id = it.kind + ':' + it._idx + ':' + it.label;
                    }
                }
                this.groups = out;
                if (this.highlighted >= n) this.highlighted = 0;
            },

            flatItems() {
                const out = [];
                for (const g of this.groups) for (const it of g.items) out.push(it);
                return out;
            },

            setHighlight(i) { this.highlighted = i; },

            onKeydown(e) {
                const flat = this.flatItems();
                if (e.key === 'ArrowDown') {
                    this.highlighted = Math.min(this.highlighted + 1, flat.length - 1);
                    e.preventDefault();
                } else if (e.key === 'ArrowUp') {
                    this.highlighted = Math.max(this.highlighted - 1, 0);
                    e.preventDefault();
                } else if (e.key === 'Enter') {
                    const item = flat[this.highlighted];
                    if (item) { this.run(item); e.preventDefault(); }
                }
            },

            run(item) {
                this.open = false;
                if (typeof item.run === 'function') {
                    setTimeout(() => item.run(), 0);
                }
            },
        }));
    }

    // The script may load before or after Alpine starts (defer ordering),
    // so cover both paths.
    if (window.Alpine) register();
    else document.addEventListener('alpine:init', register);
})();

// public/js/inspection-edit.js
// Requires auth.js to be loaded first (provides authFetch)

// Older templates were saved before rating-level descriptions were a field.
// Backfill on the client by matching id+label against known presets so the
// onboarding cards (T6) and rating-button tooltips (T5) show usable copy
// instead of an empty trailing dash.
var FALLBACK_LEVEL_DESCRIPTIONS = {
  S:   'Item is functioning as intended; no concerns observed.',
  Sat: 'Item is functioning as intended; no concerns observed.',
  Satisfactory: 'Item is functioning as intended; no concerns observed.',
  M:   'Item is functional but shows wear; recommend periodic re-inspection.',
  Mon: 'Item is functional but shows wear; recommend periodic re-inspection.',
  Monitor: 'Item is functional but shows wear; recommend periodic re-inspection.',
  D:   'Item is broken, deteriorated, or unsafe; recommend repair or replacement.',
  Defect: 'Item is broken, deteriorated, or unsafe; recommend repair or replacement.',
  Defective: 'Item is not functioning as intended; repair or replacement is recommended.',
  Deficient: 'Item shows deficiencies that warrant repair, replacement, or further evaluation.',
  NI:  'Item could not be inspected (inaccessible, unsafe, or excluded).',
  'Not Inspected': 'Item could not be inspected (inaccessible, unsafe, or excluded).',
  NP:  'Item is not present at this property.',
  'Not Present': 'Item is not present at this property.',
  I:   'Item was inspected and meets the Standards of Practice.',
  Inspected: 'Item was inspected and meets the Standards of Practice.',
  INR: 'Item is functioning but requires repair to remain in serviceable condition.',
  F:   'Item visually inspected and observed to be in serviceable, functional condition.',
  Functional: 'Item visually inspected and observed to be in serviceable, functional condition.',
  LM:  'Item requires routine maintenance to preserve serviceability.',
  Mar: 'Item is functioning but approaching end of useful life or showing notable wear.',
  Marginal: 'Item is functioning but approaching end of useful life or showing notable wear.',
  H:   'Item presents an immediate safety hazard and should be addressed without delay.',
  Hazardous: 'Item presents an immediate safety hazard and should be addressed without delay.',
};

function backfillLevelDescriptions(levels) {
  if (!Array.isArray(levels)) return [];
  return levels.map(function(lvl) {
    if (!lvl || lvl.description) return lvl;
    var fb = FALLBACK_LEVEL_DESCRIPTIONS[lvl.id] ||
             FALLBACK_LEVEL_DESCRIPTIONS[lvl.abbreviation] ||
             FALLBACK_LEVEL_DESCRIPTIONS[lvl.label] || '';
    return Object.assign({}, lvl, fb ? { description: fb } : {});
  });
}

function inspectionEditor(inspectionId) {
  // Design System 0520 subsystem D phase 2 task 2.2 — expose the
  // inspection id on a global the UnitTree factory reads so it knows
  // which /api/inspections/:id/units to hit.
  window.__inspectionEditorRoot = { inspectionId };

  return {
    inspectionId: inspectionId,
    inspection: {},
    sections: [],
    ratingLevels: [],
    results: {},
    expanded: {},
    activeItemId: null,
    currentSectionIdx: 0,
    // Design's PropertyInfo-as-section: which view fills the centre
    // pane. 'items' = the regular item list for currentSectionIdx;
    // 'property' = the property-facts form. The section rail's first
    // row (`__property__`) toggles between them.
    activeView: 'items',
    // Design's SideRail tabs (Preview / Library / Recall). The 280 px
    // right rail used to be a single "active item preview" surface;
    // now the tab strip lets the inspector flip to the canned comment
    // library or prior-inspection recall without leaving the editor.
    sideRailMode: 'preview',
    sideRailLibQuery: '',
    // Design System 0520 subsystem D P2.2 — when the inspector picks a
    // unit in the UnitTree left rail, the tree broadcasts
    // `unit-selected` on window and this state mirrors the active unit
    // id. Item-render templates can read `visibleItems` (computed
    // below) to scope what's shown.
    selectedUnitId: null,
    // Spec 5G M1.1 — view modes (⌘1=split, ⌘2=focus, ⌘3=preview)
    viewMode: 'split',
    // Spec 5G M2 — Comment Library slide-out
    showCommentLibrary: false,
    commentLibraryFilter: 'all', // 'all' | 'satisfactory' | 'monitor' | 'defect' | 'my-snippets'
    commentLibrarySearch: '',
    commentLibrarySelectedIdx: 0,
    // GS prefix — set true after pressing G; next digit jumps to that section,
    // or pressing S opens a fuzzy section picker (Sprint 1 A-9).
    gPrefix: false,
    gPrefixTimer: null,
    // Sprint 1 A-9: section picker popover state
    sectionPickerOpen: false,
    sectionPickerQuery: '',
    sectionPickerIdx: 0,
    batchMode: false,
    batchSelected: {},
    // Design-aligned item filter row — All / Unrated / Issues / Flagged.
    // Drives `itemPassesFilter()` which the centre-pane card grid
    // consults alongside the search filter so the two filters compose.
    itemFilter: 'all',
    showMenu: false,
    showPublishModal: false,
    publishing: false,
    // Design System 0520 subsystem E P1.4 — pre-flight gate. The
    // PreflightChecks component broadcasts `preflight-status` on every
    // load/refresh; the Send All button reads this flag to disable
    // until all 5 gates pass.
    preflightAllPassed: false,
    sendingPdf: false,
    isDesktop: window.innerWidth >= 1024,
    // Sprint 3 S3-4 — drawer state for the 1024-1279 tablet zone. The
    // persistent right ACTIVE ITEM pane only renders at xl (≥1280); on a
    // tablet the inspector taps the "Inspector" button in the toolbar to
    // slide this drawer in. Defaults closed; auto-closes when the viewport
    // grows past xl (no need for the drawer + persistent pane to coexist).
    tabletInspectorOpen: false,
    saveTimer: null,
    saveState: 'idle',
    // Round 32 — one-time mobile gesture-discovery hint for R23 swipe nav
    swipeHintDismissed: (function () {
      try { return localStorage.getItem('oi:swipeHint') === 'dismissed'; } catch (_) { return false; }
    })(),
    // Round 33 — mobile gesture stack (long-press / double-tap) + Cheatsheet HUD
    _itemTouch: null,        // { itemId, startX, startY, startTime }
    _itemLpTimer: null,      // long-press timer handle
    _itemLastTap: null,      // { itemId, time } for double-tap detection
    quickRatingItemId: null, // when long-press fires, target item id
    showQuickRating: false,  // bottom-sheet visibility
    showCheatsheet: false,   // ? HUD visibility (mobile menu button + desktop ?)
    // Sprint 3 S3-3 — T-key tag picker state. `tagsLibrary` holds all tenant
    // tags (lazy-loaded once via loadTagsIfNeeded). `tagsByItem` is a map
    // of itemId → Tag[] hydrated by the bulk /api/inspections/:id/tags
    // endpoint when the editor mounts. The picker popover toggles via
    // `tagPickerOpen`; `tagPickerItemId` is the active target.
    tagsLibrary: [],
    tagsLibraryLoaded: false,
    tagsByItem: {},
    tagPickerOpen: false,
    tagPickerItemId: null,
    tagPickerQuery: '',
    tagSavingId: null, // tag id currently being toggled (loading indicator)
    slashPickerOpen: false,  // slash-trigger inline popover state — used to
                             // hide the right ACTIVE ITEM pane while open
                             // (avoids duplicate canned-comment list).
    _reportStats: { total: 0, satisfactory: 0, monitor: 0, defect: 0 },
    aiSuggestions: [],
    aiTargetField: null,
    showAiPopover: false,
    // Competitor parity App.E.3 (Spectora) — top-right "Search entire report…"
    // input. Empty string = match all (no filter applied). The search helpers
    // below scan section.title, item.label, and free-text fields in
    // results[item.id] (notes / canned / custom comments).
    searchQuery: '',
    // Spec 2026-05-07 — user snippets fetched from /api/admin/comments
    // (the same data source as the /comments page). Lets MY SNIPPETS show
    // bucket-classified user comments, so /comments + Library drawer agree.
    // Keeps localStorage-only snippets as a fallback (offline / older saves).
    _userSnippets: [],

    // Design System 0520 M10 — SpeedMode state (subsystem A, phase 3).
    // Full-screen single-item rating overlay. See components/speed-mode.tsx.
    speedMode: false,
    speedQueue: [],     // flat indices into the materialised items list (see _flatItems)
    speedCurrent: 0,

    // Design System 0520 M15 — InspectorTools FAB dock (subsystem A, phase 5).
    // Right-bottom floating action button consolidating mouse entry points
    // for speed mode / burst camera / photo studio / keyboard cheatsheet.
    dockOpen: false,

    publishOptions: {
      theme: 'modern',
      notifyClient: true,
      notifyAgent: true,
      requireSignature: false,
      requirePayment: false,
      // Round-2 F1 — radio: 'report' (default) or 'agreement'.
      payload: 'report',
      // Design System 0520 subsystem D P9 — free-text "what changed in vN+1"
      // shown only when republishing (publishedVersion > 0).
      summary: '',
    },

    // Design System 0520 subsystem D P9 — version awareness for Republish UX.
    // Updated lazily by refreshPublishedVersion() — called on init() and again
    // after a successful publish so the next modal open shows the new vN.
    publishedVersion: 0,

    // Round-2 F1 — multi-recipient Publish modal state.
    showLegacyPublishOptions: false,
    loadingRecipients: false,
    recipients: [],

    async init() {
      // Tell global KeyboardHUD (keyboard-hud.tsx) not to fire on ? — this
      // page has its own richer cheatsheet covering both desktop hotkeys and
      // mobile gestures. Without this flag both HUDs would open at once.
      //
      // BUG #27 — the flag also has to be CLEARED when the inspector
      // navigates away. The app does full-page nav (no SPA), so pagehide /
      // beforeunload reliably runs once before the next page mounts. Without
      // the cleanup the global HUD on /dashboard, /calendar, etc. stayed
      // permanently dead for the rest of the session — `?` looked unbound on
      // every page after the first editor visit.
      window.__oiLocalCheatsheet = true;
      const clearLocalCheatsheet = () => { window.__oiLocalCheatsheet = false; };
      window.addEventListener('pagehide', clearLocalCheatsheet, { once: true });
      window.addEventListener('beforeunload', clearLocalCheatsheet, { once: true });

      // Design System 0520 subsystem E P1.4 — pre-flight gate. The
      // PreflightChecks panel inside publish-modal broadcasts its
      // `allPassed` boolean on every load/refresh so the Send All
      // button can read this Alpine state mirror.
      window.addEventListener('preflight-status', (e) => {
        this.preflightAllPassed = !!(e?.detail?.allPassed);
      });

      // Design System 0520 subsystem D P2.2 — mirror the UnitTree
      // selection into Alpine state. The tree component fires this
      // event on every click; null means "show all units / no scope".
      window.addEventListener('unit-selected', (e) => {
        this.selectedUnitId = (e?.detail?.unitId) ?? null;
      });

      // Design System 0520 subsystem D phase 9 — fetch existing version count
      // so the publish-modal renders "Republish vN+1" when the inspection has
      // been published before.
      this.refreshPublishedVersion();

      // Slash-trigger inline popover sync — hide ACTIVE ITEM right pane while
      // the picker is open so the same canned comments are not rendered twice.
      window.addEventListener('oi:slash-picker', (e) => {
        this.slashPickerOpen = !!(e && e.detail && e.detail.open);
      });

      window.addEventListener('resize', () => {
        this.isDesktop = window.innerWidth >= 1024;
        // Sprint 3 S3-4 — auto-close the tablet drawer when the viewport
        // grows past xl (≥1280). At that width the persistent right pane
        // takes over; keeping the drawer open would double-render its
        // content over top of the persistent pane.
        if (window.innerWidth >= 1280 && this.tabletInspectorOpen) {
          this.tabletInspectorOpen = false;
        }
      });

      // Spec 5G M1.1 mobile — horizontal swipe between sections (analog of
      // desktop ↑↓ keyboard nav). Mobile-only: skip on desktop (lg+).
      // Detection: horizontal distance > 50px, vertical < 40px, time < 500ms,
      // and started outside form fields. Avoids conflict with vertical scroll.
      var swipeStart = null;
      window.addEventListener('touchstart', (e) => {
        if (this.isDesktop) return;
        var t = (e.target && e.target.tagName) || '';
        if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || t === 'BUTTON') return;
        if (e.target && e.target.closest && e.target.closest('button, input, textarea, [data-no-swipe]')) return;
        if (!e.touches || e.touches.length !== 1) return;
        swipeStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
      }, { passive: true });
      window.addEventListener('touchend', (e) => {
        if (!swipeStart || this.isDesktop) return;
        var endTouch = e.changedTouches && e.changedTouches[0];
        if (!endTouch) { swipeStart = null; return; }
        var dx = endTouch.clientX - swipeStart.x;
        var dy = endTouch.clientY - swipeStart.y;
        var dt = Date.now() - swipeStart.t;
        swipeStart = null;
        if (dt > 500) return;
        if (Math.abs(dy) > 40) return;
        if (Math.abs(dx) < 50) return;
        if (dx < 0 && this.currentSectionIdx < this.sections.length - 1) {
          // swipe left → next section
          this.currentSectionIdx += 1;
          var nextItems = this.currentSectionItems || [];
          if (nextItems.length) this.activeItemId = nextItems[0].id;
          if (typeof showToast === 'function') showToast('Section: ' + (this.currentSection?.title || ''));
          this.dismissSwipeHint();
        } else if (dx > 0 && this.currentSectionIdx > 0) {
          // swipe right → previous section
          this.currentSectionIdx -= 1;
          var prevItems = this.currentSectionItems || [];
          if (prevItems.length) this.activeItemId = prevItems[0].id;
          if (typeof showToast === 'function') showToast('Section: ' + (this.currentSection?.title || ''));
          this.dismissSwipeHint();
        }
      }, { passive: true });

      // Spec 5G M1.1 — Rating hotkeys (1=Sat, 2=Mon, 3=Defect, 0=Clear, N=N/A)
      // Skip when typing in form fields. Operates on the active (last
      // interacted) item, falling back to the first item in current section.
      window.addEventListener('keydown', (e) => {
        var inField = (function () {
          var t = (document.activeElement && document.activeElement.tagName) || '';
          if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return true;
          if (document.activeElement && document.activeElement.isContentEditable) return true;
          return false;
        })();
        var meta = e.metaKey || e.ctrlKey;
        // Meta-prefixed hotkeys work even when typing in fields
        if (meta) {
          // ⌘S = save now
          if (e.key === 's' || e.key === 'S') {
            e.preventDefault();
            this.saveResults();
            if (typeof showToast === 'function') showToast('Saved');
            return;
          }
          // ⌘⇧P = publish modal
          if ((e.key === 'p' || e.key === 'P') && e.shiftKey) {
            e.preventDefault();
            this.showPublishModal = true;
            return;
          }
          // ⌘D = save current notes as snippet
          if (e.key === 'd' || e.key === 'D') {
            e.preventDefault();
            this.saveCurrentAsSnippet();
            return;
          }
          // ⌘⏎ inside Library = insert + extra newline
          if (e.key === 'Enter' && this.showCommentLibrary) {
            e.preventDefault();
            var items = this.commentLibraryItems;
            var sel = items[this.commentLibrarySelectedIdx];
            if (sel) this.insertComment(sel.text, true);
            return;
          }
          // ⌘1 = split, ⌘2 = focus, ⌘3 = preview
          if (e.key === '1') { e.preventDefault(); this.setViewMode('split'); return; }
          if (e.key === '2') { e.preventDefault(); this.setViewMode('focus'); return; }
          if (e.key === '3') { e.preventDefault(); this.setViewMode('preview'); return; }
          // ⌘K = command palette (stub for now)
          if (e.key === 'k' || e.key === 'K') {
            e.preventDefault();
            if (typeof showToast === 'function') showToast('Command palette coming soon');
            return;
          }
          return;
        }
        // Design System 0520 M10 — SpeedMode hotkeys (subsystem A, phase 3).
        // `Z` toggles overlay. While speedMode === true, intercept 1..5 (rate
        // + auto-advance), Tab/Arrow (nav), Enter (open editor), Esc (exit).
        if ((e.key === 'z' || e.key === 'Z') && !inField) {
          e.preventDefault();
          this.toggleSpeedMode();
          return;
        }
        if (this.speedMode) {
          if (e.key >= '1' && e.key <= '5') {
            e.preventDefault();
            var sVals = ['sat', 'monitor', 'defect', 'ni', 'np'];
            this.speedRate(sVals[parseInt(e.key, 10) - 1]);
            return;
          }
          if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); this.speedSkip(); return; }
          if (e.key === 'Tab' && e.shiftKey)  { e.preventDefault(); this.speedPrev(); return; }
          if (e.key === 'ArrowRight') { e.preventDefault(); this.speedSkip(); return; }
          if (e.key === 'ArrowLeft')  { e.preventDefault(); this.speedPrev(); return; }
          if (e.key === 'Enter')      { e.preventDefault(); this.speedOpenEditor(); return; }
          if (e.key === 'Escape')     { e.preventDefault(); this.speedMode = false; return; }
        }
        // When Comment Library drawer is open, intercept nav + insert keys
        if (this.showCommentLibrary) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            var dnItems = this.commentLibraryItems;
            this.commentLibrarySelectedIdx = Math.min(this.commentLibrarySelectedIdx + 1, dnItems.length - 1);
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.commentLibrarySelectedIdx = Math.max(this.commentLibrarySelectedIdx - 1, 0);
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            var enItems = this.commentLibraryItems;
            var enSel = enItems[this.commentLibrarySelectedIdx];
            if (enSel) this.insertComment(enSel.text, false);
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            this.showCommentLibrary = false;
            return;
          }
          // Allow typing in search input — fall through to inField guard
        }
        if (e.altKey) return;
        if (inField) {
          // Esc inside a field still closes Comment Library if open
          if (e.key === 'Escape' && this.showCommentLibrary) {
            this.showCommentLibrary = false;
          }
          return;
        }
        // Esc closes Comment Library
        if (e.key === 'Escape' && this.showCommentLibrary) {
          e.preventDefault();
          this.showCommentLibrary = false;
          return;
        }
        // GS prefix — G then 0-9 jumps to that section by index, or G then S
        // opens the fuzzy section picker (Sprint 1 A-9).
        if (this.gPrefix && /^[0-9]$/.test(e.key)) {
          e.preventDefault();
          this.gPrefix = false;
          clearTimeout(this.gPrefixTimer);
          this.gotoSection(parseInt(e.key, 10));
          return;
        }
        if (this.gPrefix && (e.key === 's' || e.key === 'S')) {
          e.preventDefault();
          this.gPrefix = false;
          clearTimeout(this.gPrefixTimer);
          this.openSectionPicker();
          return;
        }
        if (e.key === 'g' || e.key === 'G') {
          e.preventDefault();
          this.gPrefix = true;
          if (typeof showToast === 'function') showToast('G then S = picker · G then 0–9 = jump');
          clearTimeout(this.gPrefixTimer);
          this.gPrefixTimer = setTimeout(() => { this.gPrefix = false; }, 1500);
          return;
        }
        // ? = toggle Cheatsheet HUD (Round 33)
        if (e.key === '?') {
          e.preventDefault();
          this.toggleCheatsheet();
          return;
        }
        // / = open Comment Library (auto-filter by item rating)
        if (e.key === '/') {
          e.preventDefault();
          this.openCommentLibrary();
          return;
        }
        // ; = open Comment Library on My snippets filter
        if (e.key === ';') {
          e.preventDefault();
          this.openCommentLibrary('my-snippets');
          return;
        }
        // T = open tag picker for the active item (Sprint 3 S3-3).
        // The picker is an Alpine popover registered alongside this editor;
        // we drive it via the shared `tagPicker*` state on this same scope.
        if (e.key === 't' || e.key === 'T') {
          e.preventDefault();
          if (!this.activeItemId) {
            if (typeof showToast === 'function') showToast('Select an item first to add a tag');
            return;
          }
          this.openTagPicker(this.activeItemId);
          return;
        }
        // Navigation: ArrowUp / ArrowDown move active item up/down,
        // J / K Vim-style aliases (Design 0520 M11.2),
        // Enter advances to next, Shift+Enter goes to previous.
        if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'J' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault();
          this.navigateItem(1);
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'k' || (e.key === 'Enter' && e.shiftKey)) {
          // Note: capital K is already used by an earlier handler (block toggle
          // around line 261). Only lowercase k aliases ArrowUp to avoid a clash.
          e.preventDefault();
          this.navigateItem(-1);
          return;
        }
        // R = repeat the previous item's rating + notes (Design 0520 M11.1).
        // "Previous" = the nearest earlier item in the current section that
        // already carries a rating, so an inspector can chain similar items
        // without re-typing. Skips if no prior item has a rating yet.
        if (e.key === 'r' || e.key === 'R') {
          e.preventDefault();
          if (!this.activeItem) {
            if (typeof showToast === 'function') showToast('Select an item first to repeat the previous rating');
            return;
          }
          var section = (this.template?.sections || []).find(s => (s.items || []).some(it => it.id === this.activeItem.id));
          var sectionItems = section ? section.items : (this.template?.sections?.[0]?.items || []);
          var activeIdx = sectionItems.findIndex(it => it.id === this.activeItem.id);
          var prior = null;
          for (var pi = activeIdx - 1; pi >= 0; pi--) {
            var candidate = sectionItems[pi];
            var res = this.results?.[candidate.id];
            if (res && res.ratingLevelId) { prior = { id: candidate.id, res: res }; break; }
          }
          if (!prior) {
            if (typeof showToast === 'function') showToast('No earlier rated item to repeat from');
            return;
          }
          // Copy rating + canned/custom comment payload to the active item.
          // Existing comments on the active item are replaced — `R` is the
          // explicit "clone above" gesture, not an accumulator.
          this.results[this.activeItem.id] = JSON.parse(JSON.stringify(prior.res));
          this.debounceSave();
          if (typeof showToast === 'function') showToast('Cloned rating + notes from previous item');
          return;
        }
        // P = add photo to active item (triggers global hidden file input)
        if (e.key === 'p' || e.key === 'P') {
          if (!this.activeItem) {
            if (typeof showToast === 'function') showToast('Select an item first to add a photo');
            e.preventDefault();
            return;
          }
          var photoInput = document.getElementById('hotkey-photo-input');
          if (photoInput) {
            e.preventDefault();
            photoInput.click();
          }
          return;
        }
        var key = e.key.toLowerCase();
        var idx = -1;
        // Sprint 1 A-8: extend 1-3 → 1-5 so rating levels 4 (Not Inspected)
        // and 5 (Not Present) are reachable from the keyboard.
        if (key === '1') idx = 0;
        else if (key === '2') idx = 1;
        else if (key === '3') idx = 2;
        else if (key === '4') idx = 3;
        else if (key === '5') idx = 4;
        else if (key === '0') idx = -2; // clear
        else if (key === 'n') idx = -3; // N/A — rating with abbreviation 'NA' or 'N/A'
        else return;
        var item = this.activeItem;
        if (!item) {
          if (typeof showToast === 'function') showToast('Expand an item first to use rating shortcuts');
          return;
        }
        var levelId = null;
        if (idx >= 0) {
          if (!this.ratingLevels[idx]) return;
          levelId = this.ratingLevels[idx].id;
        } else if (idx === -2) {
          levelId = null;
        } else if (idx === -3) {
          for (var i = 0; i < this.ratingLevels.length; i++) {
            var ab = (this.ratingLevels[i].abbreviation || '').toUpperCase();
            var nm = (this.ratingLevels[i].name || '').toLowerCase();
            if (ab === 'NA' || ab === 'N/A' || nm.indexOf('not applicable') >= 0) {
              levelId = this.ratingLevels[i].id;
              break;
            }
          }
          if (!levelId) return;
        }
        e.preventDefault();
        this.setRating(item.id, levelId);
        if (typeof showToast === 'function' && levelId) {
          var lvl = null;
          for (var j = 0; j < this.ratingLevels.length; j++) {
            if (this.ratingLevels[j].id === levelId) { lvl = this.ratingLevels[j]; break; }
          }
          showToast((lvl ? lvl.name : 'Rated') + ' → ' + (item.label || item.name));
        } else if (typeof showToast === 'function') {
          showToast('Cleared rating → ' + (item.label || item.name));
        }
      });
      // Phase T (T15): when annotator finishes saving, patch the local photo entry
      // so the thumbnail switches to the annotated key without a page reload.
      window.addEventListener('photo:annotated', (e) => {
        const { itemId, photoIndex, annotatedKey } = e.detail || {};
        if (!itemId || annotatedKey == null) return;
        const photos = this.results[itemId]?.photos;
        if (photos && photos[photoIndex]) {
          photos[photoIndex] = Object.assign({}, photos[photoIndex], { annotatedKey });
        }
      });
      // Spec 2026-05-07 — user snippets from the unified comments table.
      // Fire-and-forget: the drawer falls back to localStorage snippets if
      // this fails (e.g. offline reload).
      this.loadUserSnippets();

      await this.loadData();
    },

    async loadUserSnippets() {
      try {
        var res = await authFetch('/api/admin/comments');
        if (!res.ok) return;
        var json = await res.json();
        var rows = (json.data && json.data.comments) || [];
        // Map server schema to the in-memory snippet shape consumed by
        // _commentLibraryPool / commentLibraryItems. Use 'all' for the
        // null-bucket case so the seeded "All" filter still surfaces them.
        this._userSnippets = rows.map(function (r) {
          return {
            id: r.id,
            rating: r.ratingBucket || 'all',
            section: r.section || null,
            category: r.category || null,
            text: r.text,
            source: 'snippet',
          };
        });
      } catch (_) { /* non-fatal */ }
    },

    async loadData() {
      try {
        var inspRes = await authFetch('/api/inspections/' + this.inspectionId);
        if (inspRes.status === 401) { window.location.href = '/login'; return; }

        var inspJson = await inspRes.json();
        var rawInsp = inspJson.data?.inspection || {};
        // iter-1 production bug #3 — D1 booleans can transit as 0/1 ints
        // depending on the codepath (raw queries vs Drizzle mode:'boolean'
        // conversion). The Report Access toggles in the sidebar do
        // `inspection.paymentRequired ? on : off`, so a truthy `1` from a
        // raw query would show ON even when the gate (which uses
        // `=== true`) treats the same value as falsy and skips paywalling.
        // Force every gate-related flag to a strict boolean here so the
        // Alpine toggles and the server-side gate agree on the same shape.
        rawInsp.paymentRequired   = rawInsp.paymentRequired   === true || rawInsp.paymentRequired   === 1;
        rawInsp.agreementRequired = rawInsp.agreementRequired === true || rawInsp.agreementRequired === 1;
        this.inspection = rawInsp;

        // Try to load report-data (sections + rating levels)
        var dataRes = await authFetch('/api/inspections/' + this.inspectionId + '/report-data');
        if (dataRes.ok) {
          var dataJson = await dataRes.json();
          var newSections = (dataJson.data?.sections || []).map(function(sec) {
            var s = Object.assign({}, sec);
            if (!s.title && s.name) { s.title = s.name; }
            if (s.items && Array.isArray(s.items)) {
              s.items = s.items.map(function(item) {
                var it = Object.assign({}, item);
                if (!it.label && it.name) { it.label = it.name; }
                return it;
              });
            }
            return s;
          });
          // Pre-fill results stubs BEFORE assigning sections so Alpine
          // x-model bindings (e.g. results[item.id].notes) don't read
          // undefined while /results is still being fetched.
          for (var s = 0; s < newSections.length; s++) {
            var sec = newSections[s];
            for (var i = 0; i < sec.items.length; i++) {
              var item = sec.items[i];
              if (!this.results[item.id]) {
                this.results[item.id] = { rating: null, notes: '', photos: [] };
              }
            }
          }
          this.sections = newSections;
          this.ratingLevels = backfillLevelDescriptions(dataJson.data?.ratingLevels || []);
          this._reportStats = dataJson.data?.stats || this._reportStats;
          window.dispatchEvent(new CustomEvent('rating-levels-ready', { detail: this.ratingLevels }));
        }

        // Load existing results — merge into stubs so we preserve any
        // entries the stub-fill seeded above.
        var resultsRes = await authFetch('/api/inspections/' + this.inspectionId + '/results');
        if (resultsRes.ok) {
          var rJson = await resultsRes.json();
          var loaded = rJson.data?.data || {};
          for (var k in loaded) {
            if (Object.prototype.hasOwnProperty.call(loaded, k)) {
              this.results[k] = loaded[k];
            }
          }
        }

        // Sprint 3 S3-3 — hydrate tag chips alongside results so each item
        // card renders with its existing labels. Best-effort: a 4xx response
        // (rare — happens on unauthenticated edge cases) leaves the chips
        // empty, and the T-key picker re-fetches when first opened.
        try {
          var tagsRes = await authFetch('/api/inspections/' + this.inspectionId + '/tags');
          if (tagsRes.ok) {
            var tJson = await tagsRes.json();
            this.tagsByItem = (tJson && tJson.data) || {};
          }
        } catch (_) { /* swallow — picker will retry on open */ }
      } catch (e) {
        console.error('Failed to load inspection data:', e);
      }
    },

    async sendReportPdf() {
        this.sendingPdf = true;
        try {
            const res = await authFetch(`/api/inspections/${this.inspectionId}/send-report-pdf`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
            if (res.status === 401) { window.location.href = '/login'; return; }
            const data = await res.json();
            if (res.ok) {
                if (typeof showToast === 'function') showToast('Report PDF sent to ' + (data?.data?.sentTo || 'client'));
            } else {
                modalAlert(data?.error?.message || 'Failed to send report PDF', 'Error');
            }
        } catch (e) {
            modalAlert('Network error: ' + e.message, 'Error');
        } finally {
            this.sendingPdf = false;
        }
    },

    get formattedDate() {
      var d = this.inspection.date || this.inspection.scheduledDate || this.inspection.createdAt;
      if (!d) return '';
      try {
        return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      } catch { return d; }
    },

    get currentSection() {
      return this.sections[this.currentSectionIdx] || null;
    },

    get currentSectionItems() {
      return this.currentSection?.items || [];
    },

    get completionPercent() {
      var total = 0, completed = 0;
      for (var s = 0; s < this.sections.length; s++) {
        var items = this.sections[s].items;
        for (var i = 0; i < items.length; i++) {
          total++;
          var r = this.results[items[i].id];
          if (!r) continue;
          // rich items count when a rating is picked; non-rich item types
          // (boolean / number / text / textarea / date / select /
          // multi_select / photo_only) capture their value on res.value
          // and should also advance the progress bar.
          if (r.rating) { completed++; continue; }
          var v = r.value;
          if (v !== undefined && v !== null && v !== ''
              && !(Array.isArray(v) && v.length === 0)) {
            completed++;
          }
        }
      }
      return total > 0 ? Math.round((completed / total) * 100) : 0;
    },

    // Live-computed report summary used by the Publish modal "Report Summary"
    // chip and any UI that wants up-to-date counts. Original implementation
    // cached the server-side stats from inspection load and never recomputed
    // when the user clicked rating buttons — so the modal showed "0 monitors"
    // even when 2 items were rated MON. This getter recounts on every access
    // by walking the live `results` object against the active rating levels.
    // Kept `_reportStats` as a fallback when sections / ratingLevels haven't
    // arrived yet (initial paint).
    get reportStats() {
      if (!Array.isArray(this.sections) || this.sections.length === 0) {
        return this._reportStats;
      }
      var total        = 0;
      var rated        = 0;
      var satisfactory = 0;
      var monitor      = 0;
      var defect       = 0;
      for (var s = 0; s < this.sections.length; s++) {
        var items = this.sections[s].items || [];
        total += items.length;
        for (var i = 0; i < items.length; i++) {
          var ratingId = this.results[items[i].id]?.rating;
          if (!ratingId) continue;
          rated++;
          var bucket = this._bucketForRatingId(ratingId);
          if (bucket === 'satisfactory')   satisfactory++;
          else if (bucket === 'monitor')   monitor++;
          else if (bucket === 'defect')    defect++;
        }
      }
      return { total: total, rated: rated, satisfactory: satisfactory, monitor: monitor, defect: defect };
    },

    get selectedBatchCount() {
      var count = 0;
      var keys = Object.keys(this.batchSelected);
      for (var k = 0; k < keys.length; k++) {
        if (this.batchSelected[keys[k]]) count++;
      }
      return count;
    },

    selectSection(idx) {
      this.activeView        = 'items';
      this.currentSectionIdx = idx;
      this.batchMode         = false;
      this.batchSelected     = {};
    },

    /**
     * Design's Property Info as a virtual section — clicking the row in
     * the section rail swaps the centre pane from the item list to a
     * property facts form. Mirrors how the SectionRail in
     * InspectionEditor.jsx treats `__property__` as the first entry.
     */
    selectProperty() {
      this.activeView = 'property';
      // Don't clear currentSectionIdx — coming back from property view
      // should land the user in the section they were last in.
    },

    /**
     * Per-property-fact progress for the section rail's completion ring.
     * Same { rated, total, percent } shape as sectionProgress() so the
     * rail can render both with one template.
     */
    propertyProgress() {
      var fields = ['yearBuilt','sqft','foundationType','bedrooms','bathrooms','unit','county'];
      var insp = this.inspection || {};
      var filled = 0;
      for (var i = 0; i < fields.length; i++) {
        var v = insp[fields[i]];
        if (v !== null && v !== undefined && v !== '') filled++;
      }
      var total = fields.length;
      return { rated: filled, total: total, percent: Math.round(filled / total * 100) };
    },

    sectionDefectCount(sectionId) {
      var sec = null;
      for (var s = 0; s < this.sections.length; s++) {
        if (this.sections[s].id === sectionId) { sec = this.sections[s]; break; }
      }
      if (!sec) return 0;
      var count = 0;
      for (var i = 0; i < sec.items.length; i++) {
        var rating = this.results[sec.items[i].id]?.rating;
        if (!rating) continue;
        var level = null;
        for (var l = 0; l < this.ratingLevels.length; l++) {
          if (this.ratingLevels[l].id === rating) { level = this.ratingLevels[l]; break; }
        }
        if ((level && level.isDefect) || rating === 'Defect') count++;
      }
      return count;
    },

    /**
     * Per-section progress used by the SectionRail completion rings:
     * returns { rated, total, percent } for the named section.
     * Mirrors the shape that progress-strip-helpers.computeCompletion
     * exposes globally so the rail + the top strip read consistent
     * numbers (rounded half-up percent).
     */
    sectionProgress(sectionId) {
      var sec = null;
      for (var s = 0; s < this.sections.length; s++) {
        if (this.sections[s].id === sectionId) { sec = this.sections[s]; break; }
      }
      if (!sec) return { rated: 0, total: 0, percent: 0 };
      var total = sec.items.length;
      if (total === 0) return { rated: 0, total: 0, percent: 0 };
      var rated = 0;
      for (var i = 0; i < total; i++) {
        if (this.results[sec.items[i].id]?.rating != null) rated++;
      }
      return { rated: rated, total: total, percent: Math.round((rated / total) * 100) };
    },

    // Design-aligned filter predicate. Mirrors InspectionEditor.jsx
    // ItemList filters:
    //   all      — everything (no-op)
    //   unrated  — no rating yet (rich items only)
    //   issues   — rating maps to a defect/marginal severity
    //   flagged  — user-tagged via getItemTags (safety/photo/follow-up tags)
    itemPassesFilter(item) {
      var f = this.itemFilter || 'all';
      if (f === 'all') return true;
      var r = this.results[item.id];
      if (f === 'unrated') return !r || r.rating == null;
      if (f === 'issues') {
        if (!r || !r.rating) return false;
        var levels = (this.ratingLevels || []);
        for (var i = 0; i < levels.length; i++) {
          if (levels[i].id !== r.rating) continue;
          var sev = levels[i].severity;
          return levels[i].isDefect || sev === 'significant' || sev === 'marginal';
        }
        return false;
      }
      if (f === 'flagged') {
        var tags = (typeof this.getItemTags === 'function') ? this.getItemTags(item.id) : [];
        return Array.isArray(tags) && tags.length > 0;
      }
      return true;
    },

    // Counts for the filter row chips. Cheap to recompute each frame —
    // the page only renders a single section at a time so the loop is
    // bounded by section.items.length (typically <40).
    sectionFilterCounts() {
      var items = this.currentSectionItems || [];
      var counts = { all: items.length, unrated: 0, issues: 0, flagged: 0 };
      var prev = this.itemFilter;
      for (var i = 0; i < items.length; i++) {
        this.itemFilter = 'unrated'; if (this.itemPassesFilter(items[i])) counts.unrated++;
        this.itemFilter = 'issues';  if (this.itemPassesFilter(items[i])) counts.issues++;
        this.itemFilter = 'flagged'; if (this.itemPassesFilter(items[i])) counts.flagged++;
      }
      this.itemFilter = prev;
      return counts;
    },

    getItemRating(itemId) {
      return this.results[itemId]?.rating || null;
    },

    getItemNotes(itemId) {
      return this.results[itemId]?.notes || '';
    },

    // ===== Editor full-text search (App.E.3) =================================
    // Mirror of src/lib/editor-search.ts logic, kept inline here because
    // public/js/* is plain JS loaded by the browser (no bundler step). The
    // server-side TS file is the source of truth and carries the unit
    // tests; if you change matching behavior here, change it there too.

    _searchNeedle() {
      var q = this.searchQuery;
      if (!q) return '';
      return String(q).trim().toLowerCase();
    },

    _searchContains(haystack, needle) {
      if (!haystack) return false;
      return String(haystack).toLowerCase().indexOf(needle) !== -1;
    },

    _searchResultMatches(itemId, needle) {
      var r = this.results[itemId];
      if (!r) return false;
      if (this._searchContains(r.notes, needle)) return true;
      if (this._searchContains(r.recommendation, needle)) return true;
      var canned = r.cannedComments;
      if (canned) {
        var tabs = ['information', 'limitations', 'defects'];
        for (var t = 0; t < tabs.length; t++) {
          var list = canned[tabs[t]];
          if (!list) continue;
          for (var i = 0; i < list.length; i++) {
            var entry = list[i] || {};
            if (this._searchContains(entry.title, needle)) return true;
            if (this._searchContains(entry.comment, needle)) return true;
            if (this._searchContains(entry.effectiveComment, needle)) return true;
          }
        }
      }
      var custom = r.customComments;
      if (custom) {
        var ctabs = ['information', 'limitations', 'defects'];
        for (var ct = 0; ct < ctabs.length; ct++) {
          var clist = custom[ctabs[ct]];
          if (!clist) continue;
          for (var ci = 0; ci < clist.length; ci++) {
            var centry = clist[ci] || {};
            if (this._searchContains(centry.title, needle)) return true;
            if (this._searchContains(centry.comment, needle)) return true;
            if (this._searchContains(centry.location, needle)) return true;
          }
        }
      }
      return false;
    },

    /** True if the section's title matches OR any of its items matches. */
    sectionMatchesSearch(section) {
      var needle = this._searchNeedle();
      if (!needle) return true;
      if (!section) return false;
      if (this._searchContains(section.title, needle)) return true;
      var items = section.items || [];
      for (var i = 0; i < items.length; i++) {
        if (this.itemMatchesSearch(section, items[i])) return true;
      }
      return false;
    },

    /** True if section.title matches (whole section kept) OR
     *  item.label / its result row matches the query. */
    itemMatchesSearch(section, item) {
      var needle = this._searchNeedle();
      if (!needle) return true;
      if (!item) return false;
      if (section && this._searchContains(section.title, needle)) return true;
      if (this._searchContains(item.label, needle)) return true;
      return this._searchResultMatches(item.id, needle);
    },

    /** True when the user has typed something — used to swap "no results"
     *  empty-state messages and to show the clear (×) button. */
    get hasSearchQuery() {
      return this._searchNeedle() !== '';
    },

    /** Total number of items matching the current query across all sections.
     *  Drives the live "N matches" hint next to the search input. */
    get searchMatchCount() {
      var needle = this._searchNeedle();
      if (!needle) return 0;
      var count = 0;
      for (var s = 0; s < this.sections.length; s++) {
        var sec = this.sections[s];
        var items = sec.items || [];
        if (this._searchContains(sec.title, needle)) {
          count += items.length;
          continue;
        }
        for (var i = 0; i < items.length; i++) {
          if (this.itemMatchesSearch(sec, items[i])) count++;
        }
      }
      return count;
    },

    clearSearch() {
      this.searchQuery = '';
    },

    /** Wrap matched substrings inside `text` with <mark>. Result is
     *  HTML-escaped so it's safe to bind via x-html on a known item label
     *  / section title (no other HTML in those fields). */
    highlightSearchMatch(text) {
      var src = text == null ? '' : String(text);
      var safe = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      var needle = this._searchNeedle();
      if (!needle) return safe;
      var escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var re = new RegExp(escaped, 'gi');
      return safe.replace(re, function (m) { return '<mark>' + m + '</mark>'; });
    },

    getPhotoCount(itemId) {
      return (this.results[itemId]?.photos || []).length;
    },

    getRatingColor(ratingId) {
      if (!ratingId) return '#d4d4d8';
      for (var l = 0; l < this.ratingLevels.length; l++) {
        if (this.ratingLevels[l].id === ratingId) return this.ratingLevels[l].color;
      }
      var legacy = { Satisfactory: '#22c55e', Monitor: '#f59e0b', Defect: '#f43f5e' };
      return legacy[ratingId] || '#d4d4d8';
    },

    // Section icon SVG paths (same as template-editor)
    sectionIcons: {
      exterior:    '<path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0V15a1 1 0 011-1h2a1 1 0 011 1v3"/>',
      roof:        '<path stroke-linecap="round" stroke-linejoin="round" d="M12 3L2 12h3v8h14v-8h3L12 3zM7 20v-7h10v7"/>',
      electrical:  '<path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>',
      plumbing:    '<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v4m0 0a4 4 0 014 4v6a3 3 0 01-3 3h-2a3 3 0 01-3-3v-6a4 4 0 014-4z"/>',
      hvac:        '<path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>',
      interior:    '<path stroke-linecap="round" stroke-linejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 8h16v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zm2 0V9m12 4V9"/>',
      structural:  '<path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2M5 21H3m4-10h2m4 0h2m-8 4h2m4 0h2"/>',
      foundation:  '<path stroke-linecap="round" stroke-linejoin="round" d="M4 20h16M4 20V10l8-7 8 7v10M4 20h4v-4h8v4h4"/>',
      garage:      '<path stroke-linecap="round" stroke-linejoin="round" d="M3 21h18M3 10l9-7 9 7M5 10v11m14-11v11M8 14h8M8 17h8"/>',
      kitchen:     '<path stroke-linecap="round" stroke-linejoin="round" d="M15 11V4a1 1 0 10-2 0v7m2 0H9m4 0a2 2 0 11-4 0m0 0V4a1 1 0 10-2 0v7m14 4H3l1.5 6h15L21 15z"/>',
      bathroom:    '<path stroke-linecap="round" stroke-linejoin="round" d="M4 12h16M4 12V8a4 4 0 014-4h1m-5 8v4a4 4 0 004 4h8a4 4 0 004-4v-4M18 8a2 2 0 11-4 0"/>',
      fireplace:   '<path stroke-linecap="round" stroke-linejoin="round" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A8 8 0 0117.657 18.657zM9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z"/>',
      pool:        '<path stroke-linecap="round" stroke-linejoin="round" d="M3 17c1.5 0 2.5-1 4-1s2.5 1 4 1 2.5-1 4-1 2.5 1 4 1M3 21c1.5 0 2.5-1 4-1s2.5 1 4 1 2.5-1 4-1 2.5 1 4 1M5 3v10m14-10v10"/>',
      insulation:  '<path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>',
      appliances:  '<path stroke-linecap="round" stroke-linejoin="round" d="M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zm7 14a4 4 0 100-8 4 4 0 000 8zm0-6a2 2 0 110 4 2 2 0 010-4z"/>',
      attic:       '<path stroke-linecap="round" stroke-linejoin="round" d="M3 17l9-13 9 13M7 17v4h10v-4M10 17v4m4-4v4"/>',
      crawlspace:  '<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 6v4m16-4v4M4 10h16M4 10v4h16v-4M8 14v4m8-4v4M4 18h16"/>',
      safety:      '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>',
      landscape:   '<path stroke-linecap="round" stroke-linejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"/>',
    },

    getSectionIconSvg(iconKey, cls) {
      var size = cls || 'w-4 h-4';
      if (iconKey && this.sectionIcons[iconKey]) {
        return '<svg class="' + size + '" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">' + this.sectionIcons[iconKey] + '</svg>';
      }
      return '';
    },

    getRatingLabel(ratingId) {
      if (!ratingId) return '';
      for (var l = 0; l < this.ratingLevels.length; l++) {
        if (this.ratingLevels[l].id === ratingId) return this.ratingLevels[l].abbreviation;
      }
      return ratingId;
    },

    setRating(itemId, levelId) {
      if (!this.results[itemId]) this.results[itemId] = { rating: null, notes: '', photos: [] };
      this.results[itemId].rating = levelId;
      this._stampUnitId(itemId);
      this.debounceSave();
    },

    // Non-rich item types (boolean / number / text / textarea / date)
    // store their captured value here. Rich items continue to use `rating`
    // exclusively. Same debounced PATCH path as setRating.
    setItemValue(itemId, value) {
      if (!this.results[itemId]) this.results[itemId] = { rating: null, notes: '', photos: [] };
      this.results[itemId].value = value;
      this._stampUnitId(itemId);
      this.debounceSave();
    },

    // Design System 0520 subsystem D P3 — stamp the active unit id onto
    // newly-rated items. Once an item has a unitId we leave it alone so
    // moving a unit doesn't silently reattribute past findings; the
    // explicit unit-tree drag/move flow handles re-parenting deliberately.
    _stampUnitId(itemId) {
      if (this.selectedUnitId && !this.results[itemId].unitId) {
        this.results[itemId].unitId = this.selectedUnitId;
      }
    },
    getItemValue(itemId) {
      return this.results[itemId] && 'value' in this.results[itemId]
        ? this.results[itemId].value
        : '';
    },
    // multi_select helper — toggles `choice` in the value array.
    toggleMultiValue(itemId, choice, checked) {
      const cur = Array.isArray(this.getItemValue(itemId))
        ? this.getItemValue(itemId).slice()
        : [];
      const idx = cur.indexOf(choice);
      if (checked && idx === -1) cur.push(choice);
      else if (!checked && idx !== -1) cur.splice(idx, 1);
      this.setItemValue(itemId, cur);
    },
    // photo_only helper — reads the photos array from the per-item result.
    getItemPhotos(itemId) {
      const r = this.results[itemId];
      return r && Array.isArray(r.photos) ? r.photos : [];
    },

    // Spec 5B — Defect Model + Canned Comment Library (v2 schema).
    // Per-item state is { rating, notes, photos, tabs: { information,
    // limitations, defects } }. Tab arrays hold one entry per template
    // canned-comment id with { cannedId, included, comment? } and (defects
    // only) { category, location, photos }. We lazy-init missing nodes on
    // each toggle so Alpine reactivity stays clean.
    _ensureItemState(itemId) {
      if (!this.results[itemId]) this.results[itemId] = { rating: null, notes: '', photos: [] };
      if (!this.results[itemId].tabs) this.results[itemId].tabs = { information: [], limitations: [], defects: [] };
      var t = this.results[itemId].tabs;
      if (!Array.isArray(t.information)) t.information = [];
      if (!Array.isArray(t.limitations)) t.limitations = [];
      if (!Array.isArray(t.defects))     t.defects     = [];
      return this.results[itemId];
    },

    // Returns the merged view for one tab: each canned entry from the
    // template, augmented with `included` (toggle state) + `effectiveComment`
    // (override or template comment). Used by the editor panel.
    getTabEntries(itemId, tabName) {
      var item = this._findItemById(itemId);
      if (!item || !item.tabs) return [];
      var canned = (item.tabs[tabName] || []).slice();
      var state = (this.results[itemId] && this.results[itemId].tabs && this.results[itemId].tabs[tabName]) || [];
      var stateMap = {};
      for (var i = 0; i < state.length; i++) stateMap[state[i].cannedId] = state[i];
      return canned.map(function (c) {
        var s = stateMap[c.id];
        var included = s ? !!s.included : !!c.default;
        var override = (s && typeof s.comment === 'string' && s.comment.length > 0) ? s.comment : null;
        return {
          cannedId: c.id,
          title: c.title,
          comment: c.comment,
          effectiveComment: override !== null ? override : c.comment,
          included: included,
          // defect-only fields:
          category: (s && s.category) || c.category || null,
          location: (s && typeof s.location === 'string' && s.location.length > 0) ? s.location : (c.location || ''),
          photos: (s && Array.isArray(s.photos)) ? s.photos : [],
          // Sprint 2 S2-3 / S2-4 — per-defect contractor recommendation slug
          // and repair estimate range (cents). Null when blank so the editor
          // and report renderer can detect "no value" without ambiguity.
          recommendationId: (s && typeof s.recommendationId === 'string' && s.recommendationId.length > 0) ? s.recommendationId : null,
          estimateLow:      (s && typeof s.estimateLow  === 'number' && Number.isFinite(s.estimateLow))  ? s.estimateLow  : null,
          estimateHigh:     (s && typeof s.estimateHigh === 'number' && Number.isFinite(s.estimateHigh)) ? s.estimateHigh : null,
        };
      });
    },

    _findItemById(itemId) {
      for (var s = 0; s < this.sections.length; s++) {
        var items = this.sections[s].items || [];
        for (var i = 0; i < items.length; i++) {
          if (items[i].id === itemId) return items[i];
        }
      }
      return null;
    },

    _findStateEntry(itemId, tabName, cannedId) {
      var st = this._ensureItemState(itemId);
      var arr = st.tabs[tabName];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].cannedId === cannedId) return arr[i];
      }
      return null;
    },

    _upsertStateEntry(itemId, tabName, cannedId, patch) {
      var st = this._ensureItemState(itemId);
      var arr = st.tabs[tabName];
      var existing = null;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].cannedId === cannedId) { existing = arr[i]; break; }
      }
      if (existing) {
        Object.assign(existing, patch);
      } else {
        arr.push(Object.assign({ cannedId: cannedId, included: false }, patch));
      }
    },

    toggleCannedComment(itemId, tabName, cannedId) {
      var current = this._findStateEntry(itemId, tabName, cannedId);
      var item = this._findItemById(itemId);
      var canned = item && item.tabs && (item.tabs[tabName] || []).find(function (c) { return c.id === cannedId; });
      // Flip: if no state row, derive from template default.
      var nowIncluded = current ? !current.included : !(canned && canned.default);
      this._upsertStateEntry(itemId, tabName, cannedId, { included: nowIncluded });
      this.debounceSave();
    },

    setCannedCommentText(itemId, tabName, cannedId, text) {
      this._upsertStateEntry(itemId, tabName, cannedId, { comment: text });
      this.debounceSave();
    },

    // Spec 5B P2B — AI rewrite of a canned comment row. Sprint 1 A-5: opens
    // the global InlineTextPopover instead of window.prompt; on Apply, posts
    // to /api/ai/comment/edit and replaces the row's text on success. Errors
    // surface as toasts; the original text is preserved on any failure path.
    async rewriteCannedComment(itemId, tabName, cannedId, ev) {
      const item = this._findItemById(itemId);
      if (!item) return;
      const sectionTitle = (() => {
        for (var s = 0; s < this.sections.length; s++) {
          var items = this.sections[s].items || [];
          for (var i = 0; i < items.length; i++) if (items[i].id === itemId) return this.sections[s].title || '';
        }
        return '';
      })();

      // Resolve the current comment text + tab-specific extras from merged view.
      var entries = this.getTabEntries(itemId, tabName);
      var entry = entries.find(function (e) { return e.cannedId === cannedId; });
      if (!entry) return;
      var originalComment = entry.effectiveComment || entry.comment || '';
      // Competitor parity C3 — never call the rewriter on empty text. The
      // spec is explicit: "DO NOT generate from scratch — only rewrite
      // existing text." Server-side Zod also enforces min:1 but we'd rather
      // catch this with a friendly toast than a 400.
      if (!originalComment.trim()) {
        if (typeof showToast === 'function') showToast('Add a comment first, then rewrite with AI.', false);
        return;
      }
      var category = (tabName === 'defects' && entry.category) ? entry.category : null;
      var location = (tabName === 'defects' && entry.location) ? entry.location : null;
      var self = this;

      if (!window.OIPrompt) {
        if (typeof showToast === 'function') showToast('Popover unavailable. Reload the page.', true);
        return;
      }
      window.OIPrompt.open({
        title:       'Rewrite instruction',
        placeholder: 'e.g. shorten, make professional, add NW corner detail',
        scope:       'ai-rewrite',
        // Competitor parity C3 — quick-pick instruction templates.
        templates: [
          'shorten',
          'more specific',
          'less alarming',
          'more professional',
          'add specific location detail',
        ],
        onApply: function (instruction) {
          self._performAiRewrite(itemId, tabName, cannedId, ev, {
            item:            item,
            sectionTitle:    sectionTitle,
            originalComment: originalComment,
            category:        category,
            location:        location,
            instruction:     instruction,
          });
        },
      });
    },

    async _performAiRewrite(itemId, tabName, cannedId, ev, ctx) {
      var btn = ev && (ev.currentTarget || ev.target);
      var origText = btn ? btn.textContent : null;
      if (btn) { btn.textContent = '...'; btn.disabled = true; }
      var toast = function (m, err) { if (typeof showToast === 'function') showToast(m, err); };

      try {
        var body = {
          itemLabel:       ctx.item.label,
          sectionTitle:    ctx.sectionTitle,
          tab:             tabName,
          originalComment: ctx.originalComment,
          instruction:     ctx.instruction,
        };
        if (tabName === 'defects') {
          if (ctx.category) body.category = ctx.category;
          if (ctx.location) body.location = ctx.location;
        }
        var res = await authFetch('/api/ai/comment/edit', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        });
        var json = await res.json().catch(function () { return {}; });
        if (!res.ok) {
          // Sprint 1 A-4: route to Settings on missing AI key.
          if (json && json.error && json.error.code === 'ai_not_configured') {
            toast('AI is not configured. Opening Settings → Advanced → AI…', true);
            setTimeout(function () { window.location.href = '/settings/advanced/ai'; }, 1200);
            return;
          }
          var msg = (json && json.error && json.error.message) || ('AI rewrite failed (' + res.status + ').');
          toast(msg, true);
          return;
        }
        var rewritten = json && json.data && json.data.rewritten;
        if (!rewritten) {
          toast('AI returned no text. Try again.', true);
          return;
        }
        // Ensure included so the textarea is visible, then commit text.
        this._upsertStateEntry(itemId, tabName, cannedId, { included: true, comment: rewritten });
        this.debounceSave();
      } catch (e) {
        console.error('[AI] rewriteCannedComment error', e);
        toast('AI rewrite network error.', true);
      } finally {
        if (btn && origText !== null) { btn.textContent = origText; btn.disabled = false; }
      }
    },

    // Sprint 1 Sub-spec A Task 7 (A-6): AI rewrite for custom comments —
    // mirrors rewriteCannedComment but reads / writes the customComments
    // store via _patchCustom instead of upsertStateEntry.
    async rewriteCustomComment(itemId, tabName, customId, ev) {
      var item = this._findItemById(itemId);
      if (!item) return;
      var sectionTitle = (function (self) {
        for (var s = 0; s < self.sections.length; s++) {
          var items = self.sections[s].items || [];
          for (var i = 0; i < items.length; i++) if (items[i].id === itemId) return self.sections[s].title || '';
        }
        return '';
      })(this);

      var entries = this.getCustomEntries(itemId, tabName);
      var entry = entries.find(function (e) { return e.id === customId; });
      if (!entry) return;
      var originalComment = entry.comment || '';
      // Competitor parity C3 — only rewrite, never generate. See the matching
      // guard in rewriteCannedComment above.
      if (!originalComment.trim()) {
        if (typeof showToast === 'function') showToast('Add a comment first, then rewrite with AI.', false);
        return;
      }
      var category = (tabName === 'defects' && entry.category) ? entry.category : null;
      var location = (tabName === 'defects' && entry.location) ? entry.location : null;
      var self = this;

      if (!window.OIPrompt) {
        if (typeof showToast === 'function') showToast('Popover unavailable. Reload the page.', true);
        return;
      }
      window.OIPrompt.open({
        title:       'Rewrite custom comment',
        placeholder: 'e.g. shorten, sound less alarming, more specific',
        scope:       'ai-rewrite',
        // Competitor parity C3 — quick-pick instruction templates.
        templates: [
          'shorten',
          'more specific',
          'less alarming',
          'more professional',
          'add specific location detail',
        ],
        onApply: function (instruction) {
          self._performCustomRewrite(itemId, tabName, customId, ev, {
            item:            item,
            sectionTitle:    sectionTitle,
            originalComment: originalComment,
            category:        category,
            location:        location,
            instruction:     instruction,
          });
        },
      });
    },

    async _performCustomRewrite(itemId, tabName, customId, ev, ctx) {
      var btn = ev && (ev.currentTarget || ev.target);
      var origText = btn ? btn.textContent : null;
      if (btn) { btn.textContent = '...'; btn.disabled = true; }
      var toast = function (m, err) { if (typeof showToast === 'function') showToast(m, err); };

      try {
        var body = {
          itemLabel:       ctx.item.label,
          sectionTitle:    ctx.sectionTitle,
          tab:             tabName,
          originalComment: ctx.originalComment,
          instruction:     ctx.instruction,
        };
        if (tabName === 'defects') {
          if (ctx.category) body.category = ctx.category;
          if (ctx.location) body.location = ctx.location;
        }
        var res = await authFetch('/api/ai/comment/edit', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        });
        var json = await res.json().catch(function () { return {}; });
        if (!res.ok) {
          if (json && json.error && json.error.code === 'ai_not_configured') {
            toast('AI is not configured. Opening Settings → Advanced → AI…', true);
            setTimeout(function () { window.location.href = '/settings/advanced/ai'; }, 1200);
            return;
          }
          var msg = (json && json.error && json.error.message) || ('AI rewrite failed (' + res.status + ').');
          toast(msg, true);
          return;
        }
        var rewritten = json && json.data && json.data.rewritten;
        if (!rewritten) { toast('AI returned no text. Try again.', true); return; }
        this._patchCustom(itemId, tabName, customId, { comment: rewritten });
        this.debounceSave();
      } catch (e) {
        console.error('[AI] rewriteCustomComment error', e);
        toast('AI rewrite network error.', true);
      } finally {
        if (btn && origText !== null) { btn.textContent = origText; btn.disabled = false; }
      }
    },

    setDefectLocation(itemId, cannedId, location) {
      this._upsertStateEntry(itemId, 'defects', cannedId, { location: location });
      this.debounceSave();
    },

    setDefectCategory(itemId, cannedId, category) {
      this._upsertStateEntry(itemId, 'defects', cannedId, { category: category });
      this.debounceSave();
    },

    // Sprint 2 S2-3 — write the contractor recommendation slug onto a
    // defect state row. Empty string clears the selection (stored as null
    // so the report renderer can branch on `!= null`).
    setDefectRecommendation(itemId, cannedId, slug) {
      var value = (typeof slug === 'string' && slug.length > 0) ? slug : null;
      this._upsertStateEntry(itemId, 'defects', cannedId, { recommendationId: value });
      this.debounceSave();
    },

    // Sprint 2 S2-4 — write the low / high estimate (USD) onto a defect
    // state row. The UI lets inspectors enter dollars; we persist cents to
    // match the canonical money representation used elsewhere (Stripe etc).
    // Blank string => null (cleared). Non-numeric input falls back to null
    // so we never persist NaN.
    setDefectEstimate(itemId, cannedId, side, dollars) {
      var raw = (typeof dollars === 'string') ? dollars.trim() : dollars;
      var num = (raw === '' || raw == null) ? null : Number(raw);
      var cents = (num != null && Number.isFinite(num) && num >= 0) ? Math.round(num * 100) : null;
      var patch = (side === 'high') ? { estimateHigh: cents } : { estimateLow: cents };
      this._upsertStateEntry(itemId, 'defects', cannedId, patch);
      this.debounceSave();
    },

    activeItemTab: 'information',
    setActiveItemTab(tabName) {
      this.activeItemTab = tabName;
    },

    tabIncludedCount(itemId, tabName) {
      var entries = this.getTabEntries(itemId, tabName);
      var n = 0;
      for (var i = 0; i < entries.length; i++) if (entries[i].included) n++;
      return n;
    },

    tabTotalCount(itemId, tabName) {
      var item = this._findItemById(itemId);
      if (!item || !item.tabs) return 0;
      return (item.tabs[tabName] || []).length;
    },

    // Spec 5B P2B — Custom comments (per-inspection, NOT in template).
    // Stored under results[itemId].customComments[tab] as an array of
    // { id, title, comment, included, ... } objects. Defects also carry
    // category + location. The id is generated client-side and prefixed
    // with 'cu_' so we can distinguish them from template canned IDs.
    _ensureCustomState(itemId) {
      this._ensureItemState(itemId);
      var st = this.results[itemId];
      if (!st.customComments) st.customComments = { information: [], limitations: [], defects: [] };
      var c = st.customComments;
      if (!Array.isArray(c.information)) c.information = [];
      if (!Array.isArray(c.limitations)) c.limitations = [];
      if (!Array.isArray(c.defects))     c.defects     = [];
      return st;
    },

    getCustomEntries(itemId, tabName) {
      var st = this._ensureCustomState(itemId);
      return (st.customComments[tabName] || []).slice();
    },

    addCustomComment(itemId, tabName) {
      var st = this._ensureCustomState(itemId);
      var arr = st.customComments[tabName];
      var newId = 'cu_' + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
      var entry = { id: newId, title: '', comment: '', included: true };
      if (tabName === 'defects') {
        entry.category = 'maintenance';
        entry.location = '';
        entry.photos = [];
      }
      arr.push(entry);
      this.debounceSave();
    },

    removeCustomComment(itemId, tabName, customId) {
      var st = this._ensureCustomState(itemId);
      st.customComments[tabName] = (st.customComments[tabName] || []).filter(function (e) { return e.id !== customId; });
      this.debounceSave();
    },

    _patchCustom(itemId, tabName, customId, patch) {
      var st = this._ensureCustomState(itemId);
      var arr = st.customComments[tabName] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === customId) { Object.assign(arr[i], patch); break; }
      }
      this.debounceSave();
    },

    setCustomCommentTitle(itemId, tabName, customId, value) {
      this._patchCustom(itemId, tabName, customId, { title: value });
    },

    setCustomCommentText(itemId, tabName, customId, value) {
      this._patchCustom(itemId, tabName, customId, { comment: value });
    },

    setCustomCommentCategory(itemId, customId, value) {
      this._patchCustom(itemId, 'defects', customId, { category: value });
    },

    setCustomCommentLocation(itemId, customId, value) {
      this._patchCustom(itemId, 'defects', customId, { location: value });
    },

    // Counter helpers used by the tab badges — count canned-included +
    // any custom row marked `included: true`.
    tabCustomIncludedCount(itemId, tabName) {
      var entries = this.getCustomEntries(itemId, tabName);
      var n = 0;
      for (var i = 0; i < entries.length; i++) if (entries[i].included !== false) n++;
      return n;
    },

    tabBadgeCount(itemId, tabName) {
      return this.tabIncludedCount(itemId, tabName) + this.tabCustomIncludedCount(itemId, tabName);
    },

    tabBadgeTotal(itemId, tabName) {
      return this.tabTotalCount(itemId, tabName) + this.getCustomEntries(itemId, tabName).length;
    },

    toggleExpand(itemId) {
      this.expanded[itemId] = !this.expanded[itemId];
      if (this.expanded[itemId]) this.activeItemId = itemId;
      else if (this.activeItemId === itemId) this.activeItemId = null;
    },

    setActiveItem(itemId) {
      this.activeItemId = itemId;
    },

    dismissSwipeHint() {
      if (this.swipeHintDismissed) return;
      this.swipeHintDismissed = true;
      try { localStorage.setItem('oi:swipeHint', 'dismissed'); } catch (_) { /* ignore */ }
    },

    // Round 33 — long-press (500ms, no movement) + double-tap (within 300ms)
    onItemTouchStart(itemId, e) {
      if (this.isDesktop) return;
      if (!e.touches || e.touches.length !== 1) return;
      var t = e.touches[0];
      this._itemTouch = { itemId: itemId, startX: t.clientX, startY: t.clientY, startTime: Date.now() };
      if (this._itemLpTimer) clearTimeout(this._itemLpTimer);
      var self = this;
      this._itemLpTimer = setTimeout(function () {
        if (self._itemTouch && self._itemTouch.itemId === itemId) {
          self.quickRatingItemId = itemId;
          self.showQuickRating = true;
          self.activeItemId = itemId;
          if (navigator.vibrate) try { navigator.vibrate(20); } catch (_) { /* ignore */ }
          self._itemTouch = null;  // mark consumed so touchend ignores it
        }
      }, 500);
    },

    onItemTouchMove(e) {
      if (!this._itemTouch || !e.touches || !e.touches[0]) return;
      var t = e.touches[0];
      var dx = Math.abs(t.clientX - this._itemTouch.startX);
      var dy = Math.abs(t.clientY - this._itemTouch.startY);
      if (dx > 10 || dy > 10) {
        if (this._itemLpTimer) { clearTimeout(this._itemLpTimer); this._itemLpTimer = null; }
        this._itemTouch = null;
      }
    },

    onItemTouchEnd(itemId) {
      if (this._itemLpTimer) { clearTimeout(this._itemLpTimer); this._itemLpTimer = null; }
      if (!this._itemTouch) return;  // long-press fired or move cancelled
      var now = Date.now();
      if (this._itemLastTap && this._itemLastTap.itemId === itemId && (now - this._itemLastTap.time) < 300) {
        // double-tap → focus mode
        this.activeItemId = itemId;
        this.setViewMode('focus');
        this._itemLastTap = null;
      } else {
        this._itemLastTap = { itemId: itemId, time: now };
      }
      this._itemTouch = null;
    },

    setQuickRating(levelId) {
      if (!this.quickRatingItemId) { this.showQuickRating = false; return; }
      if (levelId === null) {
        if (!this.results[this.quickRatingItemId]) {
          this.results[this.quickRatingItemId] = { rating: null, notes: '', photos: [] };
        }
        this.results[this.quickRatingItemId].rating = null;
        this.debounceSave();
      } else {
        this.setRating(this.quickRatingItemId, levelId);
      }
      this.showQuickRating = false;
      this.quickRatingItemId = null;
    },

    closeQuickRating() {
      this.showQuickRating = false;
      this.quickRatingItemId = null;
    },

    toggleCheatsheet() {
      this.showCheatsheet = !this.showCheatsheet;
    },

    setViewMode(mode) {
      // 'split' (default desktop), 'focus' (single active card centered),
      // 'preview' (open the public viewer in a new tab).
      if (mode === 'preview') {
        window.open('/inspections/' + this.inspectionId + '/preview', '_blank');
        return;
      }
      this.viewMode = mode;
      if (typeof showToast === 'function') {
        showToast(mode === 'focus' ? 'Focus mode' : 'Split view');
      }
    },

    gotoSection(idx) {
      if (idx < 0 || idx >= this.sections.length) {
        if (typeof showToast === 'function') showToast('No section ' + idx);
        return;
      }
      this.currentSectionIdx = idx;
      var items = this.currentSectionItems || [];
      if (items.length) this.activeItemId = items[0].id;
      var sec = this.sections[idx];
      if (typeof showToast === 'function') showToast('Section: ' + (sec.title || sec.name || ('#' + idx)));
    },

    // ─── Sprint 3 S3-3 — Tag picker ────────────────────────────────
    async loadTagsIfNeeded() {
      if (this.tagsLibraryLoaded) return;
      try {
        const [libRes, mapRes] = await Promise.all([
          authFetch('/api/tags'),
          authFetch('/api/inspections/' + encodeURIComponent(this.inspectionId) + '/tags'),
        ]);
        if (libRes.ok) {
          const j = await libRes.json();
          this.tagsLibrary = (j && j.data) || [];
        }
        if (mapRes.ok) {
          const j = await mapRes.json();
          this.tagsByItem = (j && j.data) || {};
        }
        this.tagsLibraryLoaded = true;
      } catch (e) {
        console.error('Failed to load tags', e);
      }
    },

    openTagPicker(itemId) {
      this.tagPickerItemId = itemId;
      this.tagPickerQuery = '';
      this.tagPickerOpen = true;
      this.loadTagsIfNeeded();
      const self = this;
      setTimeout(function () {
        const input = document.getElementById('tag-picker-input');
        if (input) input.focus();
      }, 50);
    },

    closeTagPicker() {
      this.tagPickerOpen = false;
      this.tagPickerItemId = null;
      this.tagPickerQuery = '';
    },

    /** Tags currently linked to a single item (defensive copy via spread). */
    getItemTags(itemId) {
      if (!itemId) return [];
      return (this.tagsByItem && this.tagsByItem[itemId]) || [];
    },

    /** True when `tag` is linked to the active picker item. */
    isTagLinked(tag) {
      if (!this.tagPickerItemId || !tag) return false;
      const links = this.getItemTags(this.tagPickerItemId);
      return links.some(function (t) { return t.id === tag.id; });
    },

    /** Filter tag library by the picker query (case-insensitive substring). */
    get filteredTagsForPicker() {
      const q = (this.tagPickerQuery || '').toLowerCase().trim();
      const src = this.tagsLibrary || [];
      if (!q) return src;
      return src.filter(function (t) {
        return (t.name || '').toLowerCase().indexOf(q) !== -1;
      });
    },

    async toggleTag(tag) {
      if (!this.tagPickerItemId || !tag || this.tagSavingId) return;
      this.tagSavingId = tag.id;
      const itemId = this.tagPickerItemId;
      const inspectionId = this.inspectionId;
      const linked = this.isTagLinked(tag);
      try {
        let res;
        if (linked) {
          res = await authFetch(
            '/api/inspections/' + encodeURIComponent(inspectionId)
            + '/items/' + encodeURIComponent(itemId)
            + '/tags/' + encodeURIComponent(tag.id),
            { method: 'DELETE' }
          );
        } else {
          res = await authFetch(
            '/api/inspections/' + encodeURIComponent(inspectionId)
            + '/items/' + encodeURIComponent(itemId)
            + '/tags',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tagId: tag.id }),
            }
          );
        }
        if (!res.ok) {
          if (typeof showToast === 'function') showToast('Tag update failed', true);
          return;
        }
        // Optimistic local update — keep tagsByItem in sync.
        const current = this.getItemTags(itemId).slice();
        if (linked) {
          this.tagsByItem[itemId] = current.filter(function (t) { return t.id !== tag.id; });
        } else {
          this.tagsByItem[itemId] = current.concat([tag]).sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
        }
      } catch (e) {
        if (typeof showToast === 'function') showToast('Network error', true);
      } finally {
        this.tagSavingId = null;
      }
    },

    /** Inline removal of a chip on an item card. */
    async removeItemTag(itemId, tagId) {
      if (!itemId || !tagId) return;
      try {
        const res = await authFetch(
          '/api/inspections/' + encodeURIComponent(this.inspectionId)
          + '/items/' + encodeURIComponent(itemId)
          + '/tags/' + encodeURIComponent(tagId),
          { method: 'DELETE' }
        );
        if (!res.ok) {
          if (typeof showToast === 'function') showToast('Failed to remove tag', true);
          return;
        }
        const current = (this.tagsByItem[itemId] || []).slice();
        this.tagsByItem[itemId] = current.filter(function (t) { return t.id !== tagId; });
      } catch (e) {
        if (typeof showToast === 'function') showToast('Network error', true);
      }
    },

    onTagPickerKeydown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeTagPicker();
      }
    },

    /** Sprint 1 A-9: Fuzzy section picker. Opens via G then S leader-keys. */
    openSectionPicker() {
      this.sectionPickerOpen = true;
      this.sectionPickerQuery = '';
      this.sectionPickerIdx = 0;
      var self = this;
      setTimeout(function () {
        var input = document.getElementById('section-picker-input');
        if (input) input.focus();
      }, 50);
    },

    closeSectionPicker() {
      this.sectionPickerOpen = false;
      this.sectionPickerQuery = '';
      this.sectionPickerIdx = 0;
    },

    get filteredSectionsForPicker() {
      var q = (this.sectionPickerQuery || '').toLowerCase().trim();
      var src = (this.sections || []).map(function (s, idx) {
        return { idx: idx, title: s.title || s.name || ('#' + idx) };
      });
      if (!q) return src;
      return src.filter(function (s) { return s.title.toLowerCase().indexOf(q) !== -1; });
    },

    pickSection(idx) {
      this.gotoSection(idx);
      this.closeSectionPicker();
    },

    // Called from x-on:keydown on the picker input
    onSectionPickerKeydown(e) {
      var list = this.filteredSectionsForPicker;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.sectionPickerIdx = Math.min(this.sectionPickerIdx + 1, list.length - 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.sectionPickerIdx = Math.max(this.sectionPickerIdx - 1, 0);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        var sel = list[this.sectionPickerIdx];
        if (sel) this.pickSection(sel.idx);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeSectionPicker();
        return;
      }
    },

    openCommentLibrary(initialFilter) {
      if (!this.activeItem) {
        if (typeof showToast === 'function') showToast('Select an item first');
        return;
      }
      this.commentLibrarySearch = '';
      this.commentLibrarySelectedIdx = 0;
      if (initialFilter === 'my-snippets') {
        this.commentLibraryFilter = 'my-snippets';
      } else {
        var r = this.results[this.activeItemId]?.rating;
        this.commentLibraryFilter = this._bucketForRatingId(r);
      }
      this.showCommentLibrary = true;
      // Focus search input after render
      setTimeout(function () {
        var s = document.getElementById('comment-library-search');
        if (s) s.focus();
      }, 50);
    },

    insertComment(text, withExtraNewline) {
      if (!this.activeItemId) return;
      if (!this.results[this.activeItemId]) {
        this.results[this.activeItemId] = { rating: null, notes: '', photos: [] };
      }
      var existing = this.results[this.activeItemId].notes || '';
      var sep = withExtraNewline ? '\n\n' : '\n';
      this.results[this.activeItemId].notes = existing
        ? (existing.trimEnd() + sep + text)
        : text;
      this.expanded[this.activeItemId] = true;
      this.debounceSave();
      this.showCommentLibrary = false;
      if (typeof showToast === 'function') showToast('Comment inserted');
    },

    saveCurrentAsSnippet() {
      if (!this.activeItemId) {
        if (typeof showToast === 'function') showToast('Select an item first');
        return;
      }
      // Sprint 1 A-9: prefer the active selection in a textarea, otherwise
      // fall back to the full notes for the active item. Lets ⌘D harvest
      // a sub-string of the inspector's draft into a reusable snippet.
      var selectedText = '';
      var ae = document.activeElement;
      if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT') && typeof ae.selectionStart === 'number') {
        var ss = ae.selectionStart;
        var se = ae.selectionEnd;
        if (ss !== se) selectedText = (ae.value || '').substring(ss, se).trim();
      }
      var notes = selectedText || (this.results[this.activeItemId]?.notes || '').trim();
      if (!notes) {
        if (typeof showToast === 'function') showToast('No notes to save');
        return;
      }
      var bucket = this._bucketForRatingId(this.results[this.activeItemId]?.rating);
      var section = (this.currentSection && this.currentSection.title) || '';
      var self = this;

      var commit = function (title) {
        var body = {
          text:         notes,
          ratingBucket: bucket === 'all' ? null : bucket,
          section:      section || null,
          category:     title || null,
        };
        // Try server-side persistence first so the snippet shows up on the
        // /comments page and across devices. Fall back to localStorage on
        // failure (offline / 401).
        authFetch('/api/admin/comments', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        }).then(function (res) {
          if (res && res.ok) {
            self.loadUserSnippets();
            if (typeof showToast === 'function') showToast('Saved to snippets');
          } else {
            self._saveSnippetLocal(notes, bucket);
          }
        }).catch(function () {
          self._saveSnippetLocal(notes, bucket);
        });
      };

      if (window.OIPrompt) {
        window.OIPrompt.open({
          title:       'Save as snippet',
          placeholder: 'Optional title (or leave blank)',
          scope:       'snippet-save',
          onApply: function (title) { commit((title || '').trim()); },
        });
      } else {
        commit('');
      }
    },

    _saveSnippetLocal(notes, bucket) {
      var existing = [];
      try {
        var raw = localStorage.getItem('oi:snippets');
        if (raw) existing = JSON.parse(raw);
      } catch (_) {}
      for (var j = 0; j < existing.length; j++) {
        if (existing[j].text === notes) {
          if (typeof showToast === 'function') showToast('Snippet already saved');
          return;
        }
      }
      existing.unshift({ rating: bucket, text: notes, source: 'user' });
      localStorage.setItem('oi:snippets', JSON.stringify(existing));
      if (typeof showToast === 'function') showToast('Saved locally');
    },

    get _commentLibraryPool() {
      var COMMENTS = window.__OI_COMMENT_LIBRARY || [
        { rating: 'satisfactory', text: 'Functional and operating as intended at the time of inspection.' },
        { rating: 'satisfactory', text: 'No deficiencies observed.' },
        { rating: 'satisfactory', text: 'Appears to be properly installed and in working order.' },
        { rating: 'satisfactory', text: 'Cleaning and routine maintenance recommended.' },
        { rating: 'monitor', text: 'Recommend monitoring for further deterioration.' },
        { rating: 'monitor', text: 'Minor wear noted; consider preventive maintenance.' },
        { rating: 'monitor', text: 'Cosmetic defects observed; functional but recommend repair when convenient.' },
        { rating: 'monitor', text: 'Approaching end of useful service life; budget for replacement.' },
        { rating: 'defect', text: 'Recommend repair or replacement by a qualified contractor.' },
        { rating: 'defect', text: 'Active leak observed; recommend immediate professional attention.' },
        { rating: 'defect', text: 'Safety hazard noted; recommend correction prior to occupancy.' },
        { rating: 'defect', text: 'Not functioning at time of inspection; further evaluation recommended.' },
        { rating: 'defect', text: 'Improper installation observed; recommend correction by licensed professional.' },
        { rating: 'defect', text: 'Damaged or deteriorated; replacement recommended.' },
        { rating: 'all', text: 'Further evaluation recommended by a qualified specialist.' },
        { rating: 'all', text: 'Recommend a licensed professional review the condition for cost estimate.' },
        { rating: 'all', text: 'See attached photos for documentation.' },
        { rating: 'all', text: 'Inspection performed in accordance with InterNACHI Standards of Practice.' },
        { rating: 'all', text: 'Hidden conditions may exist that were not visible at the time of inspection.' },
        { rating: 'all', text: 'Item was not accessible during the inspection; recommend re-evaluation when accessible.' },
      ];
      COMMENTS = COMMENTS.map(function (c) { return Object.assign({}, c, { source: 'preset' }); });
      // Spec 2026-05-07 — server-backed user snippets (from /api/admin/comments)
      // are the canonical source for MY SNIPPETS. Fall back to localStorage
      // snippets (kept for offline + older saves) and dedupe on `text`.
      var SERVER = (this._userSnippets || []).slice();
      var seen = {};
      for (var i = 0; i < SERVER.length; i++) seen[SERVER[i].text] = true;
      var LOCAL = [];
      try {
        var raw = localStorage.getItem('oi:snippets');
        if (raw) {
          LOCAL = JSON.parse(raw)
            .filter(function (c) { return c && !seen[c.text]; })
            .map(function (c) { return Object.assign({}, c, { source: 'snippet' }); });
        }
      } catch (_) {}
      return COMMENTS.concat(SERVER, LOCAL);
    },

    get commentLibraryItems() {
      var pool = this._commentLibraryPool;
      var f = this.commentLibraryFilter;
      var filtered;
      if (f === 'my-snippets') {
        filtered = pool.filter(function (c) { return c.source === 'snippet'; });
      } else if (f === 'all') {
        filtered = pool;
      } else {
        filtered = pool.filter(function (c) { return c.rating === 'all' || c.rating === f; });
      }
      var q = (this.commentLibrarySearch || '').trim().toLowerCase();
      if (q) {
        filtered = filtered.filter(function (c) { return c.text.toLowerCase().indexOf(q) >= 0; });
      }
      return filtered;
    },

    // Spec 5G M1 — bucket inference. Tries name substring, falls back to
    // abbreviation and rating id ('S'/'M'/'D'/'Sat'/'Mon'/'NI'/'NP').
    _bucketForRatingId(ratingId) {
      if (!ratingId) return 'all';
      for (var i = 0; i < this.ratingLevels.length; i++) {
        if (this.ratingLevels[i].id !== ratingId) continue;
        var lvl = this.ratingLevels[i];
        var nm = (lvl.name || '').toLowerCase();
        var ab = (lvl.abbreviation || '').toUpperCase();
        var id = (lvl.id || '').toUpperCase();
        if (nm.indexOf('sat') >= 0 || ab === 'SAT' || ab === 'S' || id === 'S') return 'satisfactory';
        if (nm.indexOf('mon') >= 0 || nm.indexOf('marg') >= 0 || ab === 'MON' || ab === 'M' || id === 'M') return 'monitor';
        if (nm.indexOf('def') >= 0 || nm.indexOf('rep') >= 0 || ab === 'DEF' || ab === 'D' || id === 'D') return 'defect';
        break;
      }
      return 'all';
    },

    // Spec 5G M1 — right-pane inline quick comments. Auto-filters by
    // the active item's current rating so inspectors get the right pool
    // without opening the full library drawer.
    //
    // Sprint 1 A-2: ITEM-aware ranking. After bucket-filtering, score each
    // entry against the active item's label so the most relevant items
    // (e.g. "Gutters & Downspouts" comments when that item is active)
    // outrank generic section comments. Mirrors the server-side helper
    // rankCannedCommentsForItem in inspection.service.ts.
    get quickCommentsForActive() {
      var pool = this._commentLibraryPool;
      var bucket = 'all';
      var activeItem = null;
      var section = '';
      if (this.activeItemId) {
        var r = this.results[this.activeItemId]?.rating;
        bucket = this._bucketForRatingId(r);
        activeItem = this._findItemById(this.activeItemId);
        section = (this.currentSection && this.currentSection.title) || '';
      }
      var filtered = (bucket === 'all')
        ? pool
        : pool.filter(function (c) { return c.rating === 'all' || c.rating === bucket; });
      if (!activeItem) return filtered.slice(0, 6);

      var itemLabel = (activeItem.label || activeItem.name || '').toLowerCase().trim();
      var itemTokens = itemLabel.split(/[^a-z0-9]+/i).filter(function (t) { return t.length >= 3; });
      var lcSection = section.toLowerCase();

      function score(c) {
        var s = 0;
        var lcCategory = (c.category || '').toLowerCase();
        var lcText = (c.text || '').toLowerCase();
        var lcSec = (c.section || '').toLowerCase();
        if (lcCategory && lcCategory === itemLabel) s += 100;
        else if (lcCategory && (lcCategory.indexOf(itemLabel) !== -1 || (itemLabel && itemLabel.indexOf(lcCategory) !== -1))) s += 60;
        if (itemTokens.length > 0) {
          var hits = 0;
          for (var i = 0; i < itemTokens.length; i++) {
            if (lcText.indexOf(itemTokens[i]) !== -1 || lcCategory.indexOf(itemTokens[i]) !== -1) hits++;
          }
          if (hits === itemTokens.length) s += 40;
          else if (hits > 0) s += Math.round(20 * (hits / itemTokens.length));
        }
        if (lcSec && lcSec === lcSection) s += 10;
        return s;
      }

      var scored = filtered.map(function (c, idx) { return { c: c, s: score(c), idx: idx }; });
      scored.sort(function (a, b) { return (b.s - a.s) || (a.idx - b.idx); });
      return scored.map(function (x) { return x.c; }).slice(0, 6);
    },

    get commentLibraryCount() {
      var pool = this._commentLibraryPool;
      return this.commentLibraryItems.length + ' of ' + pool.length;
    },

    navigateItem(dir) {
      var items = this.currentSectionItems || [];
      if (!items.length) return;
      var curIdx = -1;
      if (this.activeItemId) {
        for (var i = 0; i < items.length; i++) {
          if (items[i].id === this.activeItemId) { curIdx = i; break; }
        }
      }
      var nextIdx = curIdx === -1 ? (dir > 0 ? 0 : items.length - 1) : curIdx + dir;
      // Wrap to next/prev section when overflowing
      if (nextIdx >= items.length) {
        if (this.currentSectionIdx < this.sections.length - 1) {
          this.currentSectionIdx += 1;
          var nextItems = this.currentSectionItems || [];
          if (nextItems.length) this.activeItemId = nextItems[0].id;
        }
      } else if (nextIdx < 0) {
        if (this.currentSectionIdx > 0) {
          this.currentSectionIdx -= 1;
          var prevItems = this.currentSectionItems || [];
          if (prevItems.length) this.activeItemId = prevItems[prevItems.length - 1].id;
        }
      } else {
        this.activeItemId = items[nextIdx].id;
      }
      // Scroll the active card into view
      if (this.activeItemId) {
        var idAttr = this.activeItemId;
        setTimeout(function () {
          var card = document.querySelector('[data-item-id="' + idAttr + '"]');
          if (card && card.scrollIntoView) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 0);
      }
    },

    get activeItem() {
      var items = this.currentSectionItems || [];
      if (this.activeItemId) {
        for (var i = 0; i < items.length; i++) {
          if (items[i].id === this.activeItemId) return items[i];
        }
      }
      // Fall back to last expanded item in current section
      for (var k = 0; k < items.length; k++) {
        if (this.expanded[items[k].id]) return items[k];
      }
      return null;
    },

    toggleBatchSelect(itemId) {
      this.batchSelected[itemId] = !this.batchSelected[itemId];
    },

    batchSelectAll() {
      var items = this.currentSectionItems;
      for (var i = 0; i < items.length; i++) {
        this.batchSelected[items[i].id] = true;
      }
    },

    batchSetRating(levelId) {
      var items = this.currentSectionItems;
      for (var i = 0; i < items.length; i++) {
        if (this.batchSelected[items[i].id]) {
          this.setRating(items[i].id, levelId);
        }
      }
      this.batchMode = false;
      this.batchSelected = {};
    },

    debounceSave() {
      clearTimeout(this.saveTimer);
      this.saveState = 'saving';
      // handoff §7 — mark dirty so the unsaved-guard guards browser close
      // and in-app nav until saveResults flips it back.
      window.OIDirty?.set?.(true);
      this.saveTimer = setTimeout(() => this.saveResults(), 1000);
    },

    async saveResults() {
      this.saveState = 'saving';
      try {
        var res = await authFetch('/api/inspections/' + this.inspectionId + '/results', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: this.results }),
        });
        this.saveState = res.ok ? 'saved' : 'error';
        if (res.ok) window.OIDirty?.set?.(false);
      } catch (e) {
        console.error('Failed to save results:', e);
        this.saveState = 'error';
      }
      if (this.saveState === 'saved') {
        setTimeout(() => { if (this.saveState === 'saved') this.saveState = 'idle'; }, 2000);
      }
    },

    async uploadPhoto(itemId, event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      await this._uploadBlobAsPhoto(itemId, file);
    },

    // S3-6 — shared upload path used by both <input type=file> and the
    // burst camera modal. Accepts a Blob (or File) and resolves once the
    // POST completes. On success, appends `{ key }` to results[itemId]
    // .photos and triggers the debounced save. Errors are swallowed and
    // logged — the surrounding caller surfaces a toast.
    async _uploadBlobAsPhoto(itemId, blob) {
      if (!blob || !itemId) return;
      var formData = new FormData();
      // Server endpoint is POST /api/inspections/:id/upload with form
      // field 'file' + 'itemId' (see src/api/inspections.ts:760).
      var fileName = (blob && blob.name) || ('photo-' + Date.now() + '.jpg');
      formData.append('file', blob, fileName);
      formData.append('itemId', itemId);
      try {
        var res = await authFetch('/api/inspections/' + this.inspectionId + '/upload', {
          method: 'POST',
          body: formData,
        });
        if (res.ok) {
          var json = await res.json();
          if (!this.results[itemId]) this.results[itemId] = {};
          if (!this.results[itemId].photos) this.results[itemId].photos = [];
          this.results[itemId].photos.push({ key: json.data.key });
          this.debounceSave();
        } else {
          if (typeof showToast === 'function') showToast('Photo upload failed.', true);
        }
      } catch (e) {
        console.error('Photo upload failed:', e);
        if (typeof showToast === 'function') showToast('Photo upload network error.', true);
      }
    },

    // S3-6 — open the burst-camera modal for this item. Dispatches a
    // window event the burstCamera factory listens for. If camera APIs
    // are missing or denied, the modal itself falls back to the native
    // <input capture> picker.
    openBurstCamera(itemId) {
      try {
        window.dispatchEvent(new CustomEvent('burst-camera:open', { detail: { itemId: itemId } }));
      } catch (e) {
        // Older browsers without CustomEvent constructor — fall back to
        // the file picker directly.
        var input = document.getElementById('hotkey-photo-input');
        if (input) input.click();
      }
    },

    // Sprint 1 A-7: upload a photo bound to a specific custom defect row.
    // Uses the same /api/inspections/:id/upload endpoint with targetType=defect
    // + customId form fields (added in src/api/inspections.ts). The R2 key
    // returns; we attach it to the matching custom defect entry's photos[].
    async uploadDefectPhoto(itemId, customId, event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      var formData = new FormData();
      formData.append('file', file);
      formData.append('itemId', itemId);
      formData.append('targetType', 'defect');
      formData.append('customId', customId);
      try {
        var res = await authFetch('/api/inspections/' + this.inspectionId + '/upload', {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) {
          if (typeof showToast === 'function') showToast('Photo upload failed.', true);
          return;
        }
        var json = await res.json();
        this._ensureCustomState(itemId);
        var st = this.results[itemId];
        var arr = (st.customComments && st.customComments.defects) || [];
        for (var i = 0; i < arr.length; i++) {
          if (arr[i].id === customId) {
            if (!arr[i].photos) arr[i].photos = [];
            arr[i].photos.push({ key: json.data.key });
            break;
          }
        }
        this.debounceSave();
      } catch (e) {
        console.error('Defect photo upload failed:', e);
        if (typeof showToast === 'function') showToast('Photo upload network error.', true);
      }
    },

    previewReport() {
      window.open('/api/inspections/' + this.inspectionId + '/report', '_blank');
    },

    // Round-2 F1 — Fetch the recipient list for the multi-recipient publish
    // modal. Each row gets a fresh { channels: { email: false, text: false } }
    // so checkbox state starts unchecked. Sets `loadingRecipients` for the
    // body's loading sentinel.
    async loadRecipients() {
      this.loadingRecipients = true;
      try {
        const res = await authFetch('/api/inspections/' + this.inspectionId + '/recipients');
        if (res.ok) {
          const json = await res.json();
          const list = (json && json.data) || [];
          this.recipients = list.map(function (r) {
            return {
              contactId: r.contactId,
              name:      r.name,
              role:      r.role,
              email:     r.email,
              phone:     r.phone,
              channels:  { email: !!r.email, text: false },
            };
          });
        } else {
          this.recipients = [];
        }
      } catch (e) {
        this.recipients = [];
      } finally {
        this.loadingRecipients = false;
      }
    },

    // Round-2 F1 — count of {recipient × channel} checkboxes that are on.
    // Used by Send All disabled binding.
    selectedRecipientCount() {
      let n = 0;
      for (const r of this.recipients) {
        if (r.channels && r.channels.email) n++;
        if (r.channels && r.channels.text)  n++;
      }
      return n;
    },

    async publish() {
      this.publishing = true;
      try {
        // Round-2 F1 — collapse the per-recipient channel selections into the
        // payload shape PublishInspectionSchema expects.
        const recipientPayload = (this.recipients || [])
          .map(function (r) {
            const ch = [];
            if (r.channels && r.channels.email) ch.push('email');
            if (r.channels && r.channels.text)  ch.push('text');
            return { contactId: r.contactId, channels: ch };
          })
          .filter(function (r) { return r.channels.length > 0; });

        const body = Object.assign({}, this.publishOptions, {
          recipients:        recipientPayload,
          sendAgreementCopy: this.publishOptions.payload === 'agreement',
        });

        var res = await authFetch('/api/inspections/' + this.inspectionId + '/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          var json = await res.json();
          this.showPublishModal = false;
          window.location.href = json.data?.reportUrl || '/dashboard';
        } else {
          var err = await res.json();
          showToast(err.error?.message || 'Publish failed', true);
        }
      } catch (e) {
        showToast('Publish failed: ' + e.message, true);
      } finally {
        this.publishing = false;
      }
    },

    async suggestComment(itemName, sectionName, targetField, ev) {
      const btn = ev?.currentTarget || ev?.target;
      if (!btn) return;
      const origText = btn.textContent;
      btn.textContent = '...';
      btn.disabled = true;
      const toast = (m, err) => { if (typeof showToast === 'function') showToast(m, err); };
      try {
        const res = await authFetch('/api/ai/suggest-comment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemName, sectionName }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          // Sprint 1 A-4: distinguish missing-key from other failures so the
          // inspector gets a clear path to AI settings instead of a generic
          // toast. Native confirm() is forbidden by the design system; we
          // surface a primary toast then redirect after a short delay so
          // the user sees what's happening.
          if (json?.error?.code === 'ai_not_configured') {
            toast('AI is not configured. Opening Settings → Advanced → AI…', true);
            setTimeout(function () {
              window.location.href = '/settings/advanced/ai';
            }, 1200);
            return;
          }
          const msg = json?.error?.message || `AI Suggest failed (${res.status}).`;
          toast(msg, true);
          return;
        }
        const suggestions = json.data || [];
        if (!suggestions.length) {
          toast('AI returned no suggestions. Try again.', true);
          return;
        }
        this.aiSuggestions = suggestions;
        this.aiTargetField = targetField;
        this.showAiPopover = true;
      } catch (e) {
        console.error('[AI] suggestComment error', e);
        toast('AI Suggest network error. Check connection.', true);
      } finally {
        btn.textContent = origText;
        btn.disabled = false;
      }
    },

    insertSuggestion(text) {
      if (this.aiTargetField) {
        this.aiTargetField.value = text;
        this.aiTargetField.dispatchEvent(new Event('input'));
      }
      this.showAiPopover = false;
      this.aiSuggestions = [];
    },

    // ============================================================
    // Design System 0520 subsystem D phase 9 — Republish UX.
    // Fetches /api/inspections/:id/versions on init + after a successful
    // publish; sets publishedVersion to the highest existing version (0
    // when none — first publish). The publish-modal uses this to flip
    // between "Publish" and "Republish — v{N+1}" UX.
    // ============================================================
    async refreshPublishedVersion() {
      try {
        const r = await fetch('/api/inspections/' + this.inspectionId + '/versions', {
          credentials: 'same-origin',
        });
        if (!r.ok) return;
        const body = await r.json();
        const versions = (body && body.data && body.data.versions) || [];
        // list endpoint returns versions descending — index 0 is the latest.
        this.publishedVersion = versions.length > 0 ? versions[0].versionNumber : 0;
      } catch (_) { /* swallow — non-fatal */ }
    },

    // ============================================================
    // Design System 0520 M10 — SpeedMode methods (subsystem A, phase 3).
    // Pure helpers live in /public/js/speed-mode-helpers.js (exposed as
    // window.SpeedMode by inspection-edit.tsx).
    // ============================================================
    _flatItems() {
      // Build a flat array of items in template order with derived metadata.
      // Cached per call (template + results are reactive — fresh build is
      // cheap for typical inspections of ~150 items).
      var out = [];
      var sections = this.template && this.template.sections ? this.template.sections : [];
      for (var s = 0; s < sections.length; s++) {
        var sec = sections[s];
        var items = sec.items || [];
        for (var i = 0; i < items.length; i++) {
          out.push({
            id: items[i].id,
            label: items[i].label || items[i].name || '',
            sectionName: sec.title || sec.name || '',
            sectionIdx: s,
            itemIdx: i,
            rating: (this.results[items[i].id] && this.results[items[i].id].rating) || null,
          });
        }
      }
      return out;
    },

    toggleSpeedMode() {
      if (!this.speedMode) {
        var items = this._flatItems();
        var Q = window.SpeedMode && window.SpeedMode.buildSpeedQueue ? window.SpeedMode.buildSpeedQueue(items) : [];
        if (Q.length === 0) {
          if (typeof showToast === 'function') showToast('All items rated ✓');
          return;
        }
        this._speedItems = items;
        this.speedQueue = Q;
        this.speedCurrent = 0;
        this.speedMode = true;
      } else {
        this.speedMode = false;
      }
    },

    get speedItemTitle() {
      if (!this.speedMode) return '';
      var idx = this.speedQueue[this.speedCurrent];
      if (idx == null || !this._speedItems) return '';
      return this._speedItems[idx] ? this._speedItems[idx].label : '';
    },
    get speedSectionName() {
      if (!this.speedMode) return '';
      var idx = this.speedQueue[this.speedCurrent];
      if (idx == null || !this._speedItems) return '';
      return this._speedItems[idx] ? this._speedItems[idx].sectionName : '';
    },
    get speedTotalCount() {
      return this._speedItems ? this._speedItems.length : 0;
    },
    get speedRatedCount() {
      if (!this._speedItems) return 0;
      var c = 0;
      for (var i = 0; i < this._speedItems.length; i++) {
        if ((this.results[this._speedItems[i].id] || {}).rating) c++;
      }
      return c;
    },
    get speedPercentText() {
      var total = this.speedTotalCount;
      if (!total) return '0%';
      return Math.round((this.speedRatedCount / total) * 100) + '%';
    },

    speedRate(value) {
      if (!this.speedMode) return;
      var qi = this.speedQueue[this.speedCurrent];
      if (qi == null) return;
      var item = this._speedItems[qi];
      if (!item) return;
      // Translate design-spec value → ratingLevels[N].id.
      var map = { sat: 0, monitor: 1, defect: 2, ni: 3, np: 4 };
      var idx = map[value];
      if (idx == null || !this.ratingLevels[idx]) return;
      this.setRating(item.id, this.ratingLevels[idx].id);
      // Remove from queue + auto-advance.
      this.speedQueue.splice(this.speedCurrent, 1);
      if (this.speedQueue.length === 0) {
        if (typeof showToast === 'function') showToast('All items rated ✓');
        var self = this;
        setTimeout(function () { self.speedMode = false; }, 1500);
        return;
      }
      if (this.speedCurrent >= this.speedQueue.length) {
        this.speedCurrent = this.speedQueue.length - 1;
      }
    },

    speedSkip() {
      if (!this.speedMode) return;
      var next = window.SpeedMode && window.SpeedMode.nextUnratedIndex
        ? window.SpeedMode.nextUnratedIndex(this.speedQueue, this.speedCurrent)
        : -1;
      this.speedCurrent = next === -1 ? 0 : next;
    },

    speedPrev() {
      if (!this.speedMode) return;
      if (this.speedCurrent > 0) this.speedCurrent--;
    },

    speedOpenEditor() {
      if (!this.speedMode) return;
      var qi = this.speedQueue[this.speedCurrent];
      if (qi == null || !this._speedItems) return;
      var item = this._speedItems[qi];
      if (!item) return;
      this.speedMode = false;
      this.activeItemId = item.id;
      this.currentSectionIdx = item.sectionIdx;
      var el = document.getElementById('item-' + item.id);
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    // ============================================================
    // Design System 0520 subsystem B phase 3 task 3.7 / phase 4 task 4.6
    // — additive field-level PATCH save path.
    //
    // Coexists with the legacy debounceSave() coarse-PUT loop without
    // touching its callers. New consumers (Subsystem D version-diff,
    // live conflict UX, multi-select bulk-rate) opt in by calling these
    // helpers; legacy setRating / setItemValue keep working unchanged.
    //
    // On 409 → dispatches `present-live-conflict` so LiveConflictModal
    // (subsystem B P3 T3.6) surfaces the diff. On other network errors
    // → enqueues via window.OfflineQueue so the existing sync-engine's
    // drain loop retries.
    // ============================================================
    _expectedVersions: {},   // itemId → { rating, notes, value } version counters

    _trackVersion(itemId, field, v) {
      if (!this._expectedVersions[itemId]) this._expectedVersions[itemId] = {};
      this._expectedVersions[itemId][field] = v;
    },

    _expectedVersion(itemId, field) {
      return (this._expectedVersions[itemId] && this._expectedVersions[itemId][field]) || 0;
    },

    async patchItemField(itemId, field, value) {
      var url  = '/api/inspections/' + this.inspectionId + '/items/' + encodeURIComponent(itemId);
      var body = { field: field, value: value, expectedVersion: this._expectedVersion(itemId, field) };
      try {
        var r = await fetch(url, {
          method:  'PATCH',
          headers: { 'content-type': 'application/json' },
          body:    JSON.stringify(body),
          credentials: 'same-origin',
        });
        if (r.status === 409) {
          var conflict = await r.json().catch(function () { return null; });
          if (conflict && conflict.error) {
            window.dispatchEvent(new CustomEvent('present-live-conflict', {
              detail: {
                inspectionId: this.inspectionId,
                itemId:       itemId,
                field:        field,
                yours:        { value: value, expectedVersion: body.expectedVersion },
                theirs:       conflict.error.current,
              },
            }));
          }
          return { ok: false, kind: 'conflict' };
        }
        if (!r.ok) {
          // Network-ish — queue via existing sync-engine so the next
          // drainQueue replays it.
          window.OfflineQueue && window.OfflineQueue.enqueue && window.OfflineQueue.enqueue({
            url: url, method: 'PATCH', body: JSON.stringify(body), inspectionId: this.inspectionId,
          });
          return { ok: false, kind: 'queued' };
        }
        var out = await r.json();
        var data = (out && out.data) || {};
        if (typeof data.newVersion === 'number') {
          this._trackVersion(itemId, field, data.newVersion);
        }
        // Mirror into local results so UI reflects without a re-fetch.
        if (!this.results[itemId]) this.results[itemId] = { rating: null, notes: '', photos: [] };
        this.results[itemId][field] = value;
        return { ok: true, newVersion: data.newVersion };
      } catch (err) {
        // Offline / fetch error — enqueue.
        window.OfflineQueue && window.OfflineQueue.enqueue && window.OfflineQueue.enqueue({
          url: url, method: 'PATCH', body: JSON.stringify(body), inspectionId: this.inspectionId,
        });
        return { ok: false, kind: 'queued' };
      }
    },
  };
}

// PDF download dropdown — registered as a standalone Alpine component so the
// nav bar (which sits outside the inspectionEditor x-data scope) can call it.
// Requires auth.js (authFetch) and toast.js (showToast) to be loaded first.
function pdfDownloader(inspectionId) {
    return {
        open: false,
        loading: false,
        async download(type) {
            this.open = false;
            this.loading = true;
            try {
                var r = await authFetch('/api/inspections/' + inspectionId + '/pdf?type=' + type);
                if (r.status === 200) {
                    var blob = await r.blob();
                    var url = URL.createObjectURL(blob);
                    var a = document.createElement('a');
                    a.href = url;
                    a.download = 'report-' + type + '.pdf';
                    a.click();
                    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
                } else if (r.status === 202) {
                    if (typeof showToast === 'function') showToast('PDF is still generating — try again in a moment.', true);
                } else {
                    if (typeof showToast === 'function') showToast('PDF not available. Enable the PDF pipeline in Settings → Advanced.', true);
                }
            } catch (e) {
                if (typeof showToast === 'function') showToast('PDF download failed.', true);
            }
            this.loading = false;
        },
    };
}

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
  return {
    inspectionId: inspectionId,
    inspection: {},
    sections: [],
    ratingLevels: [],
    results: {},
    expanded: {},
    activeItemId: null,
    currentSectionIdx: 0,
    // Spec 5G M1.1 — view modes (⌘1=split, ⌘2=focus, ⌘3=preview)
    viewMode: 'split',
    // Spec 5G M2 — Comment Library slide-out
    showCommentLibrary: false,
    commentLibraryFilter: 'all', // 'all' | 'satisfactory' | 'monitor' | 'defect' | 'my-snippets'
    commentLibrarySearch: '',
    commentLibrarySelectedIdx: 0,
    // GS prefix — set true after pressing G; next digit jumps to that section
    gPrefix: false,
    gPrefixTimer: null,
    batchMode: false,
    batchSelected: {},
    showMenu: false,
    showPublishModal: false,
    publishing: false,
    sendingPdf: false,
    isDesktop: window.innerWidth >= 1024,
    saveTimer: null,
    saveState: 'idle',
    _reportStats: { total: 0, satisfactory: 0, monitor: 0, defect: 0 },
    aiSuggestions: [],
    aiTargetField: null,
    showAiPopover: false,

    publishOptions: {
      theme: 'modern',
      notifyClient: true,
      notifyAgent: true,
      requireSignature: false,
      requirePayment: false,
    },

    async init() {
      window.addEventListener('resize', () => {
        this.isDesktop = window.innerWidth >= 1024;
      });
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
        // GS prefix — G then 0-9 jumps to that section
        if (this.gPrefix && /^[0-9]$/.test(e.key)) {
          e.preventDefault();
          this.gPrefix = false;
          clearTimeout(this.gPrefixTimer);
          this.gotoSection(parseInt(e.key, 10));
          return;
        }
        if (e.key === 'g' || e.key === 'G') {
          e.preventDefault();
          this.gPrefix = true;
          if (typeof showToast === 'function') showToast('Press 0–9 to jump to section');
          clearTimeout(this.gPrefixTimer);
          this.gPrefixTimer = setTimeout(() => { this.gPrefix = false; }, 1500);
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
        // T = tag (stub — no tag schema yet)
        if (e.key === 't' || e.key === 'T') {
          e.preventDefault();
          if (typeof showToast === 'function') showToast('Tags coming soon');
          return;
        }
        // Navigation: ArrowUp / ArrowDown move active item up/down,
        // Enter advances to next, Shift+Enter goes to previous.
        if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault();
          this.navigateItem(1);
          return;
        }
        if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) {
          e.preventDefault();
          this.navigateItem(-1);
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
        if (key === '1') idx = 0;
        else if (key === '2') idx = 1;
        else if (key === '3') idx = 2;
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
      await this.loadData();
    },

    async loadData() {
      try {
        var inspRes = await authFetch('/api/inspections/' + this.inspectionId);
        if (inspRes.status === 401) { window.location.href = '/login'; return; }

        var inspJson = await inspRes.json();
        this.inspection = inspJson.data?.inspection || {};

        // Try to load report-data (sections + rating levels)
        var dataRes = await authFetch('/api/inspections/' + this.inspectionId + '/report-data');
        if (dataRes.ok) {
          var dataJson = await dataRes.json();
          this.sections = (dataJson.data?.sections || []).map(function(sec) {
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
          this.ratingLevels = backfillLevelDescriptions(dataJson.data?.ratingLevels || []);
          this._reportStats = dataJson.data?.stats || this._reportStats;
          window.dispatchEvent(new CustomEvent('rating-levels-ready', { detail: this.ratingLevels }));
        }

        // Load existing results
        var resultsRes = await authFetch('/api/inspections/' + this.inspectionId + '/results');
        if (resultsRes.ok) {
          var rJson = await resultsRes.json();
          this.results = rJson.data?.data || {};
        }

        // Ensure every item has a results entry
        for (var s = 0; s < this.sections.length; s++) {
          var sec = this.sections[s];
          for (var i = 0; i < sec.items.length; i++) {
            var item = sec.items[i];
            if (!this.results[item.id]) {
              this.results[item.id] = { rating: null, notes: '', photos: [] };
            }
          }
        }
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
      var total = 0, rated = 0;
      for (var s = 0; s < this.sections.length; s++) {
        var items = this.sections[s].items;
        for (var i = 0; i < items.length; i++) {
          total++;
          if (this.results[items[i].id]?.rating) rated++;
        }
      }
      return total > 0 ? Math.round((rated / total) * 100) : 0;
    },

    get reportStats() {
      return this._reportStats;
    },

    set reportStats(val) {
      this._reportStats = val;
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
      this.currentSectionIdx = idx;
      this.batchMode = false;
      this.batchSelected = {};
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

    getItemRating(itemId) {
      return this.results[itemId]?.rating || null;
    },

    getItemNotes(itemId) {
      return this.results[itemId]?.notes || '';
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
      this.debounceSave();
    },

    toggleExpand(itemId) {
      this.expanded[itemId] = !this.expanded[itemId];
      if (this.expanded[itemId]) this.activeItemId = itemId;
      else if (this.activeItemId === itemId) this.activeItemId = null;
    },

    setActiveItem(itemId) {
      this.activeItemId = itemId;
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
      var notes = (this.results[this.activeItemId]?.notes || '').trim();
      if (!notes) {
        if (typeof showToast === 'function') showToast('No notes to save');
        return;
      }
      var bucket = this._bucketForRatingId(this.results[this.activeItemId]?.rating);
      var existing = [];
      try {
        var raw = localStorage.getItem('oi:snippets');
        if (raw) existing = JSON.parse(raw);
      } catch (_) {}
      // Dedupe
      for (var j = 0; j < existing.length; j++) {
        if (existing[j].text === notes) {
          if (typeof showToast === 'function') showToast('Snippet already saved');
          return;
        }
      }
      existing.unshift({ rating: bucket, text: notes, source: 'user' });
      localStorage.setItem('oi:snippets', JSON.stringify(existing));
      if (typeof showToast === 'function') showToast('Saved as snippet');
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
      var SNIPPETS = [];
      try {
        var raw = localStorage.getItem('oi:snippets');
        if (raw) SNIPPETS = JSON.parse(raw).map(function (c) { return Object.assign({}, c, { source: 'snippet' }); });
      } catch (_) {}
      return COMMENTS.concat(SNIPPETS);
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
    get quickCommentsForActive() {
      var pool = this._commentLibraryPool;
      var bucket = 'all';
      if (this.activeItemId) {
        var r = this.results[this.activeItemId]?.rating;
        bucket = this._bucketForRatingId(r);
      }
      if (bucket === 'all') return pool.slice(0, 6);
      return pool.filter(function (c) { return c.rating === 'all' || c.rating === bucket; }).slice(0, 6);
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
      var formData = new FormData();
      formData.append('photo', file);
      formData.append('itemId', itemId);
      try {
        var res = await authFetch('/api/inspections/' + this.inspectionId + '/photos', {
          method: 'POST',
          body: formData,
        });
        if (res.ok) {
          var json = await res.json();
          if (!this.results[itemId].photos) this.results[itemId].photos = [];
          this.results[itemId].photos.push({ key: json.data.key });
          this.debounceSave();
        }
      } catch (e) {
        console.error('Photo upload failed:', e);
      }
    },

    previewReport() {
      window.open('/api/inspections/' + this.inspectionId + '/report', '_blank');
    },

    async publish() {
      this.publishing = true;
      try {
        var res = await authFetch('/api/inspections/' + this.inspectionId + '/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.publishOptions),
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
  };
}

/**
 * Gap 4A — FIELD placeholder vocabulary + Tab cycling.
 *
 * Loaded sync in inspection-edit so the textarea keydown handler
 * can intercept Tab/Shift+Tab to cycle through [FIELD] placeholders.
 *
 * Usage:
 *   OIFields.FIELD_RE          — regex matching [A-Z_]+ placeholders
 *   OIFields.VOCABULARY        — array of {tag, hint} entries
 *   OIFields.findOpenFields(text) — returns [{tag, index, length}]
 *   OIFields.hasOpenFields(text)  — boolean shortcut
 *   OIFields.cycleField(textarea, reverse) — Tab/Shift+Tab jump
 */
(function () {
    'use strict';

    var FIELD_RE = /\[[A-Z_]+\]/g;

    var VOCABULARY = [
        { tag: 'LOCATION',  hint: 'Where in the home — e.g. "north bathroom ceiling", "slot 14"' },
        { tag: 'DEADLINE',  hint: 'Date or event by which repair is needed — e.g. "close of escrow"' },
        { tag: 'TIMEFRAME', hint: 'Maintenance window — e.g. "next 12 months"' },
        { tag: 'N',         hint: 'Numeric count — e.g. "2", "4 of 6"' },
    ];

    function findOpenFields(text) {
        if (!text) return [];
        var results = [];
        var m;
        FIELD_RE.lastIndex = 0;
        while ((m = FIELD_RE.exec(text)) !== null) {
            results.push({ tag: m[0].slice(1, -1), index: m.index, length: m[0].length });
        }
        return results;
    }

    function hasOpenFields(text) {
        FIELD_RE.lastIndex = 0;
        return FIELD_RE.test(text);
    }

    function cycleField(textarea, reverse) {
        var text = textarea.value;
        var fields = findOpenFields(text);
        if (fields.length === 0) return false;

        var cur = textarea.selectionEnd;
        var target;

        if (reverse) {
            var candidates = fields.filter(function (f) { return f.index < cur - 1; });
            target = candidates.length > 0 ? candidates[candidates.length - 1] : fields[fields.length - 1];
        } else {
            var forward = fields.filter(function (f) { return f.index >= cur; });
            target = forward.length > 0 ? forward[0] : fields[0];
        }

        textarea.focus();
        textarea.setSelectionRange(target.index, target.index + target.length);
        return true;
    }

    window.OIFields = {
        FIELD_RE: FIELD_RE,
        VOCABULARY: VOCABULARY,
        findOpenFields: findOpenFields,
        hasOpenFields: hasOpenFields,
        cycleField: cycleField,
    };
})();

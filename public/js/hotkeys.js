// Shared keyboard helpers — handoff-decisions §2.
//
// Single-letter and single-symbol shortcuts MUST be ignored when the user is
// typing into an input, textarea or contenteditable region. Any global hotkey
// handler (KeyboardHUD, command palette, page-level rating keys, etc.) should
// gate on `isTyping()` before reacting to a bare character.
//
// Combos with a real modifier (Cmd/Ctrl/Meta + letter, Esc) stay live so power
// users can still trigger ⌘K / ⌘S / Esc while typing.

(function () {
    'use strict';

    function isTyping(target) {
        const el = target || document.activeElement;
        if (!el) return false;
        const tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (el.isContentEditable) return true;
        return false;
    }

    function hasNonShiftModifier(event) {
        return event.metaKey || event.ctrlKey || event.altKey;
    }

    // Convenience: returns true if the key event should be ignored as a
    // "single character while typing" — i.e. user is in an input AND the
    // event has no real modifier other than Shift.
    function shouldIgnoreSingleChar(event) {
        return isTyping(event.target) && !hasNonShiftModifier(event);
    }

    window.OIHotkeys = { isTyping, hasNonShiftModifier, shouldIgnoreSingleChar };
})();

/** B-19a: single-letter editor shortcuts may fire only when focus is on <body> (or <main>, the focus fallback)
 *  or inside a container that explicitly opts in via data-shortcut-scope.
 *  Never inside form fields, never mid-IME-composition. */
export function singleKeyShortcutsAllowed(active: Element | null, isComposing: boolean): boolean {
    if (isComposing) return false;
    if (!active || active === document.body) return true;
    // <main> is where a closing drawer or dialog puts focus back (the focus fallback), not a control the user chose:
    // treat it like the body so the shortcuts survive a drawer on the phone and tablet layouts.
    if (active.tagName === 'MAIN') return true;
    const tag = active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
    if ((active as HTMLElement).isContentEditable) return false;
    return !!(active as HTMLElement).closest('[data-shortcut-scope]');
}

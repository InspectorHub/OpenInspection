import { afterAll, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { hasOpenLayer } from '../packages/shared-ui/src/layers';

/**
 * Extra setup for `web-dom-shared` only (see vitest.config.ts), on top of tests/setup-web.ts.
 *
 * That project runs with `isolate: false`: the spec files one worker handles share a module
 * registry and ONE happy-dom window. Two things follow.
 *
 * 1. @testing-library/react registers its automatic cleanup through a top-level `afterEach` the
 *    first time it is imported. It is an external package, so the registry keeps it: with a shared
 *    registry that import runs once per worker, only the first file in the worker gets the cleanup,
 *    and every later file would leave its mounts in the document. The cleanup is therefore
 *    registered here, once per file (this setup file is evaluated for every file). Calling it twice
 *    in a file that also imports the library is harmless.
 * 2. Anything a test leaves in the window would show up as a failure in whichever spec runs next. So
 *    after the cleanup the window must be back to what this file started with: <body> empty, no scroll
 *    lock, no open overlay, and the same <html> attributes, document title and <head> children. A leak
 *    therefore fails the test that caused it, by name, instead of its neighbour. Each leak is undone as
 *    it is reported so it reports once, not in every later test. The one exception is an overlay layer:
 *    the layer stack is private to its module and cannot be emptied from here, so a leaked layer is
 *    reported once per worker (by the first spec to leak one) and the later specs of that worker are
 *    not told again.
 *
 * Also cleared after every test: sessionStorage (localStorage is cleared by tests/setup-web.ts).
 */

interface WindowState {
  attributes: Map<string, string>;
  title: string;
  head: Set<Node>;
  href: string;
}

function snapshot(): WindowState {
  return {
    attributes: new Map(Array.from(document.documentElement.attributes, (a): [string, string] => [a.name, a.value])),
    title: document.title,
    head: new Set(Array.from(document.head.childNodes)),
    href: location.href,
  };
}

/**
 * Writes the product makes to the window as the page it is, and never unwinds because a real page never
 * needs it to (one page, one window). Each was read and found deterministic and keyed by what the test
 * rendered, so none of it is a test leaking; but left in place it would be the next file's starting
 * point, where a fresh window was the guarantee. They are therefore NOT reported per test (a file's own
 * tests share one window in every project, isolated or not) and are put back when the file ends:
 *  - <html> class and data-color-scheme (useTheme, the booking embed) and data-sidebar-collapsed (Sidebar);
 *  - the Turnstile and Stripe loader scripts appended to <head> once per page (turnstile.ts, Stripe loaders);
 *  - the address: a link the test clicks, or history.replaceState in the report table of contents.
 * A spec that writes any of these ITSELF is rejected by the web-isolation rules, so this only ever covers
 * the product's own effects.
 */
const PAGE_ATTRIBUTES = new Set(['class', 'data-color-scheme', 'data-sidebar-collapsed']);
const PAGE_SCRIPT = /challenges\.cloudflare\.com|js\.stripe\.com/;

interface Difference {
  /** A write the product makes as the page it is: restored when the file ends, not reported. */
  page: boolean;
  what: string;
  undo: () => void;
}

/** What differs between the window now and a snapshot. */
function differences(base: WindowState): Difference[] {
  const out: Difference[] = [];
  const root = document.documentElement;
  for (const a of Array.from(root.attributes)) {
    const was = base.attributes.get(a.name);
    const page = PAGE_ATTRIBUTES.has(a.name);
    if (was === undefined) {
      out.push({ page, what: `<html> gained ${a.name}="${a.value}"`, undo: () => root.removeAttribute(a.name) });
    } else if (was !== a.value) {
      out.push({ page, what: `<html ${a.name}> changed from "${was}" to "${a.value}"`, undo: () => root.setAttribute(a.name, was) });
    }
  }
  for (const [name, value] of base.attributes) {
    if (!root.hasAttribute(name)) out.push({ page: PAGE_ATTRIBUTES.has(name), what: `<html> lost ${name}`, undo: () => root.setAttribute(name, value) });
  }
  if (document.title !== base.title) {
    out.push({ page: false, what: `document.title changed to "${document.title}"`, undo: () => { document.title = base.title; } });
  }
  for (const n of Array.from(document.head.childNodes)) {
    if (base.head.has(n)) continue;
    const page = n instanceof HTMLScriptElement && PAGE_SCRIPT.test(n.src);
    out.push({ page, what: `a <${n instanceof Element ? n.tagName.toLowerCase() : '#text'}> was added to <head>`, undo: () => { n.parentNode?.removeChild(n); } });
  }
  for (const n of base.head) {
    if (n.parentNode !== document.head) out.push({ page: false, what: 'a node that was in <head> was removed', undo: () => { document.head.appendChild(n); } });
  }
  if (location.href !== base.href) {
    out.push({ page: true, what: `the address changed to ${location.href}`, undo: () => history.replaceState(null, '', base.href) });
  }
  return out;
}

/** Set once a leaked overlay layer has been reported by any file of this worker. */
const LAYER_REPORTED = Symbol.for('inspectorhub.web-shared.layer-leak-reported');

// Taken when this file starts, before the spec's own module-level code runs.
const baseline = snapshot();

afterEach(async () => {
  cleanup();
  sessionStorage.clear();
  // Closing a dialog raises useCloseShield's click shield from a microtask and removes it 450 ms later. It is
  // the one node the product leaves in <body> on purpose and by itself, so let that microtask run and drop the
  // node here: whether a dialog was open long enough to raise one must not decide whether a test passes.
  await Promise.resolve();
  document.body.querySelectorAll('[data-click-shield]').forEach((el) => el.remove());

  const leaks: string[] = [];
  const body = document.body;
  if (body.childNodes.length > 0) {
    const first = (body.firstElementChild?.outerHTML ?? body.textContent ?? '').slice(0, 160);
    leaks.push(`${body.childNodes.length} node(s) left in <body>, the first being: ${first}`);
    body.replaceChildren();
  }
  if (body.style.overflow === 'hidden' || body.style.position === 'fixed') {
    leaks.push('the overlay scroll lock is still applied to <body>');
    body.style.removeProperty('overflow');
    body.style.removeProperty('position');
  }
  for (const d of differences(baseline)) {
    if (d.page) continue;
    leaks.push(d.what);
    d.undo();
  }
  if (hasOpenLayer() && Reflect.get(globalThis, LAYER_REPORTED) !== true) {
    Reflect.set(globalThis, LAYER_REPORTED, true);
    leaks.push('an overlay layer is still registered (a Modal, Drawer, popover or menu was not unmounted); it cannot be cleared from here, so later specs of this worker are not told again');
  }
  if (leaks.length === 0) return;

  throw new Error(
    `This test leaked state into the shared happy-dom window: ${leaks.join('; ')}. ` +
      `Unmount what it rendered (render() from @testing-library/react is cleaned up automatically; createRoot and manual appendChild are not), ` +
      `restore what it wrote to the document, or move the spec to forcedIsolated in tests/web-isolation.json with the reason.`,
  );
});

// Back to the starting window for the next file of this worker (see PAGE_ATTRIBUTES).
afterAll(() => {
  for (const d of differences(baseline)) d.undo();
});

# Design System — Tokens, Components, Conformance

OpenInspection ships with a small, opinionated design system ("Design System
0523") rather than raw Tailwind utilities. It has three layers:

1. **Token layer** — CSS custom properties + a Tailwind v4 `@theme` block
   (`app/styles/tailwind.css`) that map semantic names (`bg-ih-bg-card`,
   `text-ih-fg-2`, `bg-ih-ok`) to real colors, and flip automatically for dark
   mode.
2. **Component primitives** — `packages/shared-ui/src/` — a small set of
   token-based React components (Button, Card, Modal, Input, ...) shared by
   both the standalone engine and (via the package) any SaaS overlay.
3. **Conformance tooling** — `npm run lint:ds` (`scripts/check-ds-tokens.mjs`)
   fails the build when UI code bypasses the token layer with raw Tailwind
   palette classes.

If you're adding or changing UI, this doc is the reference for what exists
today — don't invent new tokens or components ad hoc; extend what's here.

---

## 1. Token layer

All tokens are CSS custom properties, declared once in `app/styles/tailwind.css`
and re-exposed as Tailwind utilities via a `@theme` block (so `bg-ih-primary`,
`text-ih-fg-1`, etc. work as ordinary Tailwind classes). Components must
consume tokens, not literal colors — dark mode is then "free": swapping the
`:root` custom properties is enough, no per-component dark-mode code needed.

### Color tokens

| Token | Purpose |
|---|---|
| `--color-ih-primary` / `-600` / `-700` | Brand color + hover/active shades |
| `--color-ih-primary-tint` | Low-opacity primary wash (selected tab pill, badges) |
| `--color-ih-primary-glow` | Focus-ring glow color (see `shadow-ih-focus`) |
| `--color-ih-primary-fg` | Foreground for content on `bg-ih-primary`; defaults to white, but flips to dark text per-surface when a bright custom brand color is set (YIQ contrast pick) |
| `--color-ih-fg-1` … `-5` | Text scale from near-black/white (`-1`, headings/body) down to faint (`-5`, disabled/hairline) |
| `--color-ih-fg-inverse` | Text on an inverted surface (`bg-ih-bg-inverse`, `bg-ih-primary`) |
| `--color-ih-bg-app` | Page background |
| `--color-ih-bg-card` | Card/panel/input surface |
| `--color-ih-bg-muted` | Subtle fill (badges, disabled zones, hover rows) |
| `--color-ih-bg-inverse` | Inverted surface (tooltips, photo-studio chrome) |
| `--color-ih-border` / `-strong` | Hairline border / emphasized border |
| `--color-ih-agent-accent` / `-fg` | Sub-brand accent reserved for the Agent portal surface |

### Status tones

Four semantic tones, each with a `-bg` (tint) and `-fg` (text/icon) pair:
`ih-ok`, `ih-watch`, `ih-bad`, `ih-info`. Use these for anything that
communicates state — never reach for a raw `emerald-500` or `red-600`.

| Tone | Meaning | Example usage |
|---|---|---|
| `ih-ok` | Satisfactory / success | "Satisfactory" rating pill, success toast accent |
| `ih-watch` | Needs monitoring / warning | "Monitor" rating pill, warning banners |
| `ih-bad` | Defect / error | "Defect" rating pill, error toast accent, form field errors |
| `ih-info` | Informational | Info banners, neutral callouts |

### Shadows

Exactly two elevations exist — do not use Tailwind's `shadow-sm/md/lg/xl/2xl`:

| Token | Use |
|---|---|
| `shadow-ih-card` | Resting elevation for cards/panels |
| `shadow-ih-popover` | Elevated overlays — `Modal`, dropdowns, toasts |
| `shadow-ih-focus` | Focus ring (`0 0 0 3px var(--ih-primary-glow)`) — applied via `focus:shadow-ih-focus` |

### Radius

Five semantic corner radii — do not use raw `rounded-md/lg/xl` or arbitrary
`rounded-[10px]` in components (`lint:ds` flags the latter):

| Token | Value | Use |
|---|---|---|
| `rounded-ih-pill` | 4px | Pills, segment buttons, small chips |
| `rounded-ih-button` | 6px | Buttons, icon buttons, segmented-control track |
| `rounded-ih-input` | 8px | Text inputs (the `.ih-input` base radius) |
| `rounded-ih-card` | 8px | Cards, banners, popovers, panels |
| `rounded-ih-modal` | 12px | Modal dialog corners |

### Spacing

Two named spacing tokens capture recurring rhythms; use the standard Tailwind
scale for everything else. Arbitrary px spacing (`p-[18px]`, `gap-[2px]`) is
flagged by `lint:ds`:

| Token | Value | Use |
|---|---|---|
| `space-y-ih-list` / `gap-ih-list` / `p-ih-list` | 18px | Vertical rhythm between list rows / page sections |
| `p-ih-card` / `gap-ih-card` | 14px | Compact card padding |

(These are `@theme` spacing extensions, so they work with any spacing utility —
`p-`, `px-`, `gap-`, `space-y-`, `m-`, etc.)

### Backdrop (overlay scrim)

| Token | Use |
|---|---|
| `bg-ih-backdrop` | The single canonical overlay scrim — a fixed dark wash (`rgba(15,23,42,0.55)` light / `rgba(2,6,23,0.65)` dark) behind full-screen dialogs |

`Modal` and `Drawer` both render `bg-ih-backdrop` as their full-screen scrim;
`Popover` deliberately has **no** scrim (it is an anchored, non-blocking
overlay). Never hand-roll a scrim with `bg-[rgba(...)]` or `backdrop-blur` —
both are flagged by `lint:ds`; use this token.

### Fonts

`font-ih-display` (Bricolage Grotesque, headings), `font-ih-body` (Inter,
default body), `font-ih-mono` (JetBrains Mono, `.ih-kbd` and code).

### Dark mode

The `data-color-scheme` attribute on `<html>` selects the palette:
`"light"` (default), `"dark"`, or `"field"`. `useTheme()`
(`app/hooks/useTheme.ts`) is the single place that resolves the user's
preference (including `"auto"` → OS media query) and writes the attribute —
components never branch on scheme themselves. Do not use Tailwind's
`dark:` variant for OpenInspection colors; token consumption makes it
redundant (the `.dark` class is still added alongside `data-color-scheme` so
plain `dark:` utilities keep working for third-party components that need
them).

`"field"` is a first-class third scheme (not just "auto → dark"): a
high-contrast, large-type (18px base) variant of dark for outdoor/sunlight
field use. It inherits the dark palette and overrides foregrounds, background,
and borders for higher contrast.

### How to add a token

1. Add the CSS custom property to both the `:root` block (light) and the
   `html[data-color-scheme="dark"]` block (dark) in `app/styles/tailwind.css`
   — every token needs a value in both, or dark mode silently falls back to
   the light value.
2. Expose it as a Tailwind utility by adding a matching line to the `@theme`
   block (`--color-ih-foo: var(--ih-foo);`).
3. Consume it as `bg-ih-foo` / `text-ih-foo` / etc. Never reference the raw
   `--ih-foo` CSS variable directly from a component unless there is no
   Tailwind utility surface for it (e.g. inline `style={{ boxShadow: ... }}`).
4. Run `npm run lint:ds` — new raw palette usage elsewhere won't be caught by
   adding a token, but it confirms you haven't introduced a violation.

---

## 2. Typography & utility classes

A handful of non-component CSS utility classes live in `tailwind.css` for
patterns that recur across many components:

| Class | Purpose |
|---|---|
| `.ih-eyebrow` | 9px, bold, uppercase, letter-spaced label style (used by the deprecated `Eyebrow` component and a few standalone labels) |
| `.ih-input` | The canonical 36px-tall block input style (border, radius, focus ring). `Input` and most raw `<input>`/`<select>` field markup in `app/` build on this class directly |
| `.ih-kbd` | Keyboard-shortcut chip (monospace, bordered) |
| `.ih-pill` (+ `--sat` / `--monitor` / `--defect` / `--ni`) | Base pill shape; the shared-ui `Pill` component composes this with a `tone` prop — prefer the component over the raw class in new code |
| `.ih-row` / `.ih-row__hover` | Hover-reveal pattern: child marked `.ih-row__hover` is invisible until the `.ih-row` ancestor is hovered or has `.is-active` |
| `.ih-sidebar` | Sidebar width transition, driven by `html[data-sidebar-collapsed]` |

Use these for the exact pattern they name. For anything else, compose
Tailwind utilities from the token layer directly (`text-[13px] text-ih-fg-2
font-bold`, etc.) — there is no separate general-purpose typography scale
beyond the ad hoc pixel sizes already used throughout `app/components/`.

---

## 3. Component primitives

`packages/shared-ui/src/` (exported from `index.ts`) — 25 components. **Check
here before hand-rolling UI.** A new repeated pattern (a card variant used in
three places, a new pill tone) belongs in `shared-ui`, not copy-pasted across
route files.

| Component | Purpose | Key props / variants |
|---|---|---|
| `Button` | Primary interactive control | `variant`: `primary` \| `secondary` \| `ghost` \| `danger`; `size`: `sm` \| `md` \| `lg`; `icon` |
| `Pill` | Small status/tag chip | `tone`: `sat` \| `monitor` \| `defect` \| `ni` \| `np` \| `info` \| `gen` \| `primary` \| `neutral` \| `warning`; `dot` (leading dot) |
| `Icon` | Inline SVG icon from a fixed named set | `name` (see `ICON_PATHS` in `Icon.tsx` for the full list — dashboard, calendar, check, edit, camera, ...), `size`, `strokeWidth` |
| `Card` | Bordered/rounded/elevated surface container | no variants — compose with `className` |
| `Input` | Labeled text input built on `.ih-input` | `label`, `error` (red border + message), `hint` (shown only when no error) |
| `Textarea` | Labeled multiline input — same `.ih-input` chrome as `Input` but grows with `rows` and resizes vertically | `label`, `error`, `hint`, `rows` (default 3), `bare` (raw control only, for inline composition) |
| `Select` | Labeled single/multi select mirroring `Input`'s chrome; tokenized chevron in single-select mode | `label`, `error`, `hint`, `options` (`SelectOption[]`) or native `<option>` children, `multiple`, `bare`. Use for a fixed option list; use `Input` for free text |
| `Checkbox` | Single checkbox with native `<label>` association; DS `accent-ih-primary` fill | `label`, `error`, `bare` (raw input only, e.g. inside `FormField`) |
| `Radio` / `RadioGroup` | `RadioGroup` renders a `<fieldset>`/`role=radiogroup` set of options; `Radio` is the single control for custom layouts | `RadioGroup`: `name`, `value`, `onChange(value)`, `options` (`RadioOption[]`), `legend`, `error`, `hint`. Prefer `RadioGroup`; reach for bare `Radio` only for bespoke layouts |
| `Modal` | Centered dialog overlay (`role="dialog"` + `aria-modal`), full-screen `bg-ih-backdrop` scrim, Escape-to-close, click-outside-to-close, focus trap | `open`, `onClose`, `title`, `size`: `sm` \| `md` \| `lg` \| `xl`, `footer`. Use for confirm/decision moments and short forms (see §4) |
| `Drawer` | Right-side slide-in panel sharing `Modal`'s dialog behavior + scrim | `open`, `onClose`, `title`, `footer`, `wide` (480px vs 360px; mobile always full-width), `initialFocusRef`. Use for "adjust while seeing the page" flows — filters, long side forms — NOT confirm moments (see §4) |
| `Popover` | Anchored, non-blocking floating panel — no scrim, no scroll-lock, no hard focus-trap; Esc / click-outside close, focus restores to the anchor | `open`, `onClose`, `anchorRef` (trigger the panel positions against), `align`: `left` \| `right` (default `right`). Use for lightweight in-context choices (column toggles, dropdowns) where the page must stay visible (see §4) |
| `EmptyState` | Centered icon + title + description + action for empty lists | `icon`, `title`, `description`, `action` |
| `Eyebrow` | **Deprecated** small label chip (bg tint + text) | `color`: `slate` \| `indigo` \| `emerald` \| `amber` \| `rose` — kept for back-compat; new pages use a breadcrumb + a `Pill` in `PageHeader`'s `meta` instead |
| `PageHeader` | Page title row with optional meta line and trailing actions | `title`, `meta`, `actions`; `eyebrow`/`eyebrowColor` are deprecated (same reason as `Eyebrow`) |
| `Pagination` | Page-number nav + page-size selector | `page`, `pageSize`, `total`, `totalPages`, `onPageChange`, `onPageSizeChange`, `pageSizeOptions` |
| `Skeleton` | Loading placeholder block | `variant`: `text` \| `block`, `width` |
| `TabStrip` | Underline-style tab bar with optional counts | `tabs` (`{id, label, count?}[]`), `activeId`, `onChange` |
| `FileDropzone` | Drag-and-drop / click-to-pick file input with a full state machine (idle → drag-over → busy → selected → error) | `accept`, `onFile`, `fileName`/`fileSize` (controlled selection display), `busy`, `error`, `hint`, `onClear`. Also exports `firstFileFromDrop`, `formatFileSize`, `truncateMiddle` helpers |
| `Banner` | Full-width inline status/notice strip with ARIA live-region role (`alert` for warn/danger, `status` otherwise) | `tone`: `info` \| `warn` \| `danger` \| `success` \| `brand`; `actions`, `dismissible`/`onDismiss`, `icon`, `sticky`. Use for page-level or section-level messages; use `Pill` for a compact inline badge, a toast for a transient async outcome |
| `Table` | Generic column-config data table (tokenized header, hover rows, empty-state slot) | `columns` (`TableColumn<T>[]` — `label`, `align`, `cell`, `key`), `rows`, `empty`, `getRowKey`, `onRowClick`. Use for tabular listings instead of hand-rolled `<table>` markup |
| `SegmentedControl` | Single-select segmented toggle (WAI-ARIA radiogroup — roving tabindex, Arrow/Home/End keys) | `options` (`SegmentedControlOption[]` — `value`, `label`, `icon`, `title`), `value`, `onChange(value)`, `size`: `sm` \| `md`, `ariaLabel`. Use for a small set of mutually exclusive views/modes; use `TabStrip` for page navigation |
| `Avatar` | User initials/status chip; consolidates the app's initials logic (`avatarInitials` helper is exported) | `name` (initials derived), `size`: `28` \| `32` \| `36`, `variant`: `flat` \| `self` (gradient), `statusDot`, `ring`, `fallbackIcon` |
| `StatCard` | Compact metric card (label + large value + optional hint), optional left-accent tone bar reusing the `Pill` tone palette | `label`, `value`, `tone` (`PillTone`), `hint` |

`Eyebrow` and `PageHeader`'s `eyebrow`/`eyebrowColor` props are deprecated but
still shipped for back-compat — don't use them on new pages.

---

## 4. Interaction patterns

Two container shapes cover essentially every editable field in the app:
**inline editing** (no submit button) and **forms** (explicit Save/submit).
Getting this choice right matters more than pixel details — it's the
difference between an editor that feels fluid and one that feels bureaucratic
in the wrong places, or reckless in the wrong others.

### Inline editing (no submit button)

Use inline editing **only when ALL of these hold**:

1. **Single, self-contained field** — no cross-field validation or
   dependencies.
2. **Auto-save semantics** — the value persists on change/blur (or flows into
   the editor draft handled by the sync layer); a save failure surfaces as an
   error toast without interrupting typing.
3. **Continuous workflow** — the edit happens inline with surrounding context
   that must stay visible (renaming a section, rating items, writing report
   narratives).
4. **Low risk, no side effects** — saving never sends, publishes, creates an
   entity, or bills.

Canonical examples in this repo:

- **Template editor section title** — `app/components/template/SectionsList.tsx`:
  a transparent-background `<input>` with a focus underline
  (`border-b-2 border-transparent focus:border-ih-primary`), committing on
  every keystroke via `renameSection`.
- **Inspection editor field entry** — `app/components/form/FormField.tsx`:
  each item type (`text`, `number`, `select`, `boolean`, ...) renders a bare
  controlled input wired straight to `onChange`; there is no per-field save
  button, the value flows into the inspection's sync layer.
- **PCA narrative textareas** — same pattern, a `textarea` with
  `onChange`-driven persistence for free-text report narrative.

**Only two inline input visual styles are sanctioned** — do not invent a
third:

1. **Transparent title style**: `bg-transparent border-b-2 border-transparent
   focus:border-ih-primary outline-none` — for large, title-like inline text
   (section titles, item labels).
2. **`.ih-input` block style**: the bordered, `bg-ih-bg-card` block input —
   for ordinary field values (`FormField` renderers, most `Input` usage).

### Forms (explicit Save/submit)

A form is **required when ANY of these hold**:

1. **Multiple fields submitted together**, or cross-field validation/
   dependencies.
2. **Submission has side effects** — sends email/SMS, publishes, creates an
   entity, charges money.
3. **Explicit confirmation semantics are needed** — a Save/Cancel pair, or an
   unsaved-changes guard.

**Rule of thumb: if an "unsaved state" can exist, it's a form; a single field
that saves on blur can be edited inline.**

Container choice:

- **Page-level forms** for settings-style surfaces — see
  `app/routes/settings-workspace.tsx`: a React Router `action` + Zod schema
  (`workspaceSchema`) via `@conform-to/react`/`@conform-to/zod`, with
  `useForm({ shouldValidate: "onBlur", shouldRevalidate: "onInput" })` — this
  is the **eager-after-error** pattern: don't validate until the field is
  first touched/blurred, then revalidate on every subsequent change so the
  error clears as soon as the user fixes it.
- **`Modal`** for short or critical confirmations (destructive actions,
  small single-purpose dialogs) — build on the shared `Modal` component's
  `footer` slot for the Save/Cancel button pair.

### Overlay containers — Modal vs Drawer vs Popover

Three overlay primitives cover three distinct intents. Picking the wrong one is
the usual cause of "this feels heavy/interrupting" complaints:

| Primitive | Shape | Scrim / blocking | Use it for |
|---|---|---|---|
| `Modal` | Centered dialog | Full-screen `bg-ih-backdrop` scrim + focus trap — **interrupts** the page | Confirm/decision moments (destructive actions), short single-purpose forms |
| `Drawer` | Right-side slide-in panel | Same full-screen scrim + focus trap, but content stays anchored to the edge | Longer/complex side forms and "adjust while the page context is still framed" flows (filters, settings sub-panels) |
| `Popover` | Small panel anchored to a trigger | **No scrim, no scroll-lock, no hard focus-trap** — the page stays visible and interactive | Lightweight in-context choices (column toggles, dropdown menus, quick pickers) |

Rules of thumb:

- If the user must **stop and answer** before continuing → `Modal`.
- If they're **filling a longer form but the page behind it still gives useful
  context** → `Drawer`.
- If it's a **quick, low-stakes pick anchored to a button** and the rest of the
  page should stay live → `Popover`.

`Drawer` deliberately reuses `Modal`'s dialog chrome (`useDialogBehavior`:
scroll-lock, focus-trap, Escape/click-outside close). `Popover` intentionally
does **not** — it reimplements Esc/click-outside close and focus capture/restore
without the trap or scroll-lock, because those would be wrong for a non-blocking
anchored panel.

### Toasts

`app/hooks/useToast.ts` (`pushToast`) + `app/components/Toast.tsx`
(`ToastPortal`, mounted once near the root). Three variants:

| Variant | Visual | When |
|---|---|---|
| `neutral` (default) | Plain card, no accent | Informational, low-stakes confirmations (e.g. "Entered next section: Roof") |
| `success` | Left accent bar in `ih-ok` | A background action completed (e.g. photo upload succeeded) |
| `error` | Left accent bar in `ih-bad` + inline `!` marker | A background/auto-save action failed (e.g. "Save failed — your last change did NOT reach the server") |

Toast vs. inline error: toast a **background/async** outcome the user isn't
actively looking at (auto-save, background upload); show an **inline** error
(the `Input`/`FormField` `error` prop, or a form's field-level Zod error) when
the user is actively looking at the field that failed validation.

Toasts also support an optional `actionLabel`/`onAction` (e.g. "Undo" after a
batch rating change) and a caller-specified `durationMs`.

### Never use native dialogs

Never use `window.confirm` / `window.alert` / `window.prompt` for
confirmations — always use the shared `Modal` component with explicit
Save/Cancel (or Confirm/Cancel) actions in its `footer`.

---

## 5. Conformance tooling — `npm run lint:ds`

`scripts/check-ds-tokens.mjs` scans `app/` and `packages/shared-ui/src/` for
eight violation classes:

1. **Dead `-bg0` pseudo-token** — `ih-(ok|watch|bad|primary)-bg0` generates no
   utility and silently ships invisible elements.
2. **Raw palette utilities** — any Tailwind color-prefixed class
   (`bg-`/`text-`/`border-`/`ring-`/`shadow-`/... ) against a raw hue
   (`slate`, `red`, `indigo`, `emerald`, ...) with a numeric shade, e.g.
   `bg-slate-200`, `text-indigo-600`. These bypass dark mode and the brand
   hue entirely.
3. **Literal `bg-white` / `bg-black`** on in-app surfaces.
4. **Non-token shadows** — `shadow-sm|md|lg|xl|2xl`. Only `shadow-ih-card` and
   `shadow-ih-popover` are sanctioned.
5. **Arbitrary radius** — `rounded-[10px]` and friends. Use the semantic radii
   (`rounded-ih-pill|button|input|card|modal`).
6. **Arbitrary px spacing** — arbitrary-value padding/margin/gap/space like
   `p-[18px]`, `gap-[2px]`. Use the standard Tailwind scale or the
   `ih-list`/`ih-card` spacing tokens. (Width/height/inset and `min-`/`max-`
   dimensions are legitimately bespoke and are **not** flagged.)
7. **`backdrop-blur`** — glass blur is not part of the DS surface language.
8. **`bg-[rgba(...)]` scrims** — hand-rolled overlay tints. Use the single
   `bg-ih-backdrop` overlay token instead.

### Escape hatches

- **`ds-allow` comment** — on the offending line, or anywhere in the 10 lines
  above it — excuses the violation. Always state the reason (fixed-dark
  surfaces, print output, email bodies rendered in external clients).
- **`print:`-variant utilities are ignored** — print output is intentionally
  fixed-color.
- **File allowlist** — a short, justified list in `FILE_ALLOWLIST` inside the
  script (currently: the printable agreement route, the email-template
  preview, and the Media/Photo Studio chrome components, which are
  intentionally fixed-dark regardless of theme). Keep this list short; prefer
  a `ds-allow` comment for anything narrower than a whole file.

### Where it runs

- `npm run lint` (part of the aggregate lint script alongside `lint:svg`,
  `lint:erasure`, `lint:migrefs`, `lint:filesize`, `lint:dup`,
  `lint:tenant-scope`, `lint:tests`, and `lint:deadcode` — knip, which flags
  unused exports so retired primitives don't linger in `shared-ui`).
- Pre-commit (`.githooks/pre-commit`) — runs on every commit that touches
  non-docs/tests files.
- CI (`.github/workflows/ci.yml`, `verify` job) via `npm run lint`.

---

## 6. Contributing checklist

Before opening a PR that touches UI:

- [ ] **Tokens only** — no raw Tailwind palette classes, `bg-white`/`bg-black`,
      or `shadow-sm/md/lg/xl/2xl`. Run `npm run lint:ds` locally.
- [ ] **Dark mode checked** — toggle `data-color-scheme="dark"` on `<html>`
      (or use the in-app theme switcher) and confirm the surface still reads
      correctly. Token-only components get this for free; anything with a
      hardcoded color won't.
- [ ] **Reuse primitives** — check `packages/shared-ui/src/index.ts` before
      writing a new button/card/modal/pill. If you're duplicating a pattern a
      third time, promote it into `shared-ui` instead of copy-pasting again.
- [ ] **Interaction pattern matches the rules above** — a single auto-saving
      field is inline; anything with cross-field validation, side effects, or
      an unsaved state is a form (page-level or `Modal`).
- [ ] **No native dialogs** — `window.confirm`/`alert`/`prompt` are banned;
      use `Modal`.
- [ ] `npm run lint:ds` and `npm run lint` pass.

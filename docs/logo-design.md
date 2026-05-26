# Logo Design Specification

## Symbol Composition

The logo consists of two interlocking elements:

1. **Roof / House** (upper) — A stylized house roofline with chimney, representing property and home inspection
2. **Infinity ∞** (lower) — An infinity loop, representing continuous quality assurance, thoroughness, and the ongoing relationship between inspector and client

Together they convey: **"Infinite care for every home."**

## Color Scheme (V3 — Unified Gradient)

Both elements share a single three-stop diagonal gradient (`bottom-left → top-right`):

| Stop | Color | Tailwind | Role |
|------|-------|----------|------|
| 0% | `#4f46e5` | `indigo-600` | Deep anchor — matches `btn-primary` base |
| 50% | `#6366f1` | `indigo-500` | Core brand midpoint |
| 100% | `#3b82f6` | `blue-500` | Cool highlight — matches `from-indigo-500 to-blue-500` gradient |

This gradient is the same one used across the application for primary buttons, header accents, and interactive elements, ensuring brand consistency.

### Why a unified gradient?

- Two separate colors (e.g., dark roof + bright symbol) created visual tension and felt disconnected
- A single gradient flowing across both elements makes the mark feel like one cohesive symbol
- The bottom-left → top-right direction creates upward energy, reinforcing growth and aspiration

## Sizing & ViewBox

- **ViewBox:** `236 227 552 420` — tight crop with 12px padding around the graphic
- **Format:** SVG (vector, resolution-independent)
- **Files:** `public/favicon.svg` (browser tab) and `public/logo.svg` (in-app branding)

## Usage Rules

| Context | File | Notes |
|---------|------|-------|
| Browser tab favicon | `/favicon.svg` | Referenced in `manifest.json` |
| In-app header/footer | `/logo.svg` | Served via `serveStatic` in `index.ts` |
| PWA install icon | `/favicon.svg` + `/logo.svg` | Declared in `manifest.json` with `"sizes": "any"` |
| Dark backgrounds | Use as-is | The gradient reads well on both light and dark surfaces |

## Alternate Versions

Additional color variants are archived in the design files but not deployed:

| Variant | Description |
|---------|-------------|
| V1 | ∞ `indigo→blue` gradient + roof `indigo-700→600` dark gradient |
| V2 | ∞ `indigo→purple` gradient + roof `indigo-700→violet-600` gradient |
| V4 | ∞ `indigo→blue` gradient + roof `indigo-600` solid |
| V5 | ∞ `indigo-400→blue-400` + roof `indigo-300→violet-300` (for dark backgrounds) |

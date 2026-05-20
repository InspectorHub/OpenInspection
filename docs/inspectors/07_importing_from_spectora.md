# Importing a Template from Spectora

If your firm already uses Spectora and you have a template you want to keep in OpenInspection, you can import it without rebuilding the template by hand. This guide covers the round-trip in under 5 minutes.

---

## What you need

- A Spectora **template export** as JSON. In Spectora's Template Editor, use the platform's "Export" feature and save the file or copy the JSON to your clipboard.
- An OpenInspection account with the **inspector**, **admin**, or **owner** role.

## Steps

1. Sign in at `/login` and navigate to **Templates** (`/templates`).
2. Click **Import Spectora** (the secondary button to the left of "New Template").
3. In the modal:
   - Enter a **Template Name** (this is what shows up in your template list — e.g. *Residential Standard 2025*).
   - Paste the Spectora export JSON into the **Spectora Export JSON** field.
   - Optional: click **Try with sample** to drop a small fixture in and see what a clean import looks like.
4. Click **Import**. We convert the export and create the new template; the page redirects to the editor for your new template.

## What gets carried over

| Spectora field | OpenInspection home |
|---|---|
| Section name + identifier | Section title + identifier chip |
| Section disclaimer text | Per-section legal disclaimer (renders at the bottom of the section in the report) |
| Item name + description | Item label + description |
| `INFORMATIONAL` comments | **Information** tab |
| `SATISFACTORY` comments | **Information** tab, prefixed with `Satisfactory · ` so the original bucket is preserved |
| `MONITOR` comments | **Defects** tab, category `recommendation` |
| `DEFECT` comments | **Defects** tab, category `safety` |
| Unknown comment kinds | **Information** tab, with the source kind preserved in the entry title (e.g. `NOTE_FOR_BUILDER · …`) so you can re-categorise after import |
| Template-level rating levels | Custom rating system on the new template, with `is_defect` mapped to severity `significant` (otherwise `marginal`) and the `default` flag honoured |
| Spectora identifiers | `source.platform = 'spectora'` + the original Spectora ID on every section and item — so a re-import next year can detect the same rows |

## After import

The new template opens in the editor. The full Spectora structure is now editable:

- Adjust section titles, icons, or page-break behaviour.
- Add or remove rating options on rich items.
- Edit canned comments on each item via the **Canned Comments** pill in the right-side properties panel.
- Tweak the rating system via the rating pill in the header.

When you create an inspection from the imported template, the editor renders each item with the appropriate input (rating + canned tabs for rich items, dedicated controls for boolean / number / text / date / select / multi_select / photo_only). The published report surfaces whatever the inspector captures, including the non-rating values.

## Troubleshooting

- **"Error: schema is not valid JSON"** — paste from a fresh copy of the Spectora export; lossy clipboard tools sometimes strip newlines or quotes. Validate with any JSON linter first.
- **"Cannot import this template — legacy schema"** — your file is in a much older format than the current Spectora export. Re-export from Spectora, or open a support ticket.
- **A comment landed under the wrong tab** — Spectora exports vary; only the four documented bucket types map automatically. Unknown buckets go to Information with their source kind preserved in the title so you can drag the entry to the correct tab manually.

If you hit a real Spectora export that maps poorly, file an issue with a small redacted excerpt of the JSON and we can extend the converter (`apps/core/src/lib/spectora-import.ts`) to handle the new shape.

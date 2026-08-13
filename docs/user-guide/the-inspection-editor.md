# The inspection editor

The three-pane, keyboard-driven surface where the inspection is actually recorded.

> Part 4 of 7 in the inspection workflow. Illustrated version with a
> screenshot per step: <https://inspectorhub.io/docs/the-inspection-editor>

`/inspections/:id/edit` is a full-screen three-pane editor: sections on the left,
items in the middle, the item's detail on the right. It is built to be driven
from the keyboard.

| Key | Does |
|---|---|
| `1`–`5` | Rate the current item |
| `0` | Clear the rating |
| `N` | Mark N/A |
| `J` / `K`, `↓` / `↑`, `Enter` / `Shift+Enter` | Next / previous item |
| `/` | Open the canned-comment library |
| `;` | Open snippets |
| `T` | Tag picker |
| `P` | Add a photo |
| `R` | Clone the last entry |
| `F` | Toggle item fullscreen |
| `G` then a digit | Jump to that section |
| `G` then `S` | Section picker |
| `Z` | Toggle speed mode |
| `?` | Show the shortcut cheatsheet |
| `⌘S` / `Ctrl+S` | Save |
| `⌘D` / `Ctrl+D` | Save the current text as a snippet |
| `⌘⇧P` / `Ctrl+Shift+P` | Publish |

Single-key shortcuts only fire when you are not typing in a field.

The `⌘K` command palette belongs to the workspace chrome (the sidebar layout),
not to the editor — inside the editor `K` moves to the previous item.

Other editor facts worth knowing:

- **Photos** upload to R2 and attach to the item you are on.
- **Offline** — the app is a PWA. Edits and photo uploads queue in the browser
  and sync when the connection returns.
- **Simultaneous editing** — inspection results are a Yjs CRDT hosted in a
  Durable Object, so two inspectors can work the same job at once and the edits
  merge. If the `INSPECTION_DOC` binding is absent the collab routes return 501
  and you fall back to single-client editing with no realtime sync. See
  [`concepts/collab-editing.md`](../concepts/collab-editing.md).
- **AI assistance** needs `AI_MODEL` plus a credential. On a standalone install
  the credential is the one you store in Settings → Advanced → AI; there is no
  platform-provided key. With no model set, AI features fail closed with a 503
  rather than guessing a model.

---

← [Agreements and signatures](agreements-and-signatures.md) · [All guides](README.md) · [Publishing a report](publishing-a-report.md) →

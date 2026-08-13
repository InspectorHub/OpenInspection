# Publishing a report

Turning a completed inspection into a versioned snapshot the client can read.

> Part 5 of 7 in the inspection workflow. Illustrated version with a
> screenshot per step: <https://inspectorhub.io/docs/publishing-a-report>

Publish creates a **versioned report snapshot** — the report the client sees is
that snapshot, not the live editing state, so later edits cannot silently
rewrite what someone already read. Publishing needs the `publish` capability
(Owner, Manager, and Inspector have it by default; Agent never does).

The published report is at `/report/<tenant>/<id>`. `/report-view/<tenant>/<id>`
is the card-stack reading view, and `/version-diff/:id` shows what changed
between two versions.

You can require payment or a signed agreement before the report opens — that
gate lives at `/report-gate/<tenant>/<id>`.

---

← [The inspection editor](the-inspection-editor.md) · [All guides](README.md) · [Delivering the report](delivering-the-report.md) →

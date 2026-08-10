// #275 — the repair-vs-replace tag, re-exported for app-side use (same idiom as
// app/lib/agent-repair-access.ts). The definition stays server-side because that
// is where the vocabulary is PERSISTED and where authorship is ENFORCED; the
// routes read the same module so a form field and a column can never drift apart.
//
// `mayAuthorRepairActionTag` is deliberately NOT re-exported yet: nothing in the
// UI reads it until the tag control exists, and an unused re-export is what
// `lint:deadcode` is for. Add it here — do not inline the rule — when the
// control lands.

export {
  parseRepairActionTag,
  type RepairActionTag,
} from '../../server/lib/repair-action-tag';

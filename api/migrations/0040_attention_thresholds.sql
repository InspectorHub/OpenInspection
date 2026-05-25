-- handoff-decisions §1: configurable attention thresholds (in hours).
-- Stored as JSON on tenant_configs. Default 72h per spec, applied uniformly
-- to the three categories. Per-team configurable; UI lives at
-- Settings → Automations → Attention Rules.

ALTER TABLE tenant_configs ADD COLUMN attention_thresholds TEXT
    NOT NULL DEFAULT '{"agreement_unsigned_h":72,"invoice_overdue_h":72,"report_unpublished_h":72}';

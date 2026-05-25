-- 0059 — Make Workers Paid PDF pipeline opt-in.
--
-- The Spec 5A Browser-Rendering pipeline (publishInspection -> waitUntil
-- renderBoth -> R2) is a Workers Paid-only feature. Self-hosters on the
-- Free plan never get a successful render but still pay the wasted CPU
-- + log noise. Tenants who *do* have Paid would rather pay only when
-- they explicitly opt in to the pre-rendered PDFs (vs the always-free
-- window.print() fallback the report viewer ships with).
--
-- Default 0 (OFF). Existing tenants keep their already-rendered
-- report_pdfs rows; only NEW publish events stop auto-enqueuing.

ALTER TABLE tenant_configs
    ADD COLUMN enable_pdf_pipeline INTEGER NOT NULL DEFAULT 0;

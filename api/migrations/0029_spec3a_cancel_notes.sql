-- Spec 3A — capture optional free-text notes alongside cancel_reason enum.
ALTER TABLE inspections ADD COLUMN cancel_notes TEXT;

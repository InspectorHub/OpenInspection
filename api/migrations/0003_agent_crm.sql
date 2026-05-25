-- Migration: Agent CRM Phase H
-- Adds referral tracking to inspections

ALTER TABLE inspections ADD COLUMN referred_by_agent_id TEXT;
CREATE INDEX IF NOT EXISTS idx_inspections_agent ON inspections(referred_by_agent_id);

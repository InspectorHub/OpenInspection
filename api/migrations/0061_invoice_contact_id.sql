ALTER TABLE invoices ADD COLUMN contact_id TEXT REFERENCES contacts(id);
CREATE INDEX IF NOT EXISTS idx_invoices_contact ON invoices(tenant_id, contact_id);

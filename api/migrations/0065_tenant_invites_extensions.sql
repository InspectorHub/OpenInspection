-- Design System 0520 subsystem C phase 5 — tenant_invites extensions.
--
-- Permanent invites can now carry the apprentice's mentor + the
-- specialist's section assignment from the InviteSeatModal. Both fields
-- are NULL/empty for legacy lead/office roles. The accept flow copies
-- these into the resulting users row.
ALTER TABLE tenant_invites ADD COLUMN mentor_id            TEXT;
ALTER TABLE tenant_invites ADD COLUMN assigned_section_ids TEXT NOT NULL DEFAULT '[]';

-- Standard LOCAL Chrome/E2E review fixtures.
--
-- Idempotent (INSERT OR REPLACE on fixed ids), so it can be re-run over an
-- existing database without duplicating anything. Applied by
-- `npm run seed:local` after the schema is migrated.
--
-- NO SECRETS HERE. Stripe credentials live encrypted in tenant_configs
-- (secrets_enc / dek_enc) and come from the gitignored local-fixtures
-- snapshot — this file must stay committable, so it never touches those
-- columns. See scripts/seed-local-e2e.mjs.
--
-- The fixture ids are all prefixed `fx-` so `DELETE FROM x WHERE id LIKE 'fx-%'`
-- cleanly removes them without touching real local data.

-- ── Contacts: one of every type, because IA-96 widened `type` to three ──────
-- 'other' exists so the type filter and the contractor-role path have a
-- subject; without it that branch is untestable by clicking.
INSERT OR REPLACE INTO contacts (id, tenant_id, type, name, email, phone, agency, created_at) VALUES
 ('fx-contact-client', :TENANT, 'client', 'Dana Reyes',      'dana.reyes@example.com',    '+15551110001', NULL,             1785200000000),
 ('fx-contact-agent',  :TENANT, 'agent',  'Rosa Lindqvist',  'rosa@northside.example.com','+15551110002', 'Northside Realty',1785200000001),
 ('fx-contact-other',  :TENANT, 'other',  'Priya Anand',     'priya@titleco.example.com', NULL,           'Anand Title Co',  1785200000002),
-- No email: proves the Report Access panel says "cannot open any reports"
-- for the right reason rather than by accident.
 ('fx-contact-noemail',:TENANT, 'client', 'Marcus Webb',      NULL,                        '+15551110003', NULL,             1785200000003);

-- ── People on inspections: drives history, referral counts, and the ─────────
-- per-role manual send. Role ids are resolved by KEY so this survives a
-- reseed of contact_role_profiles (their ids are tenant-derived).
INSERT OR REPLACE INTO inspection_people (id, tenant_id, inspection_id, contact_id, role_profile_id, created_at)
SELECT 'fx-ip-client', :TENANT, :INSP_A, 'fx-contact-client', id, 1785200000010
  FROM contact_role_profiles WHERE tenant_id = :TENANT AND key = 'client' AND is_active = 1;
INSERT OR REPLACE INTO inspection_people (id, tenant_id, inspection_id, contact_id, role_profile_id, created_at)
SELECT 'fx-ip-agent', :TENANT, :INSP_A, 'fx-contact-agent', id, 1785200000011
  FROM contact_role_profiles WHERE tenant_id = :TENANT AND key = 'buyer_agent' AND is_active = 1;
-- Same agent on a second inspection → referralCount = 2, which is the column
-- IA-96 carried over from the retired Agents tab.
INSERT OR REPLACE INTO inspection_people (id, tenant_id, inspection_id, contact_id, role_profile_id, created_at)
SELECT 'fx-ip-agent-2', :TENANT, :INSP_B, 'fx-contact-agent', id, 1785200000012
  FROM contact_role_profiles WHERE tenant_id = :TENANT AND key = 'buyer_agent' AND is_active = 1;

-- ── Live report links (IA-100) ─────────────────────────────────────────────
-- The Report Access panel, the bulk/individual revoke, and the archive
-- dialog's live-link count all read these. `expires_at` NULL = open by policy,
-- which the service must treat as LIVE, not expired.
INSERT OR REPLACE INTO inspection_access_tokens
  (id, tenant_id, inspection_id, recipient_email, role, token, created_at, expires_at, revoked_at) VALUES
 ('fx-tok-client',  :TENANT, :INSP_A, 'dana.reyes@example.com',     'client',      'fx-plain-1', 1785200000020, NULL, NULL),
 ('fx-tok-agent-a', :TENANT, :INSP_A, 'rosa@northside.example.com', 'buyer_agent', 'fx-plain-2', 1785200000021, NULL, NULL),
 ('fx-tok-agent-b', :TENANT, :INSP_B, 'rosa@northside.example.com', 'buyer_agent', 'fx-plain-3', 1785200000022, NULL, NULL),
-- Already revoked: proves the list shows LIVE access only.
 ('fx-tok-revoked', :TENANT, :INSP_B, 'dana.reyes@example.com',     'client',      'fx-plain-4', 1785200000023, NULL, 1785200000099);

-- ── Invoices (IA-97) ───────────────────────────────────────────────────────
-- Status is DERIVED from paid_at / sent_at / voided_at — there is no `status`
-- column. One of each shape the page renders differently:
--   paid            → the "View inspection" action replacing the bare dash
--   unpaid          → Mark paid, and the "N unpaid" clause in the meta line
--   no inspection   → the dash that is CORRECT, since there is nowhere to go
INSERT OR REPLACE INTO invoices
  (id, tenant_id, inspection_id, client_name, amount_cents, line_items, currency, created_at, sent_at, paid_at, payment_method) VALUES
 ('fx-inv-paid',   :TENANT, :INSP_A, 'Dana Reyes', 45000, '[]', 'USD', 1785200000030, 1785200000030, 1785200000031, 'check'),
 ('fx-inv-unpaid', :TENANT, :INSP_B, 'Sam Okafor', 38000, '[]', 'USD', 1785200000032, 1785200000032, NULL, NULL),
 ('fx-inv-orphan', :TENANT, NULL,    'Ali Haddad', 12000, '[]', 'USD', 1785200000033, 1785200000033, NULL, NULL);

-- ── Message templates (role email/SMS template selects) ────────────────────
INSERT OR REPLACE INTO message_templates
  (id, tenant_id, name, channel, subject, body, is_seeded, created_at, updated_at) VALUES
 ('fx-tpl-agent-email', :TENANT, 'Agent report handoff', 'email',
  'Inspection report — {{property_address}}',
  '<p>Hi,</p><p>The report for <strong>{{property_address}}</strong> is ready. Client: {{client_name}}.</p><p><a href="{{report_url}}">Open the report</a></p>',
  0, 1785200000040, 1785200000040),
 ('fx-tpl-agent-sms', :TENANT, 'Agent report SMS', 'sms', NULL,
  'Report ready for {{property_address}}: {{report_url}}',
  0, 1785200000041, 1785200000041);

-- ── Notices (Track C3) ─────────────────────────────────────────────────────
-- One notice HEADER per recipient x notice, with its per-channel delivery
-- attempts hanging off `notice_id`. Seeded because the three inbox states are
-- otherwise unreachable by clicking: a clean delivery, a skip the recipient
-- can clear themselves ("Turn on texts"), and a bounce that names the address.
--
-- The client rows go to fx-contact-client and the agent rows to
-- fx-contact-agent, so the same fixture exercises BOTH bells: the client's
-- one-company inbox and the agent's cross-company one.
INSERT OR REPLACE INTO notifications
  (id, tenant_id, user_id, contact_id, inspection_id, type, title, body, entity_type, entity_id, read_at, archived_at, created_at) VALUES
 ('fx-notice-client-report',  :TENANT, NULL, 'fx-contact-client', :INSP_A, 'report.published',     'Report ready',  NULL, 'inspection', :INSP_A, NULL,          NULL, 1785380000000),
 ('fx-notice-client-invoice', :TENANT, NULL, 'fx-contact-client', :INSP_A, 'invoice.created',      'Invoice ready', NULL, 'inspection', :INSP_A, NULL,          NULL, 1785370000000),
 ('fx-notice-client-read',    :TENANT, NULL, 'fx-contact-client', :INSP_A, 'inspection.confirmed', 'Confirmed',     NULL, 'inspection', :INSP_A, 1785360001000, NULL, 1785360000000),
 ('fx-notice-agent-report',   :TENANT, NULL, 'fx-contact-agent',  :INSP_A, 'report.published',     'Report ready',  NULL, 'inspection', :INSP_A, NULL,          NULL, 1785380000000),
 ('fx-notice-agent-invoice',  :TENANT, NULL, 'fx-contact-agent',  :INSP_B, 'invoice.created',      'Invoice ready', NULL, 'inspection', :INSP_B, NULL,          NULL, 1785350000000);

-- Delivery details. `recipient` is an ADDRESS on email rows and a PHONE on sms
-- rows — which is exactly why the inbox reads by contact_id and never by
-- matching this column.
INSERT OR REPLACE INTO automation_logs
  (id, tenant_id, automation_id, inspection_id, recipient, recipient_role_key, channel, send_at, delivered_at, status, error, event_id, recipient_contact_id, notice_id) VALUES
 ('fx-log-client-1', :TENANT, NULL, :INSP_A, 'dana.reyes@example.com',    'client',      'email', 1785380000000, 1785380004000, 'sent',    NULL,                          NULL, 'fx-contact-client', 'fx-notice-client-report'),
 ('fx-log-client-2', :TENANT, NULL, :INSP_A, '+15551110001',              'client',      'sms',   1785380000000, NULL,           'skipped', 'no sms consent',              NULL, 'fx-contact-client', 'fx-notice-client-report'),
 ('fx-log-client-3', :TENANT, NULL, :INSP_A, 'dana.old@example.com',      'client',      'email', 1785370000000, NULL,           'failed',  '550 mailbox unavailable',     NULL, 'fx-contact-client', 'fx-notice-client-invoice'),
 ('fx-log-client-4', :TENANT, NULL, :INSP_A, 'dana.reyes@example.com',    'client',      'email', 1785360000000, 1785360002000, 'sent',    NULL,                          NULL, 'fx-contact-client', 'fx-notice-client-read'),
 ('fx-log-agent-1',  :TENANT, NULL, :INSP_A, 'rosa@northside.example.com','buyer_agent', 'email', 1785380000000, 1785380005000, 'sent',    NULL,                          NULL, 'fx-contact-agent',  'fx-notice-agent-report'),
 ('fx-log-agent-2',  :TENANT, NULL, :INSP_A, '+15551110002',              'buyer_agent', 'sms',   1785380000000, NULL,           'skipped', 'no sms consent',              NULL, 'fx-contact-agent',  'fx-notice-agent-report'),
-- An UNRECOGNIZED failure: the reader must get a flat "Not delivered" with no
-- explanation and no button, never our provider's wording.
 ('fx-log-agent-3',  :TENANT, NULL, :INSP_B, 'rosa@northside.example.com','buyer_agent', 'email', 1785350000000, NULL,           'failed',  'connection reset by peer',    NULL, 'fx-contact-agent',  'fx-notice-agent-invoice');

-- ── Staff notices (the inspector portal's own bell) ─────────────────────────
-- user_id side of the XOR: these are the OLD semantics ("tell the staff a rule
-- fired"), which Track B migrates. Seeded for every owner/manager so the bell
-- has rows whichever seat you log in as.
INSERT OR REPLACE INTO notifications
  (id, tenant_id, user_id, contact_id, inspection_id, type, title, body, entity_type, entity_id, read_at, archived_at, created_at)
SELECT 'fx-notice-staff-' || u.id, :TENANT, u.id, NULL, NULL, 'booking.received', 'New booking request',
       'Dana Reyes requested an inspection.', 'inspection', NULL, NULL, NULL, 1785380000000
  FROM users u WHERE u.tenant_id = :TENANT AND u.role IN ('owner', 'manager');
INSERT OR REPLACE INTO notifications
  (id, tenant_id, user_id, contact_id, inspection_id, type, title, body, entity_type, entity_id, read_at, archived_at, created_at)
SELECT 'fx-notice-staff2-' || u.id, :TENANT, u.id, NULL, NULL, 'agreement.signed', 'Agreement signed',
       NULL, 'inspection', NULL, 1785370001000, NULL, 1785370000000
  FROM users u WHERE u.tenant_id = :TENANT AND u.role IN ('owner', 'manager');

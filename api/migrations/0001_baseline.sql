-- OpenInspection baseline schema
-- Consolidated from migrations 0001-0079
-- Generated: 2026-05-26T10:39:07Z

CREATE TABLE agent_invites (
    token                TEXT    PRIMARY KEY,
    tenant_id            TEXT    NOT NULL REFERENCES tenants(id),
    inspector_contact_id TEXT,
    email                TEXT    NOT NULL,
    invited_by_user_id   TEXT    NOT NULL REFERENCES users(id),
    expires_at           INTEGER NOT NULL,
    accepted_at          INTEGER,
    created_at           INTEGER NOT NULL
);

CREATE TABLE agent_tenant_links (
    id                    TEXT    PRIMARY KEY,
    agent_user_id         TEXT    NOT NULL REFERENCES users(id),
    tenant_id             TEXT    NOT NULL REFERENCES tenants(id),
    inspector_contact_id  TEXT,
    status                TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','revoked')),
    invited_by_user_id    TEXT,
    created_at            INTEGER NOT NULL,
    revoked_at            INTEGER
);

CREATE TABLE "agreement_requests" (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    inspection_id TEXT REFERENCES inspections(id),
    agreement_id TEXT NOT NULL REFERENCES agreements(id),
    client_email TEXT NOT NULL,
    client_name TEXT,
    token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'viewed', 'signed', 'declined', 'expired')),
    signature_base64 TEXT,
    signed_at INTEGER,
    viewed_at INTEGER,
    sent_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE agreements (
    id          TEXT    PRIMARY KEY,
    tenant_id   TEXT    NOT NULL REFERENCES tenants(id),
    name        TEXT    NOT NULL,
    content     TEXT    NOT NULL,   
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL
);

CREATE TABLE apprentice_reviews (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    apprentice_id   TEXT NOT NULL,
    mentor_id       TEXT NOT NULL,
    inspection_id   TEXT NOT NULL,
    item_id         TEXT NOT NULL,
    field           TEXT NOT NULL,
    proposed_value  TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    decision_value  TEXT,
    decision_at     INTEGER,
    submitted_at    INTEGER NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_logs (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    user_id     TEXT,                    
    action      TEXT NOT NULL,           
    entity_type TEXT NOT NULL,           
    entity_id   TEXT,                    
    metadata    TEXT,                    
    ip_address  TEXT,
    created_at  INTEGER NOT NULL
, inspector_slug TEXT);

CREATE TABLE "automation_logs" (
    id              TEXT    PRIMARY KEY,
    tenant_id       TEXT    NOT NULL,
    automation_id   TEXT    NOT NULL,
    inspection_id   TEXT    NOT NULL,
    recipient_email TEXT    NOT NULL,
    send_at         TEXT    NOT NULL,
    delivered_at    TEXT,
    status          TEXT    NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','sent','failed','skipped')),
    error           TEXT
, event_id TEXT);

CREATE TABLE "automations" (
    id               TEXT    PRIMARY KEY,
    tenant_id        TEXT    NOT NULL REFERENCES tenants(id),
    name             TEXT    NOT NULL,
    trigger          TEXT    NOT NULL CHECK(trigger IN (
                       'inspection.created','inspection.confirmed','inspection.cancelled',
                       'report.published','invoice.created','payment.received',
                       'agreement.signed','agreement.viewed','agreement.declined','agreement.expired',
                       'event.created','event.completed'
                     )),
    recipient        TEXT    NOT NULL CHECK(recipient IN ('client','buying_agent','selling_agent','inspector','all')),
    delay_minutes    INTEGER NOT NULL DEFAULT 0,
    subject_template TEXT    NOT NULL,
    body_template    TEXT    NOT NULL,
    active           INTEGER NOT NULL DEFAULT 1,
    is_default       INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL
);

CREATE TABLE availability (
    id            TEXT    PRIMARY KEY,
    tenant_id     TEXT    NOT NULL REFERENCES tenants(id),
    inspector_id  TEXT    NOT NULL REFERENCES users(id),
    day_of_week   INTEGER NOT NULL,   
    start_time    TEXT    NOT NULL,   
    end_time      TEXT    NOT NULL,   
    created_at    INTEGER NOT NULL
);

CREATE TABLE availability_overrides (
    id            TEXT    PRIMARY KEY,
    tenant_id     TEXT    NOT NULL REFERENCES tenants(id),
    inspector_id  TEXT    NOT NULL REFERENCES users(id),
    date          TEXT    NOT NULL,                         
    is_available  INTEGER NOT NULL DEFAULT 0,              
    start_time    TEXT,                                    
    end_time      TEXT,                                    
    created_at    INTEGER NOT NULL
);

CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    text TEXT NOT NULL,
    category TEXT,
    created_at INTEGER NOT NULL
, severity TEXT, rating_bucket TEXT, section TEXT, library_id TEXT, section_ids TEXT, item_labels TEXT, trigger_code TEXT, search_keywords TEXT);

CREATE TABLE commercial_subtypes (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    name        TEXT NOT NULL,
    based_on    TEXT,
    description TEXT,
    disabled    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    UNIQUE(tenant_id, name)
);

CREATE TABLE concierge_confirm_tokens (
    token         TEXT    PRIMARY KEY,
    inspection_id TEXT    NOT NULL REFERENCES inspections(id),
    tenant_id     TEXT    NOT NULL,
    client_email  TEXT    NOT NULL,
    expires_at    INTEGER NOT NULL,
    confirmed_at  INTEGER,
    created_at    INTEGER NOT NULL
);

CREATE TABLE contacts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    type TEXT NOT NULL DEFAULT 'client' CHECK (type IN ('agent', 'client')),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    agency TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL
, created_by_user_id TEXT);

CREATE TABLE customer_messages (
    id            TEXT    PRIMARY KEY,
    tenant_id     TEXT    NOT NULL,
    inspection_id TEXT    NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    from_role     TEXT    NOT NULL CHECK(from_role IN ('client', 'inspector')),
    from_name     TEXT,
    body          TEXT    NOT NULL,
    attachments   TEXT,
    read_at       INTEGER,
    created_at    INTEGER NOT NULL
);

CREATE TABLE discount_codes (
  id          TEXT    PRIMARY KEY,
  tenant_id   TEXT    NOT NULL REFERENCES tenants(id),
  code        TEXT    NOT NULL,
  type        TEXT    NOT NULL CHECK(type IN ('fixed','percent')),
  value       INTEGER NOT NULL,
  max_uses    INTEGER,
  uses_count  INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

CREATE TABLE esign_audit_logs (
    id               TEXT PRIMARY KEY NOT NULL,
    tenant_id        TEXT NOT NULL,
    request_id       TEXT NOT NULL,
    event            TEXT NOT NULL,
    payload_json     TEXT NOT NULL,
    prev_hash        TEXT,
    hash             TEXT NOT NULL,
    signature        TEXT NOT NULL,
    key_fingerprint  TEXT NOT NULL,
    created_at       INTEGER NOT NULL
);

CREATE TABLE event_types (
    id                     TEXT PRIMARY KEY,
    tenant_id              TEXT NOT NULL REFERENCES tenants(id),
    name                   TEXT NOT NULL,
    slug                   TEXT NOT NULL,
    default_duration_min   INTEGER NOT NULL DEFAULT 30,
    default_price_cents    INTEGER NOT NULL DEFAULT 0,
    color                  TEXT NOT NULL DEFAULT '#6366f1',
    sort_order             INTEGER NOT NULL DEFAULT 0,
    active                 INTEGER NOT NULL DEFAULT 1,
    created_at             INTEGER NOT NULL
);

CREATE TABLE guest_invites (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    token               TEXT UNIQUE NOT NULL,
    role                TEXT NOT NULL,
    duration_seconds    INTEGER NOT NULL,
    expires_at          INTEGER NOT NULL,
    claimed_by_user_id  TEXT,
    claimed_at          INTEGER,
    created_by          TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE inspection_agreements (
    id                TEXT    PRIMARY KEY,
    tenant_id         TEXT    NOT NULL REFERENCES tenants(id),
    inspection_id     TEXT    NOT NULL REFERENCES inspections(id),
    signature_base64  TEXT    NOT NULL,
    signed_at         INTEGER NOT NULL,
    ip_address        TEXT,
    user_agent        TEXT
);

CREATE TABLE inspection_events (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL REFERENCES tenants(id),
    inspection_id       TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    event_type_id       TEXT NOT NULL REFERENCES event_types(id),
    inspector_id        TEXT REFERENCES users(id),
    scheduled_at        INTEGER NOT NULL,
    duration_min        INTEGER NOT NULL,
    price_cents         INTEGER NOT NULL DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'scheduled',
    notes               TEXT,
    completed_at        INTEGER,
    results_received_at INTEGER,
    cancelled_at        INTEGER,
    created_at          INTEGER NOT NULL
, gcal_event_id TEXT);

CREATE TABLE inspection_item_tag_links (
  inspection_id TEXT    NOT NULL,
  item_id       TEXT    NOT NULL,
  tag_id        TEXT    NOT NULL,
  tenant_id     TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (inspection_id, item_id, tag_id)
);

CREATE TABLE inspection_media_pool (
    id           TEXT PRIMARY KEY,
    inspection_id TEXT NOT NULL,
    tenant_id    TEXT NOT NULL,
    r2_key       TEXT NOT NULL,
    url          TEXT NOT NULL,
    uploaded_at  INTEGER NOT NULL,
    exif_data    TEXT
, annotations TEXT, caption TEXT);

CREATE TABLE inspection_requests (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    client_name       TEXT NOT NULL,
    client_email      TEXT,
    client_phone      TEXT,
    property_address  TEXT NOT NULL,
    property_city     TEXT,
    property_state    TEXT,
    property_zip      TEXT,
    scheduled_at      TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','confirmed','in_progress','completed','cancelled')),
    notes             TEXT,
    total_amount      INTEGER NOT NULL DEFAULT 0,
    payment_status    TEXT NOT NULL DEFAULT 'unpaid'
        CHECK (payment_status IN ('unpaid','partial','paid')),
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
);

CREATE TABLE inspection_results (
    id              TEXT    PRIMARY KEY,
    tenant_id       TEXT    NOT NULL REFERENCES tenants(id),
    inspection_id   TEXT    NOT NULL REFERENCES inspections(id),
    data            TEXT    NOT NULL,   
    last_synced_at  INTEGER NOT NULL
, rating_system_id TEXT, rating_system_snapshot TEXT);

CREATE TABLE inspection_services (
  id             TEXT    PRIMARY KEY,
  tenant_id      TEXT    NOT NULL REFERENCES tenants(id),
  inspection_id  TEXT    NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  service_id     TEXT    NOT NULL REFERENCES services(id),   
  price_override INTEGER,
  name_snapshot  TEXT    NOT NULL,
  price_snapshot INTEGER NOT NULL
);

CREATE TABLE inspection_units (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    inspection_id   TEXT NOT NULL,
    parent_unit_id  TEXT,
    kind            TEXT NOT NULL,
    name            TEXT NOT NULL,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
, type TEXT NOT NULL DEFAULT 'unit');

CREATE TABLE inspections (
    id               TEXT    PRIMARY KEY,
    tenant_id        TEXT    NOT NULL REFERENCES tenants(id),
    inspector_id     TEXT             REFERENCES users(id),
    property_address TEXT    NOT NULL,
    client_name      TEXT,
    client_email     TEXT,
    template_id      TEXT             REFERENCES templates(id),
    date             TEXT    NOT NULL,                          
    status           TEXT    NOT NULL DEFAULT 'draft',          
    payment_status   TEXT    NOT NULL DEFAULT 'unpaid',         
    price            INTEGER NOT NULL DEFAULT 0,                
    created_at       INTEGER NOT NULL
, referred_by_agent_id TEXT, client_phone TEXT, confirmed_at       TEXT, cancel_reason      TEXT, payment_required   INTEGER NOT NULL DEFAULT 0, agreement_required INTEGER NOT NULL DEFAULT 0, discount_code_id   TEXT REFERENCES discount_codes(id), discount_amount    INTEGER, closing_date       TEXT, referral_source    TEXT, order_id           TEXT, internal_notes     TEXT, year_built         INTEGER, sqft               INTEGER, foundation_type    TEXT, bedrooms           INTEGER, bathrooms          REAL, unit               TEXT, county             TEXT, selling_agent_id   TEXT REFERENCES contacts(id), disable_automations INTEGER NOT NULL DEFAULT 0, message_token TEXT, template_snapshot TEXT, template_snapshot_version INTEGER DEFAULT 1, cancel_notes TEXT, report_theme_override TEXT, address_place_id TEXT, address_street TEXT, address_city TEXT, address_state TEXT, address_zip TEXT, address_county TEXT, address_lat REAL, address_lng REAL, address_geocoded_at INTEGER, request_id TEXT REFERENCES inspection_requests(id), lot_size       TEXT, property_facts TEXT, concierge_status TEXT
    CHECK (concierge_status IN ('awaiting_client','awaiting_inspector') OR concierge_status IS NULL), team_mode INTEGER NOT NULL DEFAULT 0, lead_inspector_id TEXT, helper_inspector_ids TEXT NOT NULL DEFAULT '[]', data_version INTEGER NOT NULL DEFAULT 0, cover_photo_id TEXT, property_type TEXT, commercial_subtype TEXT);

CREATE TABLE invoices (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    inspection_id TEXT REFERENCES inspections(id),
    client_name TEXT,
    client_email TEXT,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    line_items TEXT NOT NULL DEFAULT '[]',
    due_date TEXT,
    notes TEXT,
    sent_at INTEGER,
    paid_at INTEGER,
    created_at INTEGER NOT NULL
, partial_paid_at INTEGER, qbo_sync_status TEXT, contact_id TEXT REFERENCES contacts(id));

CREATE TABLE marketplace_libraries (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    kind           TEXT NOT NULL,         
    semver         TEXT NOT NULL,
    schema         TEXT NOT NULL,         
    author_id      TEXT NOT NULL DEFAULT 'system',
    changelog      TEXT,
    download_count INTEGER NOT NULL DEFAULT 0,
    featured       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

CREATE TABLE marketplace_templates (
  id             TEXT    PRIMARY KEY,
  name           TEXT    NOT NULL,
  category       TEXT    NOT NULL
                   CHECK(category IN ('residential','commercial','trec','condo','new_construction')),
  semver         TEXT    NOT NULL,
  schema         TEXT    NOT NULL,
  author_id      TEXT    NOT NULL DEFAULT 'system',
  changelog      TEXT,
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
, featured INTEGER NOT NULL DEFAULT 0);

CREATE TABLE notifications (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    entity_type TEXT,
    entity_id TEXT,
    metadata TEXT,
    read_at INTEGER,
    archived_at INTEGER,
    created_at INTEGER NOT NULL
);

CREATE TABLE observer_links (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    inspection_id   TEXT NOT NULL,
    token           TEXT UNIQUE NOT NULL,
    created_by      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at      INTEGER NOT NULL,
    revoked_at      INTEGER,
    last_viewed_at  INTEGER
);

CREATE TABLE qbo_connections (
    tenant_id                TEXT PRIMARY KEY,
    realm_id                 TEXT NOT NULL,
    company_name             TEXT,
    access_token             TEXT NOT NULL,
    refresh_token            TEXT NOT NULL,
    token_expires_at         INTEGER NOT NULL,
    refresh_token_expires_at INTEGER NOT NULL,
    last_sync_at             INTEGER,
    sync_enabled             INTEGER NOT NULL DEFAULT 1,
    default_item_id          TEXT NOT NULL DEFAULT '1',
    created_at               INTEGER NOT NULL
);

CREATE TABLE qbo_entity_map (
    id             TEXT PRIMARY KEY,
    tenant_id      TEXT NOT NULL,
    oi_type        TEXT NOT NULL,
    oi_id          TEXT NOT NULL,
    qbo_type       TEXT NOT NULL,
    qbo_id         TEXT NOT NULL,
    qbo_sync_token TEXT NOT NULL,
    synced_at      INTEGER NOT NULL
);

CREATE TABLE qbo_sync_errors (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    oi_type     TEXT NOT NULL,
    oi_id       TEXT NOT NULL,
    error_code  TEXT NOT NULL,
    error_msg   TEXT NOT NULL,
    retries     INTEGER NOT NULL DEFAULT 0,
    resolved    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE TABLE rating_systems (
    id           TEXT    PRIMARY KEY,
    tenant_id    TEXT    NOT NULL,
    name         TEXT    NOT NULL,
    slug         TEXT    NOT NULL,
    description  TEXT,
    levels       TEXT    NOT NULL,            
    is_default   INTEGER NOT NULL DEFAULT 0,
    is_seed      INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    UNIQUE (tenant_id, slug)
);

CREATE TABLE recommendations (
  id                       TEXT    PRIMARY KEY,
  tenant_id                TEXT    NOT NULL,
  category                 TEXT,
  name                     TEXT    NOT NULL,
  severity                 TEXT    NOT NULL CHECK(severity IN ('satisfactory','monitor','defect')),
  default_estimate_min     INTEGER,
  default_estimate_max     INTEGER,
  default_repair_summary   TEXT    NOT NULL,
  created_by_user_id       TEXT,
  created_at               INTEGER NOT NULL
);

CREATE TABLE report_pdfs (
    id             TEXT PRIMARY KEY,
    tenant_id      TEXT NOT NULL,
    inspection_id  TEXT NOT NULL,
    type           TEXT NOT NULL CHECK (type IN ('summary', 'full')),
    r2_key         TEXT NOT NULL,
    rendered_at    INTEGER NOT NULL,
    source_version INTEGER NOT NULL,        
    size_bytes     INTEGER,
    status         TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('queued', 'rendering', 'ready', 'failed')),
    error          TEXT
);

CREATE TABLE report_versions (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    inspection_id   TEXT NOT NULL,
    version_number  INTEGER NOT NULL,
    snapshot_json   TEXT NOT NULL,
    summary         TEXT,
    published_at    INTEGER NOT NULL,
    published_by    TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (inspection_id, version_number)
);

CREATE TABLE services (
  id               TEXT    PRIMARY KEY,
  tenant_id        TEXT    NOT NULL REFERENCES tenants(id),
  name             TEXT    NOT NULL,
  description      TEXT,
  price            INTEGER NOT NULL,            
  duration_minutes INTEGER,
  template_id      TEXT REFERENCES templates(id),
  agreement_id     TEXT REFERENCES agreements(id),
  active           INTEGER NOT NULL DEFAULT 1,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL
);

CREATE TABLE signing_keys (
    tenant_id        TEXT PRIMARY KEY NOT NULL REFERENCES tenants(id),
    public_key       TEXT NOT NULL,
    private_key_enc  TEXT NOT NULL,
    private_key_iv   TEXT NOT NULL,
    fingerprint      TEXT NOT NULL,
    algorithm        TEXT NOT NULL DEFAULT 'Ed25519',
    created_at       INTEGER NOT NULL,
    rotated_at       INTEGER
);

CREATE TABLE slug_reservations (
    slug TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    blocked_at INTEGER NOT NULL
);

CREATE TABLE sync_outbox (
    id              TEXT PRIMARY KEY,
    event_type      TEXT NOT NULL,                       
    payload         TEXT NOT NULL,                       
    status          TEXT NOT NULL DEFAULT 'pending',     
    attempts        INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    last_tried_at   INTEGER,
    last_error      TEXT
);

CREATE TABLE tags (
  id          TEXT    PRIMARY KEY,
  tenant_id   TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  color       TEXT,
  is_seed     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE templates (
    id          TEXT    PRIMARY KEY,
    tenant_id   TEXT    NOT NULL REFERENCES tenants(id),
    name        TEXT    NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    schema      TEXT    NOT NULL,   
    created_at  INTEGER NOT NULL
, rating_system_id TEXT, property_type TEXT, commercial_subtype TEXT, description TEXT, featured INTEGER NOT NULL DEFAULT 0);

CREATE TABLE tenant_configs (
    tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
    site_name TEXT,
    primary_color TEXT,
    logo_url TEXT,
    support_email TEXT,
    billing_url TEXT,
    ga_measurement_id TEXT,
    updated_at INTEGER NOT NULL
, integration_config TEXT, secrets TEXT, ics_token TEXT, widget_allowed_origins TEXT, report_theme TEXT NOT NULL DEFAULT 'modern', attention_thresholds TEXT
    NOT NULL DEFAULT '{"agreement_unsigned_h":72,"invoice_overdue_h":72,"report_unpublished_h":72}', show_estimates INTEGER NOT NULL DEFAULT 0, enable_repair_list INTEGER NOT NULL DEFAULT 0, custom_referral_sources TEXT, dashboard_column_prefs TEXT, block_unpaid INTEGER NOT NULL DEFAULT 0, block_unsigned_agreement INTEGER NOT NULL DEFAULT 0, enable_customer_repair_export INTEGER NOT NULL DEFAULT 0, concierge_review_required INTEGER NOT NULL DEFAULT 0, enable_pdf_pipeline INTEGER NOT NULL DEFAULT 0, team_mode_default          INTEGER NOT NULL DEFAULT 0, apprentice_review_required INTEGER NOT NULL DEFAULT 0, guest_invites_enabled      INTEGER NOT NULL DEFAULT 1);

CREATE TABLE tenant_invites (
    id          TEXT    PRIMARY KEY,                    
    tenant_id   TEXT    NOT NULL REFERENCES tenants(id),
    email       TEXT    NOT NULL,
    role        TEXT    NOT NULL DEFAULT 'inspector',   
    status      TEXT    NOT NULL DEFAULT 'pending',     
    expires_at  INTEGER NOT NULL
, mentor_id            TEXT, assigned_section_ids TEXT NOT NULL DEFAULT '[]');

CREATE TABLE tenant_library_imports (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    library_id      TEXT NOT NULL,
    imported_semver TEXT NOT NULL,
    imported_at     TEXT NOT NULL,
    row_count       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tenant_marketplace_import_history (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    library_id      TEXT,                                        
    template_id     TEXT,                                        
    action          TEXT NOT NULL CHECK (action IN ('install','update','replace','migrate')),
    source_version  TEXT,                                        
    target_version  TEXT,                                        
    rows_affected   INTEGER NOT NULL DEFAULT 0,
    metadata        TEXT,                                        
    created_at      INTEGER NOT NULL,
    created_by      TEXT NOT NULL                                
);

CREATE TABLE tenant_marketplace_imports (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL,
  marketplace_template_id TEXT NOT NULL REFERENCES marketplace_templates(id),
  imported_semver         TEXT NOT NULL,
  local_template_id       TEXT NOT NULL REFERENCES templates(id),
  imported_at             TEXT NOT NULL
);

CREATE TABLE tenants (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    subdomain   TEXT    NOT NULL UNIQUE,
    tier        TEXT    NOT NULL DEFAULT 'free',        
    status      TEXT    NOT NULL DEFAULT 'pending',     
    max_users   INTEGER NOT NULL DEFAULT 5,
    created_at  INTEGER NOT NULL
, stripe_connect_account_id TEXT, deployment_mode TEXT NOT NULL DEFAULT 'shared', nachi_number   TEXT);

CREATE TABLE user_identity_links (
    id                  TEXT PRIMARY KEY,
    primary_user_id     TEXT NOT NULL,
    linked_user_id      TEXT NOT NULL,
    linked_tenant_id    TEXT NOT NULL,
    linked_role         TEXT NOT NULL,
    linked_display_name TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (primary_user_id, linked_user_id)
);

CREATE TABLE "users" (
    id                    TEXT    PRIMARY KEY,
    tenant_id             TEXT,                                  
    email                 TEXT    NOT NULL,
    password_hash         TEXT    NOT NULL,
    role                  TEXT    NOT NULL DEFAULT 'admin',
    created_at            INTEGER NOT NULL,
    google_refresh_token  TEXT,
    google_calendar_id    TEXT,
    name                  TEXT,
    phone                 TEXT,
    license_number        TEXT,
    google_access_token   TEXT,
    google_token_expiry   INTEGER,
    locale                TEXT,
    onboarding_state      TEXT,
    totp_secret           TEXT,
    totp_enabled          INTEGER NOT NULL DEFAULT 0,
    totp_recovery_codes   TEXT,
    totp_verified_at      INTEGER,
    slug                  TEXT,
    photo_url             TEXT,
    bio                   TEXT,
    service_areas         TEXT
, notify_on_referral INTEGER NOT NULL DEFAULT 1, notify_on_report   INTEGER NOT NULL DEFAULT 1, notify_on_paid     INTEGER NOT NULL DEFAULT 0, last_active_at INTEGER, mentor_id TEXT, assigned_section_ids TEXT NOT NULL DEFAULT '[]', expires_at INTEGER, signup_role TEXT);

CREATE INDEX apprentice_reviews_apprentice_idx   ON apprentice_reviews (apprentice_id, status);

CREATE INDEX apprentice_reviews_inspection_item_idx ON apprentice_reviews (inspection_id, item_id);

CREATE INDEX apprentice_reviews_mentor_status_idx ON apprentice_reviews (tenant_id, mentor_id, status);

CREATE UNIQUE INDEX discount_codes_code_tenant ON discount_codes(UPPER(code), tenant_id);

CREATE UNIQUE INDEX event_types_tenant_slug_idx ON event_types (tenant_id, slug);

CREATE INDEX guest_invites_tenant_idx ON guest_invites (tenant_id);

CREATE INDEX guest_invites_token_idx  ON guest_invites (token);

CREATE INDEX idx_agent_invites_email      ON agent_invites(email);

CREATE INDEX idx_agent_invites_expiration ON agent_invites(expires_at);

CREATE INDEX idx_agent_invites_tenant     ON agent_invites(tenant_id);

CREATE INDEX idx_agent_tenant_by_agent  ON agent_tenant_links(agent_user_id, status);

CREATE INDEX idx_agent_tenant_by_tenant ON agent_tenant_links(tenant_id, status);

CREATE UNIQUE INDEX idx_agent_tenant_unique   ON agent_tenant_links(agent_user_id, tenant_id);

CREATE INDEX idx_agreement_requests_inspection ON agreement_requests(inspection_id);

CREATE INDEX idx_agreement_requests_tenant ON agreement_requests(tenant_id);

CREATE INDEX idx_agreement_requests_token ON agreement_requests(token);

CREATE INDEX idx_agreements_tenant       ON agreements(tenant_id);

CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);

CREATE INDEX idx_audit_tenant_created ON audit_logs(tenant_id, created_at DESC);

CREATE INDEX idx_automation_logs_insp    ON automation_logs(inspection_id);

CREATE INDEX idx_automation_logs_pending ON automation_logs(tenant_id, status, send_at);

CREATE INDEX idx_automations_tenant ON automations(tenant_id);

CREATE INDEX idx_avail_overrides_insp    ON availability_overrides(inspector_id);

CREATE INDEX idx_availability_inspector  ON availability(inspector_id);

CREATE INDEX idx_comments_library_id ON comments(library_id);

CREATE INDEX idx_comments_rating_bucket ON comments(tenant_id, rating_bucket);

CREATE INDEX idx_comments_tenant ON comments(tenant_id);

CREATE INDEX idx_concierge_tokens_expiry ON concierge_confirm_tokens(expires_at);

CREATE INDEX idx_contacts_tenant ON contacts(tenant_id);

CREATE INDEX idx_contacts_type ON contacts(tenant_id, type);

CREATE INDEX idx_discount_codes_tenant  ON discount_codes(tenant_id);

CREATE UNIQUE INDEX idx_esign_audit_logs_event_dedup ON esign_audit_logs(tenant_id, request_id, event)
    WHERE event IN ('agreement.signed', 'workflow.complete');

CREATE INDEX idx_esign_audit_logs_request ON esign_audit_logs(tenant_id, request_id, created_at);

CREATE INDEX idx_insp_agreements_insp    ON inspection_agreements(inspection_id);

CREATE INDEX idx_insp_agreements_tenant  ON inspection_agreements(tenant_id);

CREATE INDEX idx_insp_services_insp   ON inspection_services(inspection_id);

CREATE INDEX idx_insp_services_tenant ON inspection_services(tenant_id);

CREATE INDEX idx_inspection_requests_email
    ON inspection_requests(tenant_id, client_email);

CREATE INDEX idx_inspection_requests_tenant
    ON inspection_requests(tenant_id, status, scheduled_at);

CREATE INDEX idx_inspections_agent ON inspections(referred_by_agent_id);

CREATE INDEX idx_inspections_inspector   ON inspections(inspector_id);

CREATE UNIQUE INDEX idx_inspections_msg_token ON inspections(message_token);

CREATE INDEX idx_inspections_request ON inspections(request_id);

CREATE INDEX idx_inspections_status      ON inspections(status);

CREATE INDEX idx_inspections_tenant      ON inspections(tenant_id);

CREATE INDEX idx_invites_tenant ON tenant_invites(tenant_id);

CREATE INDEX idx_invoices_contact ON invoices(tenant_id, contact_id);

CREATE INDEX idx_invoices_inspection ON invoices(inspection_id);

CREATE INDEX idx_invoices_tenant ON invoices(tenant_id);

CREATE INDEX idx_marketplace_history_library
    ON tenant_marketplace_import_history(library_id);

CREATE INDEX idx_marketplace_history_template
    ON tenant_marketplace_import_history(template_id);

CREATE INDEX idx_marketplace_history_tenant
    ON tenant_marketplace_import_history(tenant_id, created_at DESC);

CREATE INDEX idx_marketplace_libraries_kind_featured
    ON marketplace_libraries(kind, featured);

CREATE INDEX idx_media_pool_inspection ON inspection_media_pool(inspection_id);

CREATE INDEX idx_media_pool_tenant     ON inspection_media_pool(tenant_id);

CREATE INDEX idx_mkt_imports_tenant ON tenant_marketplace_imports(tenant_id);

CREATE INDEX idx_mkt_imports_tmpl   ON tenant_marketplace_imports(marketplace_template_id);

CREATE INDEX idx_msg_inspection ON customer_messages(inspection_id, created_at);

CREATE INDEX idx_msg_unread     ON customer_messages(tenant_id, inspection_id, from_role) WHERE read_at IS NULL;

CREATE INDEX idx_notifications_tenant_user_created
    ON notifications (tenant_id, user_id, created_at DESC);

CREATE INDEX idx_notifications_tenant_user_unread
    ON notifications (tenant_id, user_id, read_at)
    WHERE read_at IS NULL AND archived_at IS NULL;

CREATE UNIQUE INDEX idx_qbo_entity_map_oi
    ON qbo_entity_map(tenant_id, oi_type, oi_id);

CREATE UNIQUE INDEX idx_qbo_entity_map_qbo
    ON qbo_entity_map(tenant_id, qbo_type, qbo_id);

CREATE INDEX idx_rating_systems_tenant
    ON rating_systems(tenant_id);

CREATE INDEX idx_recommendations_tenant          ON recommendations(tenant_id);

CREATE INDEX idx_recommendations_tenant_category ON recommendations(tenant_id, category);

CREATE INDEX idx_report_pdfs_status ON report_pdfs(status) WHERE status IN ('queued', 'rendering');

CREATE INDEX idx_report_pdfs_tenant ON report_pdfs(tenant_id);

CREATE INDEX idx_results_inspection      ON inspection_results(inspection_id);

CREATE INDEX idx_results_tenant          ON inspection_results(tenant_id);

CREATE INDEX idx_services_tenant ON services(tenant_id);

CREATE INDEX idx_sync_outbox_status_created
    ON sync_outbox(status, created_at)
    WHERE status = 'pending';

CREATE INDEX idx_tag_links_inspection_item   ON inspection_item_tag_links(inspection_id, item_id);

CREATE INDEX idx_tag_links_tag               ON inspection_item_tag_links(tag_id);

CREATE INDEX idx_tag_links_tenant            ON inspection_item_tag_links(tenant_id);

CREATE INDEX idx_tags_tenant ON tags(tenant_id);

CREATE INDEX idx_templates_rating_system
    ON templates(rating_system_id);

CREATE INDEX idx_tenant_library_imports_tenant
    ON tenant_library_imports(tenant_id);

CREATE INDEX idx_users_email ON users(email);

CREATE UNIQUE INDEX idx_users_slug_per_tenant
    ON users(tenant_id, slug)
    WHERE slug IS NOT NULL AND tenant_id IS NOT NULL;

CREATE INDEX idx_users_tenant ON users(tenant_id);

CREATE INDEX inspection_events_inspection_idx ON inspection_events (inspection_id);

CREATE INDEX inspection_events_scheduled_idx  ON inspection_events (tenant_id, scheduled_at);

CREATE INDEX inspection_units_parent_idx ON inspection_units (parent_unit_id);

CREATE INDEX inspection_units_tenant_inspection_idx ON inspection_units (tenant_id, inspection_id);

CREATE INDEX observer_links_inspection_idx ON observer_links (inspection_id);

CREATE INDEX observer_links_token_idx ON observer_links (token);

CREATE INDEX report_versions_inspection_idx ON report_versions (inspection_id, version_number);

CREATE UNIQUE INDEX uq_report_pdfs_inspection_type ON report_pdfs(inspection_id, type);

CREATE UNIQUE INDEX uq_tenant_library_import
    ON tenant_library_imports(tenant_id, library_id);

CREATE INDEX user_identity_links_primary_idx ON user_identity_links (primary_user_id);

CREATE UNIQUE INDEX users_tenant_email_unique ON users(tenant_id, email);


-- Google Calendar OAuth tokens per inspector, Stripe Connect per tenant

ALTER TABLE users   ADD COLUMN google_refresh_token TEXT;
ALTER TABLE users   ADD COLUMN google_calendar_id   TEXT;
ALTER TABLE tenants ADD COLUMN stripe_connect_account_id TEXT;

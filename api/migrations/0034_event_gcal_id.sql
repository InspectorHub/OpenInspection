-- Spec 4D polish — persist Google Calendar event ID per inspection_event
-- so subsequent status changes (cancelled / rescheduled) can PATCH/DELETE
-- the right remote entry instead of duplicating.
ALTER TABLE inspection_events ADD COLUMN gcal_event_id TEXT;

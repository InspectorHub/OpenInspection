-- Migration: 0017_comments_severity
-- Adds severity column to comments table for inspection comment library.
ALTER TABLE comments ADD COLUMN severity TEXT;

-- Add profile fields to users table
ALTER TABLE users ADD COLUMN name TEXT;
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN license_number TEXT;

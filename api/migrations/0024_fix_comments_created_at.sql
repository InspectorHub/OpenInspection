-- Fix `comments.created_at` rows that were seeded with millisecond timestamps
-- into a `{mode: 'timestamp'}` (seconds) column, producing dates in year ~58296
-- when Drizzle reads them back. Any value above 9999999999 (year 2286 in
-- seconds) is unambiguously a millisecond timestamp — divide by 1000.
UPDATE comments SET created_at = created_at / 1000 WHERE created_at > 9999999999;

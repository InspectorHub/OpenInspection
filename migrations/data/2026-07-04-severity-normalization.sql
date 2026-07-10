-- Pre-launch one-shot: fold the retired rating_bucket vocabulary into the
-- canonical severity column on comments. rating_bucket stays FROZEN (DEAD) —
-- see server/lib/db/schema/inspection/comments.ts. This is a DATA migration,
-- run manually pre-launch against local/remote D1 per the D1 migration SOP
-- (docs/saas-ops/d1-migration-sop.md) — it is NOT tracked by drizzle-kit and
-- must NOT be added to migrations/0000_baseline.sql or a numbered migration.
--
-- Also normalizes any legacy severity values recommendation.service wrote in
-- the old satisfactory/monitor/defect words before module F.
UPDATE comments SET severity = 'good'        WHERE severity IS NULL AND rating_bucket = 'satisfactory';
UPDATE comments SET severity = 'marginal'    WHERE severity IS NULL AND rating_bucket = 'monitor';
UPDATE comments SET severity = 'significant' WHERE severity IS NULL AND rating_bucket = 'defect';
UPDATE comments SET severity = 'minor'       WHERE severity IS NULL AND rating_bucket = 'na';
UPDATE comments SET severity = 'good'        WHERE severity = 'satisfactory';
UPDATE comments SET severity = 'marginal'    WHERE severity = 'monitor';
UPDATE comments SET severity = 'significant' WHERE severity = 'defect';

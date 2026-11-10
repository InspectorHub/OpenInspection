-- Data-only repair, no DDL. Some `templates.schema` values were written as a JSON
-- string literal wrapping the template document (`"{\"title\":...}"`, json_type 'text')
-- instead of the document itself (json_type 'object'). Unwrap exactly those rows.
-- json_type raises on invalid JSON, so each probe is guarded by json_valid and the
-- guards are CASE expressions rather than relying on AND evaluation order.
-- Rows that are already objects, doubly wrapped, or not JSON are left untouched, and the
-- statement is idempotent: once unwrapped a row no longer matches.
UPDATE `templates`
SET `schema` = json_extract(`schema`, '$')
WHERE CASE WHEN json_valid(`schema`) THEN json_type(`schema`) END = 'text'
  AND CASE WHEN json_valid(json_extract(`schema`, '$'))
           THEN json_type(json_extract(`schema`, '$')) END = 'object';

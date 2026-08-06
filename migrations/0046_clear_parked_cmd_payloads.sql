-- Data-only. Clear command payloads parked BEFORE the fingerprint change (#276).
--
-- Both parking paths used to store the message itself, and `cmd.tenant.update`
-- carries `adminPasswordHash` on password-change commands, so any row written
-- before that change may hold an admin credential. Fixing the writer stops new
-- rows; it does not touch the ones already there.
--
-- The ROW survives with its id / reason / received_at, which is the signal a
-- dead-letter row actually carries ("something parked, then, for that reason").
-- Only the payload goes. `envelope` is NOT NULL, so it is replaced rather than
-- nulled, and the replacement is shaped like a fingerprint so a reader never
-- meets two formats. Idempotent: re-running writes the same value.
UPDATE parked_cmd_events
SET envelope = '{"v":1,"cleared":"payload removed; parked before the fingerprint change"}'
WHERE envelope NOT LIKE '{"v":1,%';

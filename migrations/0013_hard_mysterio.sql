ALTER TABLE `inspections` ADD `referred_by_contact_id` text;--> statement-breakpoint
-- Backfill from the buyer_agent seat: today's referral leaderboard IS this
-- join, so the cutover to the explicit column is numerically identical rather
-- than approximately so. A row with no buyer_agent stays NULL — unattributed.
UPDATE inspections SET referred_by_contact_id = (
  SELECT ip.contact_id FROM inspection_people ip
  JOIN contact_role_profiles crp ON crp.id = ip.role_profile_id
  WHERE ip.inspection_id = inspections.id AND crp.key = 'buyer_agent' AND crp.is_active = 1
  LIMIT 1
) WHERE referred_by_contact_id IS NULL;

#!/usr/bin/env node
/**
 * Verification-copy policy gate — review rulings 16C / 17a-17c (2026-08-15),
 * extended by review (2026-08-17).
 *
 * A verification surface may state what the system actually checked and what
 * that check established. It may NOT convert an integrity result into a
 * conclusion about human authorship, identity, intent, consent, or legal
 * validity; and where a check fails it must describe the failed check rather
 * than characterise the signature, signer, document or legal effect as invalid.
 *
 * ── This is a Global Core control, not a regional overlay ───────────────────
 * review promoted it and named it: **Verification Claim Integrity**. The
 * rule is written down here because it is load-bearing under FOUR regimes at
 * once, none of which is a single jurisdiction's overlay:
 *
 *   1. FTC Act §5            — a deceptive claim about what a product verified.
 *   2. State UDAP statutes   — the same claim, actionable state by state.
 *   3. Contract expectation  — we told the customer the check proved X.
 *   4. Evidentiary integrity — an overclaim in the product undermines the very
 *                              record it decorates when the record is produced.
 *
 * So this gate does NOT go away if a regional overlay goes out of scope. It is
 * written here in the positive because the failure mode is a future reader
 * deleting a control they took for a leftover of some other regime's rules.
 *
 * This exists because the rule is forward-looking. The two strings that
 * prompted it ("Signature Verified" / "Invalid Signature") are gone, but
 * review named the disguises the same claim reappears in — "Identity
 * Verified", "Consent Verified", "Agreement Validated", "Legally Binding",
 * "Verified Document", and (review) "Authentic Signature", "Genuine
 * Signature", "Valid Signature", "Legally Valid Signature", "Signer Verified",
 * "Authorized Signature", "Confirmed by [person]" and "Signed by [person]" —
 * and a policy document does not stop any of them landing in a catalogue.
 *
 * What IS permitted is the claim narrowed to the check that ran: "Signature
 * image integrity check passed", or more precisely "The stored signature image
 * matches the signature image fingerprint recorded at signing." A disclaimer
 * does not rescue an over-broad claim — narrow the claim.
 *
 * Scope is deliberately the MESSAGE CATALOGUES, every locale. The finding that
 * started this was that the wording had already been translated, and the
 * translation stated the claim more flatly than the English did.
 *
 * Usage: node scripts/check-verification-copy.mjs [--self-test]
 *
 * Policy: docs/develop/verification-copy-policy.md
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MESSAGES = 'messages';

/**
 * Each rule is a claim we are not entitled to make, not a string we dislike.
 * `why` is printed on a hit, because a gate that only says "banned" teaches
 * nobody why and gets worked around with a synonym.
 */
const BANNED = [
  { re: /\b(signature|firma)s?\s+(verified|verificada|validated|validada)\b/i,
    why: 'asserts a signature was verified — the check establishes record integrity, not who signed' },
  { re: /\b(invalid|inválida|no\s+válida)\s+(signature|firma)\b|\b(signature|firma)\s+(is\s+|sea\s+|es\s+)?(invalid|inválida|no\s+válida)\b/i,
    why: 'calls a signature invalid — a failed check can mean a rotated key, not a bad signature' },
  { re: /\b(identity|identidad)\s+(verified|verificada)\b/i,
    why: 'asserts identity was verified — integrity checks establish no such thing' },
  { re: /\b(consent|consentimiento)\s+(verified|verificado)\b/i,
    why: 'asserts consent was verified — nothing in the chain establishes intent' },
  { re: /\b(agreement|acuerdo|contrato)\s+(validated|validado|verified|verificado)\b/i,
    why: 'asserts the agreement itself was validated — legal effect is not a cryptographic result' },
  { re: /\blegally\s+binding\b|\blegalmente\s+vinculante\b/i,
    why: 'asserts legal effect, which depends on applicable law and not on this product' },
  { re: /\b(verified|verificado)\s+(document|documento)\b|\b(document|documento)\s+(verified|verificado)\b/i,
    why: 'labels a document as verified — on a page that ran no check this states a result never computed' },

  // ── review. Eight more disguises, each with the same shape: an integrity
  //    result restated as a fact about a human, a mark, or a legal outcome. ──

  { re: /\b(authentic|genuine)\s+(signature|firma)\b|\b(signature|firma)\s+(is\s+|es\s+|sea\s+)?(authentic|genuine|auténtica|genuina)\b/i,
    why: 'calls a signature authentic or genuine — the chain establishes that the stored record is unaltered, never that a particular human produced the mark' },
  { re: /\b(legally\s+)?valid\s+(signature|firma)\b|\bfirma\s+(legalmente\s+)?válida\b/i,
    why: 'calls a signature valid — validity is a legal conclusion about execution, not the output of a hash comparison' },
  { re: /\b(signer|firmante)s?\s+(verified|verificad[oa]s?)\b|\bverified\s+signers?\b/i,
    why: 'asserts the signer was verified — we authenticate a link, not a person; nothing in the chain identifies who held the device' },
  { re: /\bauthori[sz]ed\s+(signature|firma)\b|\bfirma\s+autorizada\b/i,
    why: 'asserts the signature was authorized — authority to bind is a fact about the signer\'s relationship to a party, which this product never checks' },
  { re: /\b(signed|confirmed)\s+by\s+\{|\b(firmado|confirmado)\s+por\s+\{/i,
    why: 'attributes the act to a named person — interpolating an identity turns "someone with this link acted" into "this individual acted"' },
];

/**
 * A DENIAL of the claim is the opposite of making it, and the denial contains
 * the words. "…does not constitute a legally binding agreement" and "this does
 * not establish that the signature is invalid" are both exactly what review
 * asked us to write — and the first version of this gate flagged both, which
 * would have pressured an author to delete the disclaimer to get to green.
 *
 * So a match counts only when the CLAUSE it sits in is not negated. Clause and
 * not string: one sentence may disclaim while the next asserts.
 */
const NEGATORS = /\b(do(?:es)?\s+not|did\s+not|cannot|can't|is\s+not|isn't|are\s+not|aren't|never|neither|nor|without|no\s+constituye|no\s+establece|no\s+implica|no\s+significa|tampoco)\b/i;

const clausesOf = (text) => text.split(/(?<=[.;:!?])\s+|\s+—\s+|\n+/);

function scanValue(v) {
  const out = [];
  for (const clause of clausesOf(v)) {
    if (NEGATORS.test(clause)) continue;   // a denial is not an assertion
    for (const rule of BANNED) if (rule.re.test(clause)) out.push(rule);
  }
  return out;
}

/**
 * The gate must be able to fail, and must be able NOT to fail.
 *
 * `MUST_FLAG` is the claim in each disguise review named. `MUST_NOT_FLAG` is
 * the careful wording those disguises get replaced with — including the two
 * real strings the negation-blind first version flagged. A pattern that drifts
 * in either direction turns a clean scan into a false green, and the second
 * direction is the expensive one: a gate that punishes the disclaimer teaches
 * people to remove the disclaimer.
 *
 * ── review added eight claims, and every one of them reuses an ordinary
 *    product word. So each new rule below carries a REAL string from these
 *    catalogues as its negative control, and the three that needed narrowing
 *    say so here, because the narrowing is the whole design: ──
 *
 *  - "valid" is everywhere ("Enter a valid email", "Confirmation links are
 *    valid for 7 days", "Connected — key is valid"). The rule is the ADJECTIVAL
 *    form only — `valid signature` / `firma válida`. The PREDICATE form is
 *    deliberately NOT banned, because review already approved "Audit chain is
 *    intact and Ed25519 signatures are valid": there the subject is the
 *    cryptographic signature and the claim is exactly the check that ran.
 *  - "authorized" ships in "Authorized representative", "Authorize access", and
 *    the whole connected-apps surface. The rule requires the word to land on
 *    the noun `signature` / `firma`.
 *  - "Signed by" / "Firmado por" are REAL CAPTIONS in this repository — the
 *    printable agreement and the PCA report both use them as a bare field label
 *    over a rendered image. A caption is not a claim. review prohibition is
 *    written "[person]", and the attribution only exists once an identity is
 *    interpolated, so the rule requires the placeholder that supplies it.
 *
 * "authentic" and "genuine" appear in neither catalogue in any form, so those
 * two rules carry no negative control of their own; there is nothing real to
 * protect and inventing one would only test the invention.
 */
const MUST_FLAG = [
  'Signature Verified', 'Invalid Signature', 'Firma verificada', 'Firma no válida',
  'Identity Verified', 'Consent Verified', 'Agreement Validated', 'Legally Binding',
  'Verified Document', 'Documento verificado',
  'Authentic Signature', 'Genuine Signature', 'Valid Signature', 'Legally Valid Signature',
  'Signer Verified', 'Authorized Signature', 'Confirmed by {name}', 'Signed by {signerName}',
  // The translated form of each, because the finding that started this gate was
  // that only the translation stated the claim flatly.
  'Firma auténtica', 'Firma válida', 'Firma legalmente válida',
  'Firmante verificado', 'Firma autorizada', 'Firmado por {signerName}',
];
const MUST_NOT_FLAG = [
  'Signing Record Verified',
  'Verification Could Not Be Completed',
  'Audit chain is intact and Ed25519 signatures are valid.',
  'This does not by itself establish that the signature is invalid or that the signer did not sign.',
  'This list does not constitute a legally binding agreement.',
  'Esta lista no constituye un acuerdo legalmente vinculante.',
  'Esto no establece por sí solo que la firma sea inválida.',
  // review approved narrow wording (review). Highest false-positive cost
  // in the file: flagging these would push an author back to the broad claim.
  'Signature image integrity check passed',
  'The stored signature image matches the signature image fingerprint recorded at signing.',
  // Real strings from these catalogues. Each one is the ordinary product use of
  // a word one of the review rules bans, and is why that rule is narrow.
  'Signed by',                                                    // en/checkout.json agreement_printable_signed_by
  'Inspected & Signed By',                                        // en/pca-report.json pca_signature_signed_by
  'Firmado por',                                                  // es-419/checkout.json agreement_printable_signed_by
  'Inspeccionado y firmado por',                                  // es-419/pca-report.json pca_signature_signed_by
  'Confirmation links are valid for 7 days. Your agent or inspector can send you a fresh one in a minute.',
  'This payment link is no longer valid. Open the link from your inspector\'s email, or ask them to send you a new one.',
  'Connected — key is valid',                                     // en/settings-components.json settings_ai_key_valid
  'Ingrese un correo electrónico válido',                         // es-419/validation.json validation_contact_email_invalid
  'This signer is no longer awaiting signature.',                 // en/checkout.json agreement_signers_remind_terminal
  'A signer signed',                                              // en/labels.json label_trigger_agreement_signer_signed
  'Authorized representative *',                                  // en/settings-components.json settings_mcw_rep_name_label
  'MCP clients (e.g. Claude) you\'ve authorized to access your data. Revoke access at any time.',
  'Could not complete Google Calendar authorization. Please try again.',
  'Pick a date and we\'ll confirm by email.',                     // en/booking.json booking_embed_confirm_by_email
  'Inspection confirmed — {address}',                             // en/communication.json comm_notice_title_inspection_confirmed
  'Confirmed: {name} contains your cancellation clause.',         // en/settings-components.json settings_cancellation_clause_attested
  'Use this link anytime to confirm this signature hasn\'t been altered.',
];

const missed = MUST_FLAG.filter((s) => scanValue(s).length === 0);
const overreach = MUST_NOT_FLAG.filter((s) => scanValue(s).length > 0);
if (missed.length || overreach.length) {
  console.error('\n[verification-copy] BROKEN — the gate failed its own self-test.');
  for (const m of missed) console.error(`   should have flagged: ${JSON.stringify(m)}`);
  for (const o of overreach) console.error(`   wrongly flagged:     ${JSON.stringify(o)}`);
  console.error('\nA pattern drifted. Until it is fixed, a clean scan means nothing.\n');
  process.exit(1);
}

// The self-test runs before every normal run (above) AND is addressable on its
// own, so a pattern change can be checked without a catalogue present.
if (process.argv.slice(2).includes('--self-test')) {
  console.log(`\n[verification-copy] self-test OK — ${BANNED.length} rule(s), ` +
              `${MUST_FLAG.length} must-flag + ${MUST_NOT_FLAG.length} must-not-flag, all correct.\n`);
  process.exit(0);
}

let files = 0, strings = 0;
const hits = [];
for (const locale of readdirSync(MESSAGES, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const dir = join(MESSAGES, locale.name);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    files++;
    const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== 'string') continue;
      strings++;
      for (const rule of scanValue(value)) hits.push({ locale: locale.name, file: f, key, value, why: rule.why });
    }
  }
}

// Both numbers, always. A gate that prints only its verdict cannot be checked
// on the day it is green.
console.log(`\n[verification-copy] ${strings} string(s) in ${files} catalogue file(s); ${BANNED.length} rule(s); ` +
            `self-test ${MUST_FLAG.length} must-flag + ${MUST_NOT_FLAG.length} must-not-flag, all correct.`);

// Zero scanned is a hard failure, never a pass. This gate EXPECTS zero hits
// forever, so "0 problems" and "looked at nothing" print the same verdict — and
// the catalogues are a generated tree that a build step can empty.
if (files === 0 || strings === 0) {
  console.error(`\n[verification-copy] Scanned ${files} file(s) / ${strings} string(s) under ${MESSAGES}/.`);
  console.error('A scan of nothing is not a clean scan. The gate is looking in the wrong place.\n');
  process.exit(1);
}

if (hits.length) {
  console.error(`\n${hits.length} string(s) state a conclusion the verification does not establish:\n`);
  for (const h of hits) {
    console.error(`   ${h.locale}/${h.file} -> ${h.key}`);
    console.error(`     "${h.value}"`);
    console.error(`     ${h.why}\n`);
  }
  console.error('review rulings 16C / 17a-17c: state what was checked and what it found.');
  console.error('See docs/develop/verification-copy-policy.md\n');
  process.exit(1);
}

console.log('[verification-copy] OK — no surface converts an integrity result into a conclusion.\n');

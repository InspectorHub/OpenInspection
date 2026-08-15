#!/usr/bin/env node
/**
 * Verification-copy policy gate — counsel rulings 16C / 17a-17c (2026-08-15).
 *
 * A verification surface may state what the system actually checked and what
 * that check established. It may NOT convert an integrity result into a
 * conclusion about human authorship, identity, intent, consent, or legal
 * validity; and where a check fails it must describe the failed check rather
 * than characterise the signature, signer, document or legal effect as invalid.
 *
 * This exists because the rule is forward-looking. The two strings that
 * prompted it ("Signature Verified" / "Invalid Signature") are gone, but
 * counsel named the disguises the same claim reappears in — "Identity
 * Verified", "Consent Verified", "Agreement Validated", "Legally Binding" —
 * and a policy document does not stop any of them landing in a catalogue.
 *
 * Scope is deliberately the MESSAGE CATALOGUES, every locale. The finding that
 * started this was that the wording had already been translated, and the
 * translation stated the claim more flatly than the English did.
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
];

/**
 * A DENIAL of the claim is the opposite of making it, and the denial contains
 * the words. "…does not constitute a legally binding agreement" and "this does
 * not establish that the signature is invalid" are both exactly what counsel
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
 * `MUST_FLAG` is the claim in each disguise counsel named. `MUST_NOT_FLAG` is
 * the careful wording those disguises get replaced with — including the two
 * real strings the negation-blind first version flagged. A pattern that drifts
 * in either direction turns a clean scan into a false green, and the second
 * direction is the expensive one: a gate that punishes the disclaimer teaches
 * people to remove the disclaimer.
 */
const MUST_FLAG = [
  'Signature Verified', 'Invalid Signature', 'Firma verificada', 'Firma no válida',
  'Identity Verified', 'Consent Verified', 'Agreement Validated', 'Legally Binding',
  'Verified Document', 'Documento verificado',
];
const MUST_NOT_FLAG = [
  'Signing Record Verified',
  'Verification Could Not Be Completed',
  'Audit chain is intact and Ed25519 signatures are valid.',
  'This does not by itself establish that the signature is invalid or that the signer did not sign.',
  'This list does not constitute a legally binding agreement.',
  'Esta lista no constituye un acuerdo legalmente vinculante.',
  'Esto no establece por sí solo que la firma sea inválida.',
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

if (hits.length) {
  console.error(`\n${hits.length} string(s) state a conclusion the verification does not establish:\n`);
  for (const h of hits) {
    console.error(`   ${h.locale}/${h.file} -> ${h.key}`);
    console.error(`     "${h.value}"`);
    console.error(`     ${h.why}\n`);
  }
  console.error('Counsel rulings 16C / 17a-17c: state what was checked and what it found.');
  console.error('See docs/develop/verification-copy-policy.md\n');
  process.exit(1);
}

console.log('[verification-copy] OK — no surface converts an integrity result into a conclusion.\n');

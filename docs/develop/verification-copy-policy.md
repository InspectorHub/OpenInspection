# Verification-copy policy

What a verification surface is allowed to say.

This is a legal constraint with a gate behind it, not a style guide. It comes
from external review rulings 16C and 17a–17c (2026-08-15) and it binds product
copy, not only internal documents. `npm run lint:verification-copy` enforces the
part of it that a machine can check.

---

## The two rules

**Success.** A verification surface may state only the integrity properties the
verification process actually established. It must not imply that the
verification establishes human authorship, identity, intent, consent, or legal
validity unless the system actually establishes that proposition.

**Failure.** When verification fails or cannot be completed, describe the failed
verification condition. Do not characterise the signature, the signer, the
document, or its legal effect as invalid. Where the system knows of benign
causes that can produce the failure, the wording must not imply that alteration
or invalidity is the only explanation.

Consumer-facing wording is held to a **stricter** standard than internal
technical wording, not a looser one. An auditor knows what a hash chain is. A
homebuyer reading "Signature Verified" reasonably hears *this platform confirms
this person signed*, which is a proposition no hash establishes.

## What our verification actually establishes

The e-sign audit chain seals, per event, a SHA-256 of the signature image
alongside the signer's identity, the time, the channel, the IP and the user
agent; rows are hash-linked and Ed25519-signed with the company's key.

That establishes **integrity and provenance**: the record has not been altered
since it was written, and the stored image is the one whose fingerprint was
sealed at signing.

It does not establish **authorship**. A SHA-256 does not know who drew the line.
Who signed is answered by the whole record together — identity, account, event,
timestamp, IP, user agent, channel, image, image hash, chain integrity, document
context — and, ultimately, by a tribunal applying the relevant law.

## The failure case has a benign cause we know about

The original one is now fixed, and the rule outlived it.

**What it was.** `verifyChain` verified every row against the tenant's *current*
signing key, while each row recorded the key it was actually sealed with
(`esign_audit_logs.key_fingerprint`) and the verifier never read it. Rotating a
company's key would therefore have failed every earlier chain — a genuine
signature by a real person failing today's check for a reason having nothing to
do with that person. That is why the failure rule exists, and why "Invalid
Signature" was the more urgent of the two strings that prompted this policy.

**What changed (2026-08-15).** review decision asked that this be remediated
in engineering rather than folded into a copy change, and it now has been.
`signing_keys` is a key history, retiring a key keeps its public half, and both
verifiers resolve the key named by the row they are checking. Rotation no longer
breaks anything, and there is an owner-only endpoint for it.

**Why the rule stands anyway.** A check can still fail to complete for causes
that say nothing about the signer — a key genuinely absent from the history
reports as `key_mismatch`, and hash and chain failures have their own causes.
The principle was never "rotation specifically"; it is that a verification
surface reports what its check established and no more.

One consequence to put to review rather than act on: the failure copy still
offers "the key may have changed" as the reassuring explanation, and that
particular cause no longer produces a failure. The sentence is not false — it
says *may* — but it now points at the least likely reason. The wording is
review-approved and is not being changed here on our own initiative.

## Applied

| surface | says |
|---|---|
| `/verify/:envelopeId` heading | "Verify Signature" — an action, not a result. review ruled this may stay. |
| success | "Signing Record Verified" + what that does and does not establish |
| failure | "Verification Could Not Be Completed" + that it does not establish the signature is invalid, and that the key may have changed |
| `/v/:token` | "Audit chain is intact and Ed25519 signatures are valid." |
| report verifier | "Report integrity verified" / "could not be verified. The content **may** have been altered." |
| offline verifier | "All {n} chain events verified." |
| certificate of completion | facts only — signer roster, event count, key fingerprint, timestamped event hashes. No conclusion. |
| PCA report block | "Document Verification" — a section label. It was "Verified Document", which asserted a result on a page that runs no check. |

review instruction was to unify **the rule, not the sentences**. Five of these
were already right and were left alone.

## The gate

`scripts/check-verification-copy.mjs`, in `npm run lint`.

It scans every message catalogue in every locale — the finding that started this
was that the wording had already been translated, and the Spanish stated the
claim more flatly than the English did.

Two things about it are deliberate:

- **It is negation-aware.** "…does not constitute a legally binding agreement"
  and "…does not establish that the signature is invalid" are exactly what
  review asked us to write, and both contain a banned phrase. The first version
  of the gate flagged them, which would have pressured an author to delete the
  disclaimer to get to green. A match counts only when the clause is not negated.
- **Its self-test runs both ways.** Ten known-bad strings must be flagged and
  seven careful ones must not. A regex that drifts in either direction turns a
  clean scan into a false green, and the second direction is the expensive one.

The banned list includes disguises that do not exist in the product yet —
"Identity Verified", "Consent Verified", "Agreement Validated", "Legally
Binding". review named them as the same claim wearing different clothes, and a
policy document does not stop any of them landing in a catalogue.

## When you need to say something this policy does not cover

Do not reason it out from the rules above. The rules describe a boundary that
was drawn by review on specific facts about this system; a new claim needs a new
ruling. Raise it as a review round — the series lives in the superproject at
`[redacted]`.

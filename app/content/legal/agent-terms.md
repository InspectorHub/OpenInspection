# Agent Terms

<!--
COUNSEL-READY v3 — rounds 29 and 31 landed. NOT APPROVED FOR PUBLICATION.

Round 29 verdict: keep the skeleton, do not publish. Draft quality 7/10, contract
architecture 8.5/10, blocking §1 · §7 · §11 · §14 (numbered against the previous
15-section draft). This revision lands every P0 and P1 from that round as clause
text and restructures to the 18 sections counsel set out. The archived ruling is
`docs/legal/2026-08-17-counsel-round-29-response.md` in the superproject and it,
not this file, is the binding text.

v2 resolved nine of v1's ten decision points against researched practice. v3 lands
round 31, which reviewed v1 rather than v2 — and three of its five P0s were already
closed by then (the transaction-purpose use test, the no-reliance restructure, and
the deletion of "we are only the delivery path").

Round 31 caught one thing v2 had WRONG rather than missing: §10 asserted the
acceptance record holds the IP address and country, while the code note in the same
paragraph showed `ip?` and `country?` — optional. It now says "where collected".
A clause contradicting the code reference printed beside it is the failure this
document's whole method is supposed to prevent, and it survived two drafts.

Still not publishable, and for TWO reasons now — §17 was never the only one:

**(a) §12/§15 retention.** Round 13 approved no retention windows. A clause pointing
at the Privacy Notice for what is kept must not imply the period is settled, and
until the retention model is final this document cannot go live whatever else is
resolved. Round 31 §15 is explicit: 这里必须等 retention model final.

**(b) §17 needs the operating entity's jurisdiction, and there is no entity.** The operator is an
individual with no company, so no US state's law can be named honestly, and a
governing-law clause that cannot hold is worse than none — it fails exactly when
it is needed and shows we wrote it knowing. That is not a drafting problem and no
amount of drafting fixes it.

Agent signup stays closed until it resolves, which costs nothing: the refusal is
already the shipped behaviour and it is what round 24c asked for. Every remaining
`{{PLACEHOLDER}}` is that same decision wearing a different name, and
`npm run agent-terms:publish` refuses any body still carrying one.

Written to be reviewed against BEHAVIOUR. Factual clauses carry the code they were
read off, so a reviewer can check the claim rather than take it. Where a clause and
the code disagree, the code is what is true: fix the clause, or fix the code and
say which. Counsel valued this and it stays.

This is the OPERATOR's document. OpenInspection is deployed by whoever runs it, so
the operator's name, contact and law are per-deployment and must never be hardcoded
to one company.

The decision points at the end are now DOWN TO ONE, plus two the operator must
confirm rather than decide. What was resolved, and on what basis, is in the round
30 review request rather than repeated here.
-->

**Status:** counsel-ready draft (v3) — not published
**Applies to:** anyone who creates or uses an Agent account on
{{OPERATOR_NAME}}'s OpenInspection deployment

---

## 1. Who these terms are between

These Terms are between **you**, as the individual who creates or uses an Agent
account, and **{{OPERATOR_NAME}}** ("we", "us"), which operates this deployment.

If you access the Service in connection with your work for an organization, you
represent that you are authorized to do so.

These Terms do **not** make the Inspection Company, your brokerage, your employer,
or any other transaction participant a party to this agreement unless we
separately agree in writing.

You are always the direct party. If you act for an organization, you remain
responsible for your own actions and you warrant your authority to act — but your
use of the Service does not put your brokerage, or any Inspection Company, into a
contract with us.

## 2. Definitions

**"Agent"** means a real-estate professional, or another authorized transaction
participant, who receives access to an inspection through the Service.

**"Inspection Company"** means the customer or other organization that operates an
inspection business and has made an inspection or report available to you through
the Service.

**"Report"** means an inspection report, and any part of one, made available to you
through the Service — together with the findings, photographs, repair items and
other content it contains.

**"Service"** means this OpenInspection deployment and the Agent-facing features
of it.

## 3. Agent account and scope

Your Agent account is **global to this deployment**. It is not owned by any one
Inspection Company, and one account is used across every Inspection Company on
this deployment that names you.

**Your acceptance of these Terms applies to your use of the Agent account
throughout this deployment, regardless of which Inspection Company has granted you
access to a particular inspection.** You are not asked to accept these Terms again
each time a different company names you.

*(Code: an Agent is a `users` row with `tenant_id IS NULL`; the access binding sits
on the contact row, so the account spans every company holding you as a contact —
`server/api/agent/notices.ts`. The acceptance is recorded once per version, against
the deployment's document rather than against a company — `deployment_legal_versions`.)*

## 4. How access is granted and revoked

You see an inspection because an Inspection Company added you as an agent contact
on it. You do not request access and we do not grant it.

**The Inspection Company controls your access to inspections it has assigned to
you. It does not own or control your Agent account.**

That company can remove your access at any time, and your access to that
inspection ends when it does. **Removal by one Inspection Company affects only your
access to that company's inspections. It does not by itself terminate your account,
or your access to inspections other companies have made available to you.** We may
separately suspend or close the account itself.

Neither of us owes you notice before access ends, and access ending is not a
breach of these Terms by anyone.

*(Code: contact create/update/delete is gated by the `manageContacts` capability —
`server/api/contacts.ts`. An account may be deleted or demoted from the agent role
between sign-in attempts — `server/services/agent/account.ts`.)*

## 5. Permitted use of the Service

Depending on what each Inspection Company has published, an Agent account may let
you:

- see the inspections you have been named on;
- view Reports the company has **published** (unpublished work is not visible to
  you);
- see and assemble repair items and repair requests for those inspections;
- send a repair-request link by email to another person through the Service;
- manage your own profile and notification preferences.

**Available features may vary by inspection, by company, by deployment
configuration, and by account status.** This list describes what the Service may
offer; it is not a promise that any particular feature is or will remain available
to you.

You may not attempt to reach inspections, companies, or accounts you were not
named on. **You may not allow another person to use your Agent account**, and you
may not share your credentials or a sign-in link — sharing a credential is only the
means; the account is the thing. A sign-in link sent to your email address
authenticates **you**, so forwarding one hands over the account.

*(Code: `GET /api/agent/referrals`, `GET /api/agent/my-repair-items`, the
repair-builder share-by-email route, `server/api/agent/notification-preferences.ts`.)*

## 6. Reports, confidentiality and no professional advice

A Report is the Inspection Company's work product. It was written for **their
client**, about that client's transaction, on that date.

**We do not provide inspection services or professional advice.** We do not
perform inspections, verify Reports, or check that a Report is accurate, complete,
or current. We make no representation about the condition of any property.

**You are solely responsible for determining whether and how you use a Report in
connection with your professional, contractual, fiduciary, regulatory, or other
obligations.** If you rely on a Report, that reliance is your responsibility.

**Reports are third-party materials.** Reports and other inspection materials are
provided by or on behalf of the Inspection Company. We grant you no ownership
interest in them. Any right you have to use a Report arises from the transaction,
from your relationship with the Inspection Company or its client, and from
applicable law — not from any ownership of ours.

**Nothing in these Terms prevents you from exercising your own professional
judgment, or from complying with duties that apply to you.** These Terms allocate
what WE are responsible for; they do not purport to remove an obligation you owe
somebody else.

A Report concerns another person's property and another person's transaction.
Treat it as confidential to that transaction.

## 7. Sharing Reports and transaction information

**You may use and disclose a Report only as reasonably necessary for the
transaction for which you were granted access, and only to persons who are
authorized participants in that transaction or are otherwise entitled to receive
it.**

By way of example and not limitation, those people ordinarily include your own
client in that transaction, their lender, their attorney, a contractor quoting
the repairs identified in the Report, and your own transaction file.

You may not:

- post a Report, or any part of it, publicly;
- use Report contents for marketing unrelated to that transaction;
- sell, license, or otherwise resell Report contents;
- assemble Report contents into a database or a competing product;
- use automated means to access, scrape, crawl, extract, index, copy, or
  systematically collect Reports, inspection data, contact information, or anything
  else reached through the account — except where the Service expressly provides a
  feature that does it;
- circumvent, or attempt to circumvent, any access control;
- redistribute a Report to anyone not covered by the paragraph above;
- attempt to reach inspections you were not granted access to.

**You may not use Report contents, or personal information obtained through the
Service, to train, fine-tune, evaluate, benchmark, or operate any machine-learning
or artificial-intelligence system, except with the express written authorization of
BOTH the Inspection Company that produced the Report and the client it was
produced for.**

Both, because neither alone can give it: the Report is the company's work product,
and it is about the client's property and their transaction.

## 8. Messages and email

When you send a repair-request link through the Service:

**When you use the messaging functionality, you provide the recipient and the
message information, and you instruct us to transmit the message on your behalf.**

**You are responsible for deciding whether and to whom a message is sent.**

**You represent that you have a lawful basis, and any authorization required, to
send the message to that recipient.**

Responsibility divides as follows.

**Yours:** whether to send, who receives it, the purpose, the content you supply,
and the lawful basis or permission for contacting that person.

**Ours:** platform-level sending controls, enforcing suppression of addresses that
must not be contacted, the technical transmission itself, system-generated content,
and abuse prevention.

We may refuse or stop delivery, and we may suppress an address.

Nothing in this section makes you responsible for our own obligations as the
operator of the sending infrastructure.

## 9. Your responsibilities

You agree to:

- use the Service only as these Terms permit;
- keep your credentials and your email account secure;
- comply with the law that applies to what you do through the Service, including
  the law applying to messages you send;
- **handle personal information and confidential information obtained through the
  Service only as permitted by applicable law and by your relationship with the
  relevant person or organization.**

Through the Service you may see a homeowner's name, a property address, inspection
findings, photographs, repair information, and contact details for other
transaction participants. That is other people's information, and the paragraph
above governs what you may do with it.

## 10. Your data and privacy

To operate your account we hold your name and email address, your sign-in
credential (or the fact that you sign in without a password), your notification
preferences, and the record of this acceptance — its date and time, the version and
content hash of the text you were shown, and, **where collected**, the IP address
and country it came from.

*(Code: `users.terms_accepted` stores `{ at, version, contentHash, ip?, country? }` —
the last two are OPTIONAL, which is why this clause says "where collected". It said
they were recorded, full stop, while the code reference two lines below showed the
question marks. Counsel caught it (round 31 §11); a deployment behind a proxy that
strips the header would otherwise have made the sentence false.
— `server/lib/db/schema/tenant/user.ts`.)*

The acceptance record stores the version **and a hash of the text** rather than a
link to a page, so what you agreed to can be shown later even if the page changes.

**For personal information associated with your Agent account, we determine the
purposes and means of processing, subject to applicable law. For Report content
provided by an Inspection Company, that company determines the purposes for which
it is used, and we process it in accordance with our agreement with that company
and applicable law. Our Privacy Notice describes the roles and the processing that
apply in each jurisdiction.**

This section describes the relationship. It does not attempt to complete a
privacy-law classification inside a contract — legal role is a per-jurisdiction map,
not a single word, and the Privacy Notice is where that map lives.

The Privacy Notice at {{PRIVACY_URL}} covers how we handle personal data, including
how to reach us about access, correction, or deletion.

## 11. Sign-in and account security

You may be able to sign in with a password, with a code emailed to your address,
or — where this deployment enables it — with a federated identity provider.

*(Code: `server/api/agent/login.ts`, `server/api/agent/magic-login.ts`, and the
agent-mode OIDC path.)*

**You are responsible for maintaining control of the email address associated with
your account.** Whoever controls it can obtain a sign-in code, which is what makes
that responsibility load-bearing rather than advisory. Tell us promptly if you
believe someone else has used your account.

## 11a. Electronic communications

You agree to receive communications from us electronically — including these
Terms, changes to them, and notices about your account — and you agree that
electronic records and signatures satisfy any requirement that such
communications be in writing.

You accepted these Terms electronically, and that acceptance is recorded with the
version and content hash of the text you were shown (§16), which is what allows it
to be produced later.

## 12. Availability

The Service is provided as-is and as-available. We do not promise uptime, and we
may change, suspend, or discontinue any part of it.

**We may also limit or suspend access where reasonably necessary for security,
abuse prevention, legal compliance, or protection of the Service.** §4 covers your
account; this covers the Service itself.

## 13. Disclaimers

To the fullest extent the law allows, we disclaim all warranties, express or
implied, including implied warranties of merchantability, fitness for a particular
purpose, and non-infringement.

We do not warrant that the Service will be uninterrupted or error-free, or that any
Report is accurate, complete, or current.

Some jurisdictions do not allow certain disclaimers. Where that is so, this section
applies to the fullest extent permitted and nothing here removes a warranty that
cannot be excluded.

## 14. Limitation of liability

To the fullest extent the law allows, we are not liable for indirect, incidental,
special, consequential, or punitive damages, nor for lost profits, lost business,
or lost data, arising from your use of an Agent account or from anything in a
Report.

**Our total aggregate liability arising out of or relating to these Terms will not
exceed the greater of (a) US$50 or (b) the amounts you paid us in the
twelve months before the event giving rise to the claim.**

These limits do **not** apply to liability for fraud, for willful misconduct, or to
any liability that cannot be limited or excluded under applicable law.

**Narrow indemnity.** You will indemnify us against third-party claims arising from
your **intentional or unlawful** misuse of the Service — specifically, unauthorized
disclosure of a Report, use of Report contents prohibited by §7, or an unlawful
message sent under §8. This indemnity does not extend to your ordinary,
good-faith use of the Service, nor to every breach of these Terms.

## 15. Suspension and termination

You may stop using the account at any time and may ask us to close it. We may
suspend or close it at any time.

**Sections that survive termination:** §2 (Definitions), §6 (confidentiality and
no professional advice), §7 (permitted sharing and use restrictions), §9 (your
responsibilities as to information you obtained), §10 (data and acceptance
records), §13 (Disclaimers), §14 (Limitation of liability and indemnity), §17
(Governing law and disputes), and any provision that by its nature should survive.

Records we are required to keep — including the record of this acceptance —
survive closure. The Privacy Notice at {{PRIVACY_URL}} describes what is kept and on
what basis.

## 16. Changes to these Terms

We may publish a new version. Where a change is material you will be asked to
accept the new version before continuing; where it is not, the new version applies
going forward and the version you accepted stays on record.

**A material change does not bind you through continued use. It binds when your
acceptance of it has been RECORDED** — which is how the product behaves rather than
a promise about it: the gate refuses access until the acceptance is written, so
there is no state in which continued use could later be argued to have been
agreement.

Each version is recorded with its own content hash, so an earlier acceptance always
points at the exact text it was given for, and the version you accepted can be
reconstructed later.

## 17. Governing law and disputes

These Terms are governed by the law of {{GOVERNING_LAW}}, without regard to its
conflict-of-laws rules.

{{DISPUTE_PROVISION}}

<!--
{{DISPUTE_PROVISION}} is one of two shapes, and which one is a decision, not
drafting — see decision point 1. Either:
  (a) exclusive venue — "The courts located in {{VENUE}} have exclusive
      jurisdiction over any dispute arising out of or relating to these Terms, and
      each party consents to that venue."
  (b) arbitration — binding individual arbitration, seat, rules, fee allocation,
      small-claims and injunctive carve-outs, and a class-action waiver.
Counsel will not choose in the abstract: it follows the operating entity. Governing
law alone is NOT a complete dispute provision, so this placeholder cannot simply be
deleted.
-->

## 18. Contact

{{OPERATOR_CONTACT_EMAIL}}

<!--
## Counsel decision points — what is left

v1 listed ten. Nine are resolved in the text above; the reasoning and the
competitor data behind each is in the round 30 review request. What remains:

**BLOCKING — 0. Two conflicts between round 29 and round 31, which we did NOT
resolve ourselves.** Picking one silently is how a corpus starts disagreeing with
itself.

  *§1 capacity.* Round 29 asked for "if you access the Service in connection with
  your work for an organization, you represent that you are authorized to do so".
  Round 31 asks for "You enter into these Terms in your individual capacity. You are
  not entering into these Terms on behalf of an inspection company, its client, or
  any other person or entity." One accommodates acting for an employer; the other
  disclaims it. v3 still carries round 29's sentence — tell us which wins.

  *Section structure.* Round 29 set out 18 sections in one order; round 31 proposes
  16 in another. v3 keeps round 29's, since renumbering twice would invalidate every
  cross-reference in this file and in the register for no gain until it is settled.

**BLOCKING — 0b. §12/§15 retention.** See the header: no approved retention window
exists, so nothing here may imply one. Independent of the entity.

**BLOCKING — 1. §17, the operating entity.** There is no entity: the operator is
an individual, and the billing path under consideration is a merchant-of-record
(Paddle), which makes a third party the seller of record to the customer while
these Terms still govern the service relationship. Counsel declined to pick a
state in the abstract; we now know one cannot be picked at all. The question for
counsel is therefore no longer "which law" but: **can an Agent Terms be published
at all by an operator with no entity, or must agent signup stay closed until one
exists?** — and if it can, what §17 should say. Nothing else in this document is
blocked by it.

**CONFIRM — 2. §14, the US$50 floor.** Chosen, not inherited. Counsel proposed
$100; the closest competitor (Spectora) caps at $10 flat, Dropbox uses a $20
floor and Google $200. An Agent pays nothing, so the floor IS the entire exposure
— the fee limb is always zero. $50 sits above the level a court might treat as
illusory and below counsel's more conservative figure. Confirm or move it.

**CONFIRM — 3. §8, whether the allocation survives the facts.** The message has
THREE content sources, and only one is ours: our operational shell (subject
`Repair request — <address>`, one sentence and a link, no promotional content and
no unsubscribe), a free-text message the Agent supplies, and a template the
Inspection Company may override wholesale. Given 15 U.S.C. §7702(2) and (16), the
stronger argument is that this is not a commercial electronic mail message at all,
rather than that it falls within the §7702(17) transactional exemption — whose
first limb requires a transaction the recipient "previously agreed to enter into
with the sender", which a cold contractor has not. Those are different arguments
and only the first holds. Confirm the section as drafted, or tell us this needs a
product change (recipient-side consent capture) rather than wording.
-->

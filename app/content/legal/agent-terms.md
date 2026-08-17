# Agent Terms

<!--
review-READY v1 — reviewed once (review, 2026-08-17). NOT APPROVED FOR
PUBLICATION.

review verdict: keep the skeleton, do not publish. Draft quality 7/10, contract
architecture 8.5/10, blocking §1 · §7 · §11 · §14 (numbered against the previous
15-section draft). This revision lands every P0 and P1 from that round as clause
text and restructures to the 18 sections review set out. The archived ruling is
`[redacted]` in the superproject and it,
not this file, is the binding text.

Still not publishable, for one reason that is not a drafting problem: §17 needs
the operating entity's jurisdiction, and review explicitly declined to pick one
in the abstract. Every remaining `{{PLACEHOLDER}}` is a decision, not a gap in the
text — and `npm run agent-terms:publish` refuses any body still containing one, so
this cannot reach production by accident.

Written to be reviewed against BEHAVIOUR. Factual clauses carry the code they were
read off, so a reviewer can check the claim rather than take it. Where a clause and
the code disagree, the code is what is true: fix the clause, or fix the code and
say which. review valued this and it stays.

This is the OPERATOR's document. OpenInspection is deployed by whoever runs it, so
the operator's name, contact and law are per-deployment and must never be hardcoded
to one company.

The review decision points are at the end. They are decisions, not questions:
each one names what has to be chosen and what changes depending on the answer.
-->

**Status:** review-ready draft — not published
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
inspection ends when it does. We may separately suspend or close your account.

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
named on, and you may not share your credentials or a sign-in link with anyone. A
sign-in link sent to your email address authenticates **you**; forwarding one hands
over your account.

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

A Report concerns another person's property and another person's transaction.
Treat it as confidential to that transaction.

## 7. Sharing Reports and transaction information

**You may use and disclose a Report only as reasonably necessary for the
transaction for which you were granted access, and only to persons who are
authorized participants in that transaction or are otherwise entitled to receive
it.**

You may not:

- post a Report, or any part of it, publicly;
- use Report contents for marketing unrelated to that transaction;
- sell, license, or otherwise resell Report contents;
- assemble Report contents into a database or a competing product;
- scrape, bulk-extract, or systematically copy Report contents;
- redistribute a Report to anyone not covered by the paragraph above;
- attempt to reach inspections you were not granted access to.

**You may not use Report contents, or personal information obtained through the
Service, to train, fine-tune, evaluate, benchmark, or operate any machine-learning
or artificial-intelligence system, except with the express written authorization of
the party entitled to authorize that use.**

## 8. Messages and email

When you send a repair-request link through the Service:

**You are responsible for deciding whether and to whom a message is sent. We
provide the technical service used to transmit the message.**

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
content hash of the text you were shown, and the IP address and country the
acceptance came from.

*(Code: `users.terms_accepted` stores `{ at, version, contentHash, ip?, country? }`
— `server/lib/db/schema/tenant/user.ts`.)*

The acceptance record stores the version **and a hash of the text** rather than a
link to a page, so what you agreed to can be shown later even if the page changes.

**We determine how your Agent account information is used to operate and secure
the Service. The Inspection Company determines the purposes for which inspection
information and Report content is processed in connection with its inspection
business. Our applicable Privacy Notice describes the roles and the processing that
apply in each jurisdiction.**

The Privacy Notice at {{PRIVACY_URL}} covers how we handle personal data, including
how to reach us about access, correction, or deletion.

## 11. Sign-in and account security

You may be able to sign in with a password, with a code emailed to your address,
or — where this deployment enables it — with a federated identity provider.

*(Code: `server/api/agent/login.ts`, `server/api/agent/magic-login.ts`, and the
agent-mode OIDC path.)*

Keep your email account secure: whoever controls your email address can obtain a
sign-in code. Tell us promptly if you believe someone else has used your account.

## 12. Availability

The Service is provided as-is and as-available. We do not promise uptime, and we
may change, suspend, or discontinue any part of it.

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
exceed the greater of (a) {{LIABILITY_FLOOR}} or (b) the amounts you paid us in the
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
survive closure. {{PRIVACY_URL}} states for how long, and on what basis.

## 16. Changes to these Terms

We may publish a new version. Where a change is material you will be asked to
accept the new version before continuing; where it is not, the new version applies
going forward and the version you accepted stays on record.

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
review will not choose in the abstract: it follows the operating entity. Governing
law alone is NOT a complete dispute provision, so this placeholder cannot simply be
deleted.
-->

## 18. Contact

{{OPERATOR_CONTACT_EMAIL}}

<!--
## review decision points

Ten decisions. Each says what must be chosen and what changes with the answer.
Everything review already ruled on in review is in the text above and is NOT
repeated here.

1. **§17 — the operating entity, then the dispute shape.** (Blocks publication.)
   Governing law, and then venue-vs-arbitration. If arbitration: seat, rules, fee
   allocation, carve-outs, and whether a class-action waiver is used. review
   declined to pick a state in the abstract, so this is upstream of drafting —
   nothing else in the document is blocked by it, and nothing else can substitute
   for it.

2. **§14 — the cap floor.** review proposed *"greater of $100 or amounts paid in
   the preceding 12 months"*, on the reasoning that an Agent pays nothing so a
   paid-amount-only cap is $0. Confirm $100 (`{{LIABILITY_FLOOR}}`), or set another
   figure. A per-deployment placeholder is deliberate — a self-host operator's
   exposure is not ours — but confirm a floor is appropriate at all rather than a
   fixed sum.

3. **§14 — is the narrow indemnity the right trigger?** Drafted as intentional or
   unlawful misuse only, listing the three concrete cases. Confirm the trigger is
   *intent/unlawfulness* and not *breach*, and whether it should also cover a claim
   that the Agent lacked the authority represented in §1.

4. **§8 — does the allocation actually hold?** We control the sending domain,
   generate part of the message, and process unsubscribes. review warned that a
   contract cannot decide who the sender is in law. Confirm the split as drafted is
   the final position, **or** tell us this requires a product change —
   recipient-side consent capture before an Agent can email a third party — in
   which case §8 is provisional and the feature needs work before publication.

5. **§7 — who is "the party entitled to authorize" an AI use?** The Inspection
   Company, its client, or both together? A prohibition whose exception nobody can
   identify is unenforceable in practice, and the answer decides whether we need a
   product surface to record such an authorization.

6. **§7 — is the authorized-participant test workable without a list?** It replaces
   an over-restrictive absolute, but it puts the judgement on the Agent. Confirm
   whether an illustrative (non-exhaustive) list — own client, lender, attorney,
   contractor quoting the repairs, transaction file — should appear in the text.

7. **§10 — does the jurisdiction-neutral wording survive contact with the role
   map?** Drafted to say who *determines* what and to point at the Privacy Notice,
   per review. Confirm it does not re-create a global controller/processor
   conclusion, and identify which Privacy Notice is authoritative for a self-host
   operator who has published their own.

8. **§2 — how far does `Agent` reach?** Defined as a real-estate professional or
   other authorized transaction participant. If the product later admits buyers,
   sellers, lenders, attorneys, contractors or insurance agents to the same account
   type, does this document cover them, or does that trigger a new document?
   review warned against letting the catch-all grow silently.

9. **Capacity, and electronic acceptance.** Two P2s that still need a yes/no
   because they touch the signup form: (a) is a capacity/age representation
   required at signup, and (b) does electronic acceptance need an explicit
   consent-to-electronic-communications clause in this document, given the
   acceptance itself is electronic and the US ESIGN/UETA posture is reviewed
   elsewhere in the corpus?

10. **Publication mechanics.** Confirm that a **non-material** first publication is
    correct — nobody has accepted a prior version, so there is nothing to force a
    re-acceptance of — and that the version string should be the date of review
    approval rather than the date of deployment.
-->

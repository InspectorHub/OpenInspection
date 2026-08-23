# Agent Terms

<!--
DRAFT v5 — NOT APPROVED FOR PUBLICATION.

Do not add reasoning here that exists nowhere else. Explanatory notes stay only
where they say what a CLAUSE means or which code fact it rests on.

WHY IT CANNOT BE PUBLISHED, and how that is enforced: run
`npm run agent-terms:publish`. It prints the publish-gate checklist and
refuses while any line is red.

§17 IS GONE. Governing law may be omitted rather than named:
"must not ship as a placeholder" never meant every contract must contain the
clause. That removes a blocker; it does not remove the risk — with no governing
law, no venue and no arbitration, a dispute still has to find a forum. An explicit
"no choice of law is made" sentence is deliberately absent too: it would convert an
absence into an affirmative statement for no gain.

What still blocks: the operator's own identity (contracting party and contact —
still P0) and the retention model (approved with no window). The
gate reads the retention signal out of the policy header rather than trusting
anybody's recollection.

Factual clauses cite the code they were read off, so a reviewer can check the claim
rather than take it. Where a clause and the code disagree, the code is what is true.
One had drifted when this was last checked, which is the argument for keeping them.
-->


**Status:** draft (v5) — not published
**Applies to:** anyone who creates or uses an Agent account on
{{OPERATOR_NAME}}'s OpenInspection deployment

---

## 1. Who these terms are between

These Terms are between **you**, as the individual who creates or uses an Agent
account, and **{{OPERATOR_NAME}}** ("we", "us"), which operates this deployment.

**You enter into these Terms personally. If you access the Service in connection
with your work for an organization, you represent that you are authorized to use
the Service for that organization.**

These Terms do **not** make the Inspection Company, your brokerage, your employer,
or any other transaction participant a party to this agreement unless we
separately agree in writing.

You are always the direct party. If you act for an organization, you remain
responsible for your own actions and you warrant your authority to act — but your
use of the Service does not put your brokerage, or any Inspection Company, into a
contract with us.

**No agency or employment.** Nothing in these Terms creates, or is intended to
create, an agency, employment, partnership, joint venture, fiduciary, franchise, or
other representative relationship between you and us. You have no authority to bind
us or to make commitments on our behalf.

*(Review asked for an explicit no-agency statement and no draft had one. §1's
"the Inspection Company is not a party" is a different sentence: it says who is NOT
on the other side of this contract, and says nothing about what YOU are to US. The
word "Agent" invites the question "agent of whom", and this answers it.)*

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
**Treat it as confidential, and use it only as permitted by these Terms and
applicable law.**

*(Deliberately a use restriction rather than a confidentiality regime. "Confidential"
alone would raise who owes the duty to whom, what counts as confidential
information, and whether the obligation ever ends — a whole NDA's worth of
questions this document does not need, because §7 already carries the restriction
that does the work.)*

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

**You are responsible for the content and the recipient information that you
provide or select. We remain responsible for content that we generate ourselves,
and for the operation of the messaging infrastructure, under applicable law.**

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
question marks. A deployment behind a proxy that
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

**Our total aggregate liability arising out of or relating to your Agent account
or these Terms will not exceed US$200.**

**This limitation does not apply to liability that cannot lawfully be excluded or
limited**, nor to liability for fraud or willful misconduct.

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

## 17. Contact

{{OPERATOR_CONTACT_EMAIL}}

<!--
## What is still open

Kept SHORT on purpose — duplicating a decision list here is how a draft turns
into a second source of truth.

BLOCKING (both must be green before this publishes; the gate enforces both):
  · the operating entity — §17 governing law and dispute mechanism
  · the retention model — no window is approved, so §15 may not imply one

FOR THE OPERATOR TO DECIDE:
  · the §14 liability floor — DECIDED: US$200, the most conservative of the values
    on the table. US$100 was the lower option considered, and no figure is legally
    "safe" either way; the operator went higher because the only real risk here is a
    court finding the floor low enough to raise enforceability on a wholly free
    service, and US$200 has industry precedent (Google) at effectively no cost.

ENGINEERING, not a drafting item:
  · the repair-request message must stay transaction-specific. Whether it is a
    commercial message is decided by the content actually generated, not by a
    clause in here — so the constraint belongs in the template and in a gate.
-->

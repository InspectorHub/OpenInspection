# Legitimate Interests Assessment — report delivery confirmation

**Subject:** recording, server-side, that a report page was rendered to a
recipient who presented a valid portal access token.

**Status:** written **before** the code (OI #271, Task 1 of the delivery
confirmation plan). Nothing described here is implemented yet — there is no
`report_views` table in the schema and no counter anywhere in `server/` or
`app/` as of 2026-08-07. This document is therefore an assessment of a
*proposal*, and it reaches a **split conclusion**: one shape of the feature
passes the balancing test and one does not.

**Why this lives in the open-source repo.** Every deployment of
OpenInspection — hosted or self-hosted — runs the same code and performs the
same processing. A self-hoster is a controller in their own right and needs
the same assessment, so it ships with the software rather than with any one
operator's paperwork. Section 6 says what a self-hoster still has to do.

**What this document is not.** It is not legal advice, and it is not a
conclusion about any specific deployment. It records the reasoning a
controller can adopt, adapt, or reject.

---

## 0. What is actually proposed

A bounded counter table. Per (recipient, deliverable): whether it has ever been
opened, when it was first opened, when it was last opened, and how many times.
Three integers and a foreign-key-free pair of scope columns. No row per view.

The counter is written on the server, in the loader that renders the public
report page (`app/routes.ts:49` -> `app/routes/public/report-card-stack.tsx`),
when a request arrives carrying a valid per-recipient portal token.

Deliberately absent: IP address, user agent, referrer, device or browser
fingerprint, per-section dwell time, scroll depth, and any record of *which
findings* were read.

Deliberately absent by mechanism: any cookie, pixel, `localStorage` write,
`sendBeacon` call, or client-side listener. Nothing is stored on or read from
the recipient's device. The server records its own handling of its own
request. That distinction is the reason this assessment can be attempted at
all: the 2026 supervisory-authority position on email tracking pixels turns on
*terminal-equipment access*, and where that is engaged the answer is consent,
not legitimate interests. A design that avoids terminal-equipment access does
not thereby become lawful — it becomes eligible for the test below.

---

## 1. Purpose test — is there a legitimate interest?

**The interest.** An inspection company owes its client a report. It is the
deliverable the engagement exists to produce, and in many jurisdictions the
professional obligation attaches to *delivery*, not to sending. The company
has a real and present interest in knowing whether the document it is
contractually obliged to provide actually reached the person it was for.

This is not a speculative or future interest. It is asserted every time an
inspector is asked "did they get it?" and today has no answer better than
"the email did not bounce".

**Secondary interest.** Following up on a report that was delivered but never
opened. This is a weaker interest than the first — it is a business
convenience — and it is worth naming separately because it is the one that
would justify escalating collection later. It does not, on its own, justify
anything beyond the first.

**Third-party interest.** The recipient also benefits, marginally: an
unopened report that the inspector notices and re-sends is a report the client
gets. This is real but small and should not be leaned on.

**What is *not* claimed.**

- **No marketing purpose.** Nothing here supports "clients who opened the
  report within a day are warmer leads", segmentation, or any downstream use
  of the counters outside the delivery question.
- **No profiling purpose.** No inference about the recipient — their level of
  concern, their attention, their diligence, their state of mind — is claimed
  as an interest, and no data that would support such an inference is
  collected.

This is not a disclaimer. It is the reason several otherwise-obvious features
are absent from the design. A "which sections did they read" panel, an
engagement score, a chart of opens over time, a per-section heatmap, and a
"most engaged clients" list are all things a product with three integers per
recipient cannot build. That is the point. Each of them would need its own
purpose, and none of the purposes above reaches them.

**Conclusion, purpose test: passes** for the delivery question, and only for
the delivery question.

---

## 2. Necessity test — is this the least intrusive way?

The question is whether the interest in section 1 can be met with less.

| Alternative | Why it does not answer the question |
|---|---|
| SMTP delivery status / bounce handling | Proves the mail server accepted the message. It is silent on whether a human ever saw it. This is already implemented and is exactly the gap being closed. |
| Ask the client to confirm | Requires the recipient's cooperation for the controller's own record-keeping, and the population that does not open the report is the same population that does not answer the follow-up. It answers the question only when the answer is already yes. |
| Email read receipt (MDN) | Requires the recipient to act on each one, is unsupported or silently disabled by most consumer clients, and is answered by the mail client rather than by the fact of reading. Less reliable *and* more intrusive to ask for. |
| Tracking pixel in the delivery email | Engages ePrivacy Art. 5(3): the recipient's mail client fetches a resource from the recipient's device. The 2026 supervisory position is that legitimate interests is not available here at all. Strictly more intrusive and legally worse. |
| Client-side beacon on the report page | Same objection, plus it would be the first client-side instrumentation in this product, inherited by every self-hosted deployment. |
| A row per view (event log) | Answers the same question and additionally produces a chronological record of when a named person read a document. Strictly more data for no additional answer. |

Recording, server-side, that a token was used to render a page is the least
that answers "was it received". And within that, three counters is the least
that answers it — "first opened" is what a follow-up decision needs, "last
opened" distinguishes a re-read from a stale first open, and a count
distinguishes a glance from repeated reference.

**One necessity claim that does not hold up.** "Last opened" and the count are
*useful*, not *necessary*, for the primary interest — "has this ever been
opened, and when first" is sufficient to answer "did they get it". They are
necessary only for the secondary interest (section 1) and for telling the
inspector something honest about a report the client keeps returning to. A
controller who wants the narrowest possible footing can drop both and keep
`first_opened_at`. This assessment covers all three, but the two extra
integers rest on the weaker interest and should be the first thing dropped if
the balancing in section 3 is ever revisited.

**Conclusion, necessity test: passes** for `first_opened_at`; passes on the
secondary interest for `last_opened_at` and the count.

---

## 3. Balancing test — are the recipient's interests overridden?

### 3.1 Who the recipients are

Not one population. The portal token is minted per recipient per order, and
report links are sent to at least three kinds of person:

- **The client** — the consumer who engaged the company and paid for the
  report. Strongest contractual nexus, strongest expectation.
- **The buyer's agent** — usually acting for the client, often the party who
  referred the engagement. Business contact, but acting in a transaction the
  client is party to.
- **The listing agent, and one-off shares** — a recipient who may never have
  engaged the company at all and whose link exists because someone else chose
  to share it.

The balancing is not the same for all three, and the assessment must not be
written as if the client were the only recipient. The third group has the
weakest expectation: they did not enter into anything, and a record that they
opened a document is a record about a person who never dealt with the
controller.

### 3.2 Reasonable expectations

For the client: a business that emailed you a personalised link to a document
about your own property, which you paid that business to produce, being able
to tell that the link was used — this is within the range of what a reasonable
person expects. It is roughly what they expect of a courier's tracking page.

For the agents: weaker, but a shared professional link is not private
correspondence, and "the sender can see the link was used" is not surprising.

For all three: the expectation holds **only if they are told**. An
undisclosed open-tracking record is precisely the thing the 2026 pixel
decisions are about, and the fact that this implementation avoids the
technical trigger does not make an undisclosed record acceptable. Art. 13
transparency is not a formality that runs alongside the balancing test here —
it is load-bearing *inside* it. Remove the disclosure and this assessment
fails.

### 3.3 Impact on the recipient

Low, and bounded by construction:

- No identifier is created that did not already exist. The row hangs off an
  access token the recipient was already issued.
- Nothing is stored on or read from their device, so there is no cross-site
  or cross-context linkage and nothing survives on their machine.
- The data cannot support an inference about them beyond "opened / when /
  how often". It cannot say what they read, how long they spent, or what they
  cared about.
- It is bounded: reports by recipients, a handful per engagement. It is not a
  log that grows with use.

**The counter-argument, recorded rather than answered away:** a person can
reasonably feel monitored by being told that a business can see when they
opened a document, and some will read a report differently knowing it. That
feeling is not defeated by the data being small. What the design does about it
is to keep the record to the minimum that answers the delivery question, so
that the feeling is proportionate to a fact rather than to an unknown. It does
not eliminate it.

### 3.4 Accuracy — where the balance actually gets difficult

This is where the assessment stops being comfortable. Two distinct problems.

**(a) The record can be wrong, and the design knows it.**

Corporate mail-security gateways open every link in an inbound message. So do
prefetchers. The plan filters `HEAD` requests, `Purpose: prefetch` and
`Sec-Purpose: prefetch`/`prerender`, and the product's own non-human GETs: the
headless PDF pipeline, which arrives with `?render=` (declared at
`server/api/public-report.ts:84`) and `?print=1` (read in the report route's
loader at `app/routes/public/report-card-stack.tsx:61`), and the inspector's
own preview of their own report. Those filters are heuristics. A determined
scanner issues a plain `GET` and is indistinguishable from a reader.

So the record will sometimes assert, of an identified person, that they opened
a document they never saw. That is inaccurate personal data (Art. 5(1)(d)),
and the harm is not abstract: an inspector who believes the client has read
the report behaves differently towards them.

This does not sink the assessment, but it converts two things from good
practice into conditions:

- The inspector-facing surface must never present "opened" as proof, and must
  present "not opened" alongside the delivery status so the two failure
  directions are distinguishable.
- The product must not "fix" the false-positive rate by adding client-side
  confirmation. That trade — accuracy bought with terminal-equipment access —
  moves the lawful basis to consent, and this assessment would no longer
  cover the feature.

**(b) The report identity problem — this part fails.**

The public report surface has no report identity today. The route is
`report-view/:tenant/:id` (`app/routes.ts:49`), the public data endpoint
documents its `id` param as **"Inspection id."**
(`server/api/public-report.ts:80`), and the renderer's own prop adapter sets
`const reportId = data.inspectionId ?? "";`
(`app/components/portal/sections/report/report-view-props.ts:51`). Meanwhile an
order can carry several deliverables — `reports` rows of kind `primary` and
`ancillary` — so "the report page for this order" and "a report" are not the
same object.

Two ways were proposed to give the counter a `report_id`:

1. **Thread real report identity through the surface** — add a report
   selector to the public route and payload so the page knows which
   deliverable it is rendering.
2. **Resolve the primary report** via `resolvePrimaryReportId()`
   (`server/lib/inspection/reports.ts:44`) and attribute every open to it.

**Option 2 does not pass this balancing test.** It manufactures a specific
factual assertion about an identified person — "this recipient opened the
radon report" — from an observation that does not contain it. Unlike (a),
this is not an unavoidable heuristic error at the margin; it is a wrong
attribution generated deliberately, for every open, as the normal case. A
controller cannot rely on legitimate interests to create a record it knows to
be a guess dressed as a fact, when a truthful alternative is available at the
cost of engineering work. The recipient's interest in not having false
statements recorded about them is not outweighed by the controller's
convenience in shipping sooner.

There is a third option, and it is the honest one if the renderer is not going
to change first:

3. **Record what the system actually observed.** The observation is "this
   recipient rendered the report page for this order". Key the row on
   (tenant, inspection, access token) and do not carry a `report_id` at all.
   The counter then makes a claim the system can support. When the renderer
   gains report identity, the column can be added, and the older rows are
   honestly order-scoped rather than retroactively mislabelled.

**Never populate a `report_id` column with an inspection id.** That is not a
shortcut, it is a false record in a column whose name asserts otherwise, and
it is the specific failure this section exists to prevent.

### 3.5 Balancing conclusion

For a counter that records only what was observed, discloses itself, and is
paired with delivery status in the inspector's view: the recipient's interests
do **not** override the controller's. **Passes.**

For a counter that attributes opens to a specific deliverable the system
cannot identify (option 2 above): **fails**, on accuracy. Not on volume, not
on sensitivity, and not on expectation — on the record being untrue.

---

## 4. Conclusion, and the conditions it rests on

**Legitimate interests is available for server-side report delivery
confirmation, provided all of the following hold.** These are conditions, not
recommendations. Each one is doing work in sections 1-3; if any is dropped,
the assessment has to be redone rather than cited.

1. **Nothing is stored on or read from the recipient's device.** No cookie,
   pixel, `localStorage`, `sendBeacon`, or client-side listener, on any
   surface involved in delivery or rendering. This is what keeps ePrivacy
   Art. 5(3) out of scope and is the load-bearing premise of the whole
   assessment.

2. **Only the counters are recorded.** No IP, user agent, referrer, device
   fingerprint, section-level timing, or scroll position. Adding any
   identifier not already necessary to serve the page reopens section 3.3.

3. **The row records only what was observed.** Either the renderer genuinely
   knows which deliverable it is showing, or the row is scoped to the order
   and says so. See section 3.4(b). This condition is currently **unmet** —
   the design choice is open.

4. **The recipient is told, before the first open is counted.** The first
   render is the one that creates the record, so a disclosure that appears
   only on the report page arrives after the fact. The notice must therefore
   ride the message that carries the link. As of today every report-link
   notice class declares `channels: ['email']`
   (`server/lib/notifications/classes.ts:118`, `:119`, `:149`, `:157`,
   `:185`-`:188`), which bounds the problem to the email path — but a link an
   inspector copies out and sends by hand is outside that system, and the
   disclosure cannot reach it.

5. **The disclosure cannot be edited away.** The delivery copy is
   tenant-editable, and an editable default only seeds a per-tenant row — it
   cannot carry a guarantee. The notice must be a system-rendered block (the
   mechanism exists: `SystemBlockKind` in
   `server/lib/email-templates/types.ts:17`, currently `'auditMetadata' |
   'attachmentManifest' | 'icsHint'`), not template text a tenant can delete.
   A disclosure a tenant can remove is a disclosure this assessment cannot
   rely on.

6. **The inspector-facing surface pairs "opened" with delivery status** and
   presents neither as proof. See section 3.4(a).

7. **The row is catalogued for erasure in the same change that creates it,**
   and the erasure orchestrator is wired to it. The manifest alone is not
   enough: `runErasure` is a hand-written per-table sequence of fourteen steps
   (`server/lib/compliance/erasure-orchestrator.ts:232`-`:445`), and a
   manifest rule with no matching step is a rule that does not run. The
   subject's rows must be removed before their access tokens are (`:345`),
   because the token id is how the rows are found. The general form of this
   trap is written up in `docs/compliance/erasure-heuristic-limits.md`.

8. **The counters are used for the delivery question only.** No export into
   analytics, no segmentation, no ranking of recipients.

9. **An objection can be honoured without losing access.** A per-recipient
   suppression marker stops the counter while the link keeps working, and it
   does not clear counters already recorded. Added 2026-08-07; see the amendment
   history under *Rights that follow from this basis*. This condition is
   currently **unmet** — the marker does not exist.

**Conditions 3 and 9 are not satisfied by the current design.** Until the report
identity question is resolved in the direction of section 3.4 option 1 or
option 3, and the suppression marker exists, the feature is not covered by this
assessment. That is the intended outcome of writing the assessment first: it is
allowed to say no to part of the proposal.

⚠️ **Condition 9 is not a follow-up to conditions 1–8.** The objection path
cannot ship after the collection it objects to — a counter that runs for a
release with no way to stop it is processing this assessment does not cover.

### Rights that follow from this basis

Processing on legitimate interests carries the Art. 21 right to object, and the
design provides a mechanism for it: a **per-recipient measurement-suppression
marker** on the recipient's own access-token row. When set, the counter stops
incrementing; the link keeps working and the report stays readable.

**Token revocation is not the mechanism.** An objection to *measurement*
answered by withdrawing *access* is a larger action than the one requested, and
it penalises the exercise of the right — the recipient would lose the document
in order to stop being counted. Minimal data lowers the risk; it does not remove
the right.

**Nor does an objection erase what is already recorded.** Art. 21 is not
Art. 17. Future collection stops; historical counters are governed by the
retention rules, and the controller may hold a lawful basis for delivery
evidence already collected. Suppression and erasure are separate requests,
honoured separately — and the erasure rule for these rows (`delete`, keyed on
the access token) must not be reached for by anyone implementing the objection
path.

> **AMENDMENT HISTORY**
> **Previous position:** *"This is a residual weakness, recorded rather than
> resolved … A controller who receives an objection should expect to honour it
> by revoking the token rather than by a mechanism this software provides."*
> **Correction date:** 2026-08-07.
> **Why:** the previous position assigned the obligation to the controller and
> supplied no instrument beyond a general-purpose one, and the instrument it
> named answers an objection about measurement by removing access. Reviewed
> externally and rejected as an adequate default.
> **Impact:** the condition set below changes. What was recorded as a residual
> weakness is now an **unmet condition** — the feature is not covered by this
> assessment until the suppression marker exists. The lawful basis, the data
> minimisation analysis and the balancing test are unchanged.

---

## 5. What voids this assessment

A future reader must not be able to extend the feature while pointing at this
document as cover. Each of the following makes this assessment
**inapplicable** — not "arguably still fine", not "a small delta". The lawful
basis changes, and the change is from legitimate interests to consent.

- **Per-section or per-finding tracking.** Dwell time, scroll depth, which
  sections were expanded, which photos were viewed. Its purpose is inference
  about the reader, which section 1 explicitly does not claim, and its
  implementation is necessarily client-side, which condition 1 forbids.
- **Any client-side instrumentation**, for any reason, including one added to
  improve the accuracy of the counters.
- **A tracking pixel in the delivery email.** Directly the case the 2026
  supervisory position addresses, and the one basis it forecloses.
- **Recording IP address, user agent, referrer, or any device signal**
  alongside the counters.
- **Replacing the counters with an event log** — a row per view is a
  chronology of when a named person read a document, and section 2 concluded
  it adds no answer.
- **Any secondary use** — marketing, lead scoring, segmentation, ranking, or
  training anything.
- **Populating a report identifier with something that is not a report
  identifier.** Section 3.4(b).

If a change in this list is wanted, the correct move is a new assessment
reaching a new conclusion — most likely that consent is required — not an
amendment to this one.

---

## 6. Note for self-hosted deployments

If you run OpenInspection, you are the controller for the data your instance
processes, and this assessment is a starting point rather than a substitute
for your own.

What you inherit: the design constraints. The absence of client-side tracking,
the three-counter shape, and the absence of IP and user-agent capture are
properties of the code, not of any operator's configuration.

What is yours: the purpose (section 1 assumes you send reports to clients
under an engagement — if your use differs, the purpose test differs), the
disclosure (conditions 4 and 5 depend on the copy your deployment actually
sends, and your tenant-level template edits are yours), your jurisdiction, and
your record of having made the assessment. Art. 5(2) makes documenting the
reasoning an obligation in its own right; adopting this document is a
reasonable way to discharge it, and adopting it without reading section 4 is
not.

---

**Assessment date:** 2026-08-07
**Reassess when:** any item in section 5 is proposed, condition 3 is resolved,
or the report renderer gains per-report identity.

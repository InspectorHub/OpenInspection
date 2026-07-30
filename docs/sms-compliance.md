# SMS Compliance for Self-Hosters

This guide is for operators who have deployed OpenInspection on their own infrastructure and want to enable SMS notifications. It covers Privacy / Terms pages (per company), how they connect to booking and carrier registration, and the carrier steps you complete in your Twilio or Telnyx account.

> **Not legal advice.** Have counsel review TCPA/CTIA wording before publishing.

---

## Overview

OpenInspection is a bring-your-own-provider SMS platform. You supply a Twilio or Telnyx account and credentials; OpenInspection routes messages through it. You are the sender of record and own compliance obligations.

### Per-company Privacy & Terms (no Worker env)

Each company configures Privacy and Terms under **Settings → Compliance**:

| Mode | URLs | Content |
|---|---|---|
| **OpenInspection pages** (default) | `{your-origin}/legal/{company-slug}/privacy` and `…/terms` | Built-in template, or optional text you paste in Settings |
| **My own website** | Absolute URLs you enter | Hosted on your site; both Privacy and Terms required |

Those effective URLs appear in booking footers, the client portal, invoices, and SMS opt-in pages. Copy them into toll-free / 10DLC registration.

### Consent is layered by recipient

| Recipient | Product posture | Carrier filing language |
|---|---|---|
| Clients / consumers | Express — recorded opt-in before send | Recorded opt-in; retain proof |
| Agents / other parties on the job | Implied — phone on file for the transaction | Established business relationship; STOP still applies |
| Staff | Account / employment terms | Internal; not the consumer consent ledger |

---

## Step 1 — Configure Privacy & Terms in Settings

1. Open **Settings → Compliance → Privacy & Terms**.
2. Choose **OpenInspection pages** or **My own website**.
3. If hosted: optionally paste custom page text; otherwise the built-in SMS-aware template is used. Copy the URLs for carrier forms.
4. If custom: enter public Privacy and Terms URLs that name your business and include SMS / STOP language.

---

## Step 2 — Complete carrier registration

- **Toll-free:** TFV in your carrier console — business details, use case, opt-in flow, Privacy + Terms URLs.
- **10DLC:** Brand + Campaign via TCR through your carrier — same policy URLs.

**Sample use-case answer** (adapt to your brand):

> We send transactional SMS about scheduled home inspections: appointment confirmations and reminders, report-ready notices, and related job updates. Consumers receive texts only after express opt-in and may reply STOP anytime. Business counterparties named on the inspection may receive transactional job texts based on an established business relationship; STOP is honored for all recipients. We retain consumer consent records. We do not sell or share mobile opt-in data.

**References:**
- Twilio: [Toll-Free Verification](https://help.twilio.com/articles/5377289905947) · [10DLC](https://help.twilio.com/articles/1260801864489-How-to-Register-to-Use-10DLC-in-the-US)
- Telnyx: [TFV](https://support.telnyx.com/en/articles/4527401-toll-free-verification) · [10DLC](https://support.telnyx.com/en/articles/4734735-10dlc-campaign-registration)
- CTIA: [Messaging Principles](https://www.ctia.org/the-wireless-industry/industry-commitments/messaging-principles-and-best-practices)

---

## Summary checklist

- [ ] Configure Privacy & Terms in Settings → Compliance (hosted or custom).
- [ ] Confirm links appear on booking / portal footers.
- [ ] Describe layered consent honestly in TFV / 10DLC answers.
- [ ] Complete toll-free or 10DLC registration with your carrier.
- [ ] Booking SMS checkbox unchecked by default; honor STOP for every outbound recipient.

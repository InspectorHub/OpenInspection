# SMS Compliance for Self-Hosters

This guide is for operators who have deployed OpenInspection on their own infrastructure and want to enable SMS notifications. It covers the legal language you must publish on your own Privacy Policy and Terms of Service, how to connect them to your deployment, and the carrier registration steps you are responsible for completing.

> **Not legal advice.** The templates below encode the functional elements required by US carrier programs (CTIA Messaging Principles, Twilio/Telnyx Acceptable Use Policies). Have counsel review the final TCPA/CTIA wording before publishing.

---

## Overview

OpenInspection is a bring-your-own-provider SMS platform. You supply a Twilio or Telnyx account and credentials; OpenInspection routes messages through it. This means:

- You are the "sender of record" with your carrier.
- You own all compliance obligations: opt-in language, consent records, opt-out handling, and carrier registration.
- OpenInspection cannot register a toll-free number or 10DLC campaign on your behalf — that registration is between you and your carrier account.

---

## Step 1 — Publish your Privacy Policy SMS clause

Add the following section to your Privacy Policy. Host it at a stable URL (e.g. `https://[your-domain]/privacy`).

> **SMS & Text Messaging**
>
> If you provide a mobile number and opt in, **[Your Company]** may send you appointment reminders, report-ready notifications, and other transactional messages about your inspection by text. Message frequency varies by your inspection activity. Message and data rates may apply. Reply STOP to opt out and HELP for help. Consent is not a condition of any purchase. We do not sell or share mobile opt-in information or your phone number with third parties or affiliates for their marketing.

Replace `[Your Company]` with your business name wherever it appears.

---

## Step 2 — Publish your Terms of Service Messaging clause

Add the following section to your Terms of Service. Host it at a stable URL (e.g. `https://[your-domain]/terms`).

> **Text Messaging (SMS)**
>
> **a. Your messaging program.** If you enable SMS, you are responsible for your text messaging program and its content. You represent and warrant that you have obtained prior express consent from each recipient before any message is sent, that your business information is accurate, and that your messaging complies with all applicable laws and regulations (including the TCPA), the CTIA Messaging Principles and Best Practices, and carrier requirements.
>
> **b. Consent and opt-out.** Your opt-in must identify **[Your Company]**, state that message and data rates may apply, and offer STOP to opt out and HELP for help. Opt-in must not be pre-selected; it must not be embedded deep in legal documents. You must honor opt-out requests immediately. You must not buy, sell, rent, or transfer messaging consent to or from any party, and must not share consent across businesses or use cases. You must retain proof of consent.
>
> **c. Provider terms.** Your use of messaging is subject to your carrier's Acceptable Use Policy and Messaging Policy (e.g. [Twilio's Messaging Policy](https://www.twilio.com/en-us/legal/messaging-policy) or [Telnyx's Acceptable Use Policy](https://telnyx.com/acceptable-use-policy)), which are incorporated by reference. You contract with and pay your carrier directly and are responsible for all charges on your carrier account.
>
> **d. Suspension.** [Your Company] may suspend or disable SMS immediately if your carrier flags or blocks your program, or if your messaging violates this section.

Replace `[Your Company]` with your business name wherever it appears. Remove the carrier links that do not apply to your account.

---

## Step 3 — Wire up the URLs in OpenInspection

Set two environment variables in your `wrangler.local.jsonc` (or `wrangler.saas.jsonc`) under the `"vars"` object (these are plain configuration values, not secrets):

```jsonc
"vars": {
  "PRIVACY_URL": "https://[your-domain]/privacy",
  "TERMS_URL": "https://[your-domain]/terms"
}
```


| Variable | Value |
|---|---|
| `PRIVACY_URL` | Full URL to your published Privacy Policy (e.g. `https://[your-domain]/privacy`) |
| `TERMS_URL` | Full URL to your published Terms of Service (e.g. `https://[your-domain]/terms`) |

When either variable is set, OpenInspection automatically:

- Renders a privacy-notice footer link on public-facing pages (`PRIVACY_URL`).
- Requires an acceptance checkbox on account-creating public forms and stamps an acceptance record on the user row (`TERMS_URL`).

Both variables are optional individually, but you should set both if you publish both documents.

---

## Step 4 — Complete carrier registration (your responsibility)

US carriers require that every SMS sender — including self-hosters — complete a registration before messages will be delivered reliably at scale. OpenInspection cannot do this for you; the registration is in your carrier account, not in this software.

**What you must do, depending on the number type you use:**

- **Toll-free number (10-digit, 1-8xx):** Submit a Toll-Free Verification (TFV) request through your carrier's portal. You will provide your business details, a description of your messaging program, your opt-in flow, and a link to your Privacy Policy and Terms of Service. Twilio's TFV portal is at `console.twilio.com`; Telnyx's is at `portal.telnyx.com`.

- **Long-code / 10DLC (local 10-digit number):** Register a Brand and a Campaign with The Campaign Registry (TCR) through your carrier. You will need your business legal name, EIN/tax ID, website, and the same opt-in and policy URLs. Your carrier submits to TCR on your behalf after you provide this information in their console.

- **Short code:** Contact your carrier directly — short code provisioning involves a carrier application and a carrier audit of your use case. This is the most involved registration path.

**Timeline:** Toll-free verification and 10DLC registration can take days to weeks. Start early — unregistered traffic is filtered or blocked by major US carriers.

**References:**
- Twilio: [Toll-Free Verification](https://help.twilio.com/articles/5377289905947) · [10DLC Registration](https://help.twilio.com/articles/1260801864489-How-to-Register-to-Use-10DLC-in-the-US)
- Telnyx: [Toll-Free Verification](https://support.telnyx.com/en/articles/4527401-toll-free-verification) · [10DLC Registration](https://support.telnyx.com/en/articles/4734735-10dlc-campaign-registration)
- CTIA: [Messaging Principles and Best Practices](https://www.ctia.org/the-wireless-industry/industry-commitments/messaging-principles-and-best-practices)

---

## Summary checklist

- [ ] Add the SMS clause to your Privacy Policy and publish it at a stable URL.
- [ ] Add the Messaging clause to your Terms of Service and publish it at a stable URL.
- [ ] Set `PRIVACY_URL` and `TERMS_URL` in your deployment configuration.
- [ ] Complete toll-free verification or 10DLC / short code registration with your carrier.
- [ ] Ensure your booking opt-in checkbox is unchecked by default, identifies your business, and links to both documents.

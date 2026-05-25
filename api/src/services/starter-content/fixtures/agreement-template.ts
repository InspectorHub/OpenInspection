/**
 * One generic pre-inspection agreement template seeded into every new trial
 * tenant. The body opens with a bolded warning paragraph that calls out the
 * legal-advice caveat + jurisdiction-specific requirements — tenants are
 * expected to replace the template with their own attorney-reviewed copy
 * before using it on a real customer engagement.
 */

const DISCLAIMER_PARAGRAPH =
    '**⚠️ Review before sending to real customers.** This template is provided as a ' +
    'starting point only and is **not legal advice**. Pre-inspection agreement requirements ' +
    'vary by state, province, and country (e.g. mandated disclosures, license numbers, ' +
    'scope-of-work limits, liability caps, statutory cancellation rights). Replace this ' +
    'paragraph and customize the full document for your jurisdiction. Consult a licensed ' +
    'attorney in your area before using this template on a real customer engagement.';

const AGREEMENT_BODY = `${DISCLAIMER_PARAGRAPH}

## Pre-Inspection Agreement

This agreement is between [INSPECTOR_NAME] ("Inspector") and [CUSTOMER_NAME] ("Client") for a home inspection of the property at [PROPERTY_ADDRESS] on [INSPECTION_DATE].

### 1. Scope of Inspection

The Inspector will perform a visual, non-invasive inspection of the readily accessible installed systems and components of the property, including:
- Roof, exterior, structure
- Plumbing
- Electrical
- HVAC
- Interior
- Basement / crawlspace (as accessible)

### 2. What is NOT Covered

This inspection is **not** a code compliance review, warranty, insurance policy, or guarantee of any kind. The following are explicitly excluded:
- Cosmetic conditions
- Future or latent defects
- Pest infestations (recommend separate pest inspection)
- Mold testing (recommend separate mold inspection)
- Environmental hazards (asbestos, lead, radon)
- Buried, concealed, or otherwise inaccessible items

### 3. Payment

Inspection fee: $[AMOUNT]. Payable on the day of inspection unless otherwise agreed.

### 4. Limitation of Liability

[INSERT JURISDICTION-APPROPRIATE LIMITATION OF LIABILITY CLAUSE HERE. Most jurisdictions cap inspector liability at the inspection fee. Consult an attorney.]

### 5. Client Acknowledgment

The Client acknowledges that the Inspector is not an insurer, guarantor, or warrantor of the conditions of the property and that this inspection is for the Client's benefit only.

Signed: [CLIENT_SIGNATURE_BLOCK]
Date: [SIGN_DATE]`;

export interface StarterAgreementFixture {
    name:    string;
    content: string;
}

export const AGREEMENT_TEMPLATE: StarterAgreementFixture = {
    name:    'Generic Pre-Inspection Agreement (review & customize before sending)',
    content: AGREEMENT_BODY,
};

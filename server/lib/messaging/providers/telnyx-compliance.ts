// server/lib/messaging/providers/telnyx-compliance.ts
//
// TelnyxComplianceProvider — the Telnyx implementation of the ComplianceProvider
// seam (Plan 1), driving the 10DLC provision path on the official `telnyx` SDK
// and persisting through the injected state store. Structural twin of
// TwilioComplianceProvider: idempotent, persist-before-advance, resume-safe.
//
// The constructor takes an ALREADY-BUILT telnyx client. The telnyx SDK is
// edge-native (Stainless): it routes through the global `fetch` with
// `Authorization: Bearer <apiKey>`, so production builds it plainly —
//   new Telnyx({ apiKey })
// (no custom httpClient, unlike twilio-node). Resolver wiring is a later task.
// Tests inject a structural fake recording each resource call.
//
// 10DLC differs from Twilio's ISV flow in two structural ways:
//   - There is NO Trust Hub "customer profile" step. The first persisted status
//     is 'brand_pending' (never 'profile_pending').
//   - Numbers are attached to a campaign by E.164 phone number via
//     phoneNumberCampaigns, not by attaching a number SID to a messaging service.
//
// DRIFT SURFACE — Telnyx field names / resource paths live in THIS file only.
//
// SCOPE (Task 1): the sp10dlc `provision` path + `webhookUrl`. The `tollfree`
// branch and the verify/parse/sync methods are stubbed to throw until later
// tasks implement them (they exist only to satisfy the interface).

import type {
    ComplianceProvider,
    ComplianceProviderId,
    ComplianceEvent,
    ComplianceSnapshot,
    ProvisionInput,
    WebhookVerifyCtx,
} from '../compliance-provider';
import type { ComplianceStateStore, ComplianceRow } from '../compliance-state-store';
import { complianceWebhookUrl } from '../../sms/compliance-webhook';
import { verifyTelnyxSignature } from '../telnyx';

// ---------------------------------------------------------------------------
// Minimal structural type of the telnyx SDK surface the provider uses. The real
// `new Telnyx(...)` client structurally satisfies these names (return types are
// the SDK's thenable APIPromise, assignable to Promise); the resolver casts it
// to this type. Tests inject a fake of the same shape.
//   - messaging10dlc.brand.create                → POST /10dlc/brand        → TelnyxBrand
//   - messaging10dlc.brand.externalVetting.order → POST /10dlc/brand/{id}/externalVetting
//   - messaging10dlc.campaignBuilder.submit      → POST /10dlc/campaignBuilder → TelnyxCampaignCsp
//   - messagingProfiles.create                   → POST /messaging_profiles
//   - availablePhoneNumbers.list                 → GET  /available_phone_numbers
//   - numberOrders.create                        → POST /number_orders
//   - messaging10dlc.phoneNumberCampaigns.create → POST /10dlc/phoneNumberCampaigns
// ---------------------------------------------------------------------------

interface TelnyxBrandResult { brandId?: string; identityStatus?: string }
interface TelnyxVettingResult { vettingId?: string }
interface TelnyxCampaignResult { campaignId?: string; campaignStatus?: string }
interface TelnyxMessagingProfileResult { data?: { id?: string } }
interface TelnyxAvailableNumbersResult { data?: Array<{ phone_number?: string }> }
interface TelnyxNumberOrderResult {
    data?: { id?: string; phone_numbers?: Array<{ id?: string; phone_number?: string }> };
}
interface TelnyxPhoneNumberCampaignResult { phoneNumber?: string; assignmentStatus?: string }
// VerificationRequestEgress is flat (no .data wrapper). Both `id` and
// `verificationRequestId` are required on the real type; we persist `id` as
// `tfvSid` because `requests.retrieve(id)` keys on it and the retrieve/status
// response (`VerificationRequestStatus`) carries only `id`, not
// `verificationRequestId`.
interface TelnyxTfvResult { id?: string; verificationRequestId?: string; verificationStatus?: string }

// --- syncStatus retrieve return shapes (pinned from node_modules/telnyx) ----
// All three retrieve responses are FLAT (no `.data` wrapper) — unlike
// messagingProfiles.create / numberOrders.create which ARE `.data`-wrapped.
//   brand.retrieve(brandID)        → BrandRetrieveResponse extends TelnyxBrand
//       → { brandId?, identityStatus?: BrandIdentityStatus, failureReasons? }
//   campaign.retrieve(campaignID)  → TelnyxCampaignCsp
//       → { campaignId, campaignStatus?, failureReasons? }
//   requests.retrieve(id)          → VerificationRequestStatus
//       → { id, verificationStatus: TfVerificationStatus, reason? }
interface TelnyxBrandStatusResult { brandId?: string; identityStatus?: string; failureReasons?: string | null }
interface TelnyxCampaignStatusResult { campaignId?: string; campaignStatus?: string; failureReasons?: string | null }
interface TelnyxTfvStatusResult { id?: string; verificationStatus?: string; reason?: string | null }

export interface TelnyxComplianceClient {
    messaging10dlc: {
        brand: {
            create(body: Record<string, unknown>): Promise<TelnyxBrandResult>;
            externalVetting: {
                order(brandID: string, body: { evpId: string; vettingClass: string }): Promise<TelnyxVettingResult>;
            };
            retrieve(brandID: string): Promise<TelnyxBrandStatusResult>;
        };
        campaign: {
            retrieve(campaignID: string): Promise<TelnyxCampaignStatusResult>;
        };
        campaignBuilder: {
            submit(body: Record<string, unknown>): Promise<TelnyxCampaignResult>;
        };
        phoneNumberCampaigns: {
            create(body: { campaignId: string; phoneNumber: string }): Promise<TelnyxPhoneNumberCampaignResult>;
        };
    };
    messagingProfiles: {
        create(body: { name: string; whitelisted_destinations: string[] }): Promise<TelnyxMessagingProfileResult>;
    };
    availablePhoneNumbers: {
        list(query: { filter: Record<string, unknown> }): Promise<TelnyxAvailableNumbersResult>;
    };
    numberOrders: {
        create(body: {
            phone_numbers: Array<{ phone_number: string }>;
            messaging_profile_id?: string;
        }): Promise<TelnyxNumberOrderResult>;
    };
    messagingTollfree: {
        verification: {
            requests: {
                create(body: Record<string, unknown>): Promise<TelnyxTfvResult>;
                retrieve(id: string): Promise<TelnyxTfvStatusResult>;
            };
        };
    };
}

// ---------------------------------------------------------------------------
// Normalized status mapping (real Telnyx enums → ComplianceStatus). The raw
// enum values are pinned from node_modules/telnyx; the normalized targets are
// the ComplianceStatus union. `approved`/`rejected` are terminal and only set
// at the terminal entity (campaign for sp10dlc, tfv for tollfree).
// ---------------------------------------------------------------------------

// TfVerificationStatus = 'Verified'|'Rejected'|'Waiting For Vendor'|
//   'Waiting For Customer'|'Waiting For Telnyx'|'In Progress'.
function normalizeTfvStatus(raw: string): 'approved' | 'rejected' | 'tfv_pending' {
    if (raw === 'Verified') return 'approved';
    if (raw === 'Rejected') return 'rejected';
    return 'tfv_pending';
}

// BrandIdentityStatus = 'VERIFIED'|'UNVERIFIED'|'SELF_DECLARED'|'VETTED_VERIFIED'.
// Brand approval advances toward the campaign step but is NOT terminal — it can
// only ever set `brand_pending` (the campaign is the terminal sp10dlc entity),
// and per no-regress it must never roll back a row already at campaign_pending /
// approved. UNVERIFIED / SELF_DECLARED stay brand_pending. There is no brand
// identity value that maps to `rejected`.
function isBrandApproved(raw: string): boolean {
    return raw === 'VERIFIED' || raw === 'VETTED_VERIFIED';
}

// campaignStatus = 'TCR_PENDING'|'TCR_SUSPENDED'|'TCR_EXPIRED'|'TCR_ACCEPTED'|
//   'TCR_FAILED'|'TELNYX_ACCEPTED'|'TELNYX_FAILED'|'MNO_PENDING'|'MNO_ACCEPTED'|
//   'MNO_REJECTED'|'MNO_PROVISIONED'|'MNO_PROVISIONING_FAILED'.
// CHOSEN `approved` SET (LIVE-tunable): { MNO_PROVISIONED, MNO_ACCEPTED } — both
// mean the mobile network operator has accepted/provisioned the campaign, i.e.
// it is operational on the carrier. TELNYX_ACCEPTED / TCR_ACCEPTED are EARLIER
// pipeline (Telnyx- / registry-level) acceptance and are intentionally NOT
// treated as operational. `rejected` = any *_FAILED / MNO_REJECTED / TCR_SUSPENDED
// / TCR_EXPIRED. Everything else stays campaign_pending.
const CAMPAIGN_APPROVED = new Set(['MNO_PROVISIONED', 'MNO_ACCEPTED']);
const CAMPAIGN_REJECTED = new Set([
    'TCR_FAILED', 'TELNYX_FAILED', 'MNO_REJECTED', 'MNO_PROVISIONING_FAILED', 'TCR_SUSPENDED', 'TCR_EXPIRED',
]);
function normalizeCampaignStatus(raw: string): 'approved' | 'rejected' | 'campaign_pending' {
    if (CAMPAIGN_APPROVED.has(raw)) return 'approved';
    if (CAMPAIGN_REJECTED.has(raw)) return 'rejected';
    return 'campaign_pending';
}

// ---------------------------------------------------------------------------
// Webhook event_type → normalized entity. The Telnyx webhook payloads are NOT
// SDK-modeled (webhook events have no type in node_modules/telnyx), so these
// event_type strings + payload field paths are a BEST-UNDERSTANDING mapping
// based on Telnyx's documented entity-status webhook naming.
//
// !!! LIVE-CONFIRMATION REQUIRED !!! Before the managed path is activated, the
// exact event_type strings AND the payload field paths (brandId / identityStatus
// / failureReasons, campaignId / campaignStatus / failureReasons, id /
// verificationStatus / reason) MUST be confirmed against the live Telnyx webhook
// docs / a real captured event. The whole managed path is LIVE-gated; these
// mock fixtures prove the parse logic, LIVE confirms the strings.
// ---------------------------------------------------------------------------
const BRAND_EVENT_TYPES = new Set(['brand.status.updated', 'brand.update']);
const CAMPAIGN_EVENT_TYPES = new Set(['campaign.status.updated', 'campaign.update']);
const TFV_EVENT_TYPES = new Set(['tollfree_verification.updated', 'verification_request.update']);

interface TelnyxWebhookPayload {
    brandId?: string;
    identityStatus?: string;
    campaignId?: string;
    campaignStatus?: string;
    id?: string;
    verificationStatus?: string;
    failureReasons?: string | null;
    reason?: string | null;
}
interface TelnyxWebhookEnvelope {
    data?: { event_type?: string; payload?: TelnyxWebhookPayload };
}

// External vetting order defaults. evpId names the external vetting provider
// (e.g. AEGIS) and vettingClass the requested classification; neither is carried
// by businessInfo. These literal defaults are NOT secrets — they are public
// Telnyx enum values — but a managed deployment may want them configurable.
const VETTING_EVP_ID = 'AEGIS';
const VETTING_CLASS = 'STANDARD';

// Home-inspection businesses register under the real-estate vertical with a
// for-profit private entity type. businessInfo cannot supply EIN / structured
// address / stock info, so the rest are sensible literal defaults (see report).
const BRAND_ENTITY_TYPE = 'PRIVATE_PROFIT';
const BRAND_VERTICAL = 'REAL_ESTATE';
const BRAND_COUNTRY = 'US';
const CAMPAIGN_USECASE = 'AGENTS_FRANCHISES';

function parseMeta(row: ComplianceRow): Record<string, unknown> {
    if (!row.providerMeta) return {};
    try {
        const parsed = JSON.parse(row.providerMeta);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

export class TelnyxComplianceProvider implements ComplianceProvider {
    readonly id: ComplianceProviderId = 'telnyx';

    constructor(private client: TelnyxComplianceClient) {}

    /**
     * Idempotent managed provisioning orchestrator (10DLC). Each step is GUARDED
     * by its persisted id: a step whose id already exists is skipped (resume). A
     * step that throws stops the chain with all prior ids persisted, so a later
     * call resumes from the first missing id. Step ordering follows Telnyx
     * resource dependencies:
     *
     *   brand → vetting → campaign → messaging profile → number(buy + assign)
     *
     * Final complianceStatus after a full run = 'campaign_pending'. 'approved' is
     * set asynchronously by the webhook / sync poll, never here.
     */
    async provision(input: ProvisionInput, store: ComplianceStateStore): Promise<ComplianceSnapshot> {
        const { tenantId, channel, businessInfo, statusCallbackUrl } = input;

        if (channel === 'tollfree') {
            return this.provisionTollfree(input, store);
        }

        let row = (await store.load(tenantId)) ?? (await store.init(tenantId, this.id));

        // Step 1: brand registration (per tenant). No Trust Hub profile precedes
        // it — brand creation is the first managed entity, so the first persisted
        // status is 'brand_pending'. statusCallbackUrl is registered as the brand
        // webhook so Telnyx delivers status transitions automatically.
        if (!row.brandSid) {
            const b = await this.client.messaging10dlc.brand.create({
                country: BRAND_COUNTRY,
                displayName: businessInfo.legalName,
                companyName: businessInfo.legalName,
                email: businessInfo.email ?? '',
                entityType: BRAND_ENTITY_TYPE,
                vertical: BRAND_VERTICAL,
                firstName: businessInfo.repName,
                street: businessInfo.address,
                ...(statusCallbackUrl ? { webhookURL: statusCallbackUrl } : {}),
            });
            const brandId = b.brandId;
            if (!brandId) throw new Error('Telnyx brand.create returned no brandId');
            row = await store.persist(tenantId, {
                brandSid: brandId,
                brandStatus: b.identityStatus ?? null,
                complianceStatus: 'brand_pending',
            });
        }

        // Step 2: submit brand vetting — needs brandSid. The vetting id has no
        // Twilio-shaped SID column, so it is stored in providerMeta (JSON). Guarded
        // on the presence of that key so a resume does not re-order vetting.
        if (!parseMeta(row).vettingId) {
            const v = await this.client.messaging10dlc.brand.externalVetting.order(row.brandSid!, {
                evpId: VETTING_EVP_ID,
                vettingClass: VETTING_CLASS,
            });
            const meta = { ...parseMeta(row), vettingId: v.vettingId ?? null };
            row = await store.persist(tenantId, { providerMeta: JSON.stringify(meta) });
        }

        // Step 3: campaign — needs brandSid. campaignBuilder.submit creates the
        // campaign; usecase AGENTS_FRANCHISES.
        if (!row.campaignSid) {
            const c = await this.client.messaging10dlc.campaignBuilder.submit({
                brandId: row.brandSid!,
                usecase: CAMPAIGN_USECASE,
                description: `Inspection notifications for ${businessInfo.legalName}`,
                messageFlow: 'Clients opt in via the inspection booking form.',
                sample1: 'Your inspection report is ready. View it at {{link}}.',
                sample2: 'Reminder: your inspection is scheduled for {{date}}.',
                embeddedLink: true,
                embeddedPhone: false,
                subscriberOptin: true,
                subscriberOptout: true,
                subscriberHelp: true,
                termsAndConditions: true,
                ...(statusCallbackUrl ? { webhookURL: statusCallbackUrl } : {}),
            });
            const campaignId = c.campaignId;
            if (!campaignId) throw new Error('Telnyx campaignBuilder.submit returned no campaignId');
            row = await store.persist(tenantId, {
                campaignSid: campaignId,
                campaignStatus: c.campaignStatus ?? null,
                complianceStatus: 'campaign_pending',
            });
        }

        // Step 4: messaging profile — the sending container the bought number is
        // ordered into.
        if (!row.messagingResourceSid) {
            const mp = await this.client.messagingProfiles.create({
                name: businessInfo.legalName,
                whitelisted_destinations: [BRAND_COUNTRY],
            });
            const mpId = mp.data?.id;
            if (!mpId) throw new Error('Telnyx messagingProfiles.create returned no id');
            row = await store.persist(tenantId, { messagingResourceSid: mpId });
        }

        // Step 5: buy number (guarded on provisionedNumberSid), then assign it to
        // the campaign (guarded separately on senderAttached). Independent markers
        // so a crash between buy and assign resumes by assigning the already-bought
        // number — never re-buying, never orphaning. (Same invariant as Twilio's
        // buy/attach split; here "attach" is the phone↔campaign assignment.)
        if (!row.provisionedNumberSid) {
            row = await this.buyNumber(tenantId, businessInfo.areaCode, row.messagingResourceSid!, store);
        }
        if (!row.senderAttached) {
            await this.assignToCampaign(row.campaignSid!, row.provisionedNumber!);
            row = await store.persist(tenantId, { senderAttached: true });
        }

        return { complianceStatus: row.complianceStatus, rejectionReason: row.rejectionReason ?? null };
    }

    /**
     * Search a US SMS-capable DID and order it into the messaging profile, then
     * persist (provisionedNumber, provisionedNumberSid) BEFORE returning — so a
     * crash after the order resumes by assigning, not re-buying.
     *   search → availablePhoneNumbers.list (filter country_code/features/limit;
     *            areaCode → national_destination_code)
     *   buy    → numberOrders.create (messaging_profile_id ties it to the profile)
     */
    private async buyNumber(
        tenantId: string,
        areaCode: string | undefined,
        messagingProfileId: string,
        store: ComplianceStateStore,
    ): Promise<ComplianceRow> {
        const available = await this.client.availablePhoneNumbers.list({
            filter: {
                country_code: BRAND_COUNTRY,
                features: ['SMS'],
                limit: 1,
                ...(areaCode ? { national_destination_code: areaCode } : {}),
            },
        });
        const phone = available.data?.[0]?.phone_number;
        if (!phone) throw new Error('No available Telnyx numbers for the requested area');

        const order = await this.client.numberOrders.create({
            phone_numbers: [{ phone_number: phone }],
            messaging_profile_id: messagingProfileId,
        });
        const ordered = order.data?.phone_numbers?.[0];
        const numberSid = ordered?.id ?? order.data?.id;
        const e164 = ordered?.phone_number ?? phone;
        if (!numberSid) throw new Error('Telnyx numberOrders.create returned no phone-number id');

        return store.persist(tenantId, {
            provisionedNumber: e164,
            provisionedNumberSid: numberSid,
        });
    }

    /** Assign a bought number (E.164) to the campaign (POST /10dlc/phoneNumberCampaigns). */
    private async assignToCampaign(campaignId: string, phoneNumber: string): Promise<void> {
        const assigned = await this.client.messaging10dlc.phoneNumberCampaigns.create({ campaignId, phoneNumber });
        // A success with no phoneNumber echoed back is not a valid assignment —
        // surface it rather than mark senderAttached on a non-assignment.
        if (!assigned.phoneNumber) throw new Error('Telnyx phoneNumberCampaigns.create returned no phoneNumber');
    }

    /**
     * Idempotent toll-free verification orchestrator. Step ordering:
     *
     *   messaging profile → toll-free number (buy) → TFV submission
     *
     * Each step is guarded by its persisted id (resume-safe). The sp10dlc steps
     * (brand/vetting/campaign/assign) do NOT run on this path. Final
     * complianceStatus after a full run = 'tfv_pending'. 'approved' is set
     * asynchronously by webhook / sync poll (Task 3), never here.
     *
     * NOTE: businessInfo is intentionally sparse for LIVE registration (no EIN /
     * full structured address / contact phone). Literal defaults are used where
     * businessInfo cannot supply the required fields — this is a tracked
     * LIVE-prerequisite gap, not a concern for orchestration correctness.
     */
    private async provisionTollfree(input: ProvisionInput, store: ComplianceStateStore): Promise<ComplianceSnapshot> {
        const { tenantId, businessInfo, statusCallbackUrl } = input;
        let row = (await store.load(tenantId)) ?? (await store.init(tenantId, this.id));

        // Step 1: messaging profile — the sending container the bought toll-free
        // number is ordered into. Same API call as sp10dlc Step 4.
        if (!row.messagingResourceSid) {
            const mp = await this.client.messagingProfiles.create({
                name: businessInfo.legalName,
                whitelisted_destinations: [BRAND_COUNTRY],
            });
            const mpId = mp.data?.id;
            if (!mpId) throw new Error('Telnyx messagingProfiles.create returned no id');
            row = await store.persist(tenantId, { messagingResourceSid: mpId });
        }

        // Step 2: buy a toll-free number (guarded on provisionedNumberSid). Persists
        // BEFORE returning so a crash after buy resumes by advancing to TFV, not
        // re-buying — same invariant as sp10dlc buy/assign split.
        if (!row.provisionedNumberSid) {
            row = await this.buyTollfreeNumber(tenantId, row.messagingResourceSid!, store);
        }

        // Step 3: submit toll-free verification. Guarded on tfvSid so a resume does
        // not re-submit. `tfvSid` stores the create response's `id` — that is the
        // path key `requests.retrieve(id)` consumes for sync polling, and the only
        // id present on the `VerificationRequestStatus` shape (the flat
        // `VerificationRequestEgress.verificationRequestId` is absent from the
        // status/retrieve response, so it cannot be the match key).
        if (!row.tfvSid) {
            const repParts = (businessInfo.repName ?? '').trim().split(/\s+/);
            const firstName = repParts[0] ?? '';
            const lastName = repParts.length > 1 ? repParts.slice(1).join(' ') : firstName;

            const tfv = await this.client.messagingTollfree.verification.requests.create({
                businessName: businessInfo.legalName,
                businessAddr1: businessInfo.address,
                // Structured city/state/zip not available from businessInfo — literal
                // defaults used here; LIVE registration requires enrichment before submit.
                businessCity: 'Austin',
                businessState: 'Texas',
                businessZip: '78701',
                businessContactEmail: businessInfo.email ?? '',
                businessContactFirstName: firstName,
                businessContactLastName: lastName,
                // Use the bought toll-free line as the business contact number — the
                // only E.164 we have at this stage. LIVE prerequisite: supply a direct
                // contact phone via businessInfo enrichment.
                businessContactPhone: row.provisionedNumber!,
                corporateWebsite: 'https://inspectorhub.io',
                messageVolume: '10,000',
                useCase: 'Real Estate Services',
                useCaseSummary: 'Inspection scheduling, report delivery, and follow-up notifications for residential and commercial property inspections.',
                optInWorkflow: 'Clients opt in via the inspection booking form when scheduling a property inspection.',
                optInWorkflowImageURLs: [],
                productionMessageContent: 'Your inspection report for [address] is now available. View it at: [link]',
                additionalInformation: '',
                phoneNumbers: [{ phoneNumber: row.provisionedNumber! }],
                ...(statusCallbackUrl ? { webhookUrl: statusCallbackUrl } : {}),
            });

            const tfvSid = tfv.id;
            if (!tfvSid) throw new Error('Telnyx TFV create returned no id');
            row = await store.persist(tenantId, {
                tfvSid,
                complianceStatus: 'tfv_pending',
            });
        }

        return { complianceStatus: row.complianceStatus, rejectionReason: row.rejectionReason ?? null };
    }

    /**
     * Search a US toll-free SMS-capable number and order it into the messaging
     * profile, then persist (provisionedNumber, provisionedNumberSid) BEFORE
     * returning — so a crash after the order resumes by submitting TFV, not
     * re-buying. Mirrors buyNumber but filters phone_number_type: toll_free and
     * omits national_destination_code (toll-free numbers have no area code).
     */
    private async buyTollfreeNumber(
        tenantId: string,
        messagingProfileId: string,
        store: ComplianceStateStore,
    ): Promise<ComplianceRow> {
        const available = await this.client.availablePhoneNumbers.list({
            filter: {
                country_code: BRAND_COUNTRY,
                phone_number_type: 'toll_free',
                features: ['SMS'],
                limit: 1,
            },
        });
        const phone = available.data?.[0]?.phone_number;
        if (!phone) throw new Error('No available Telnyx toll-free numbers');

        const order = await this.client.numberOrders.create({
            phone_numbers: [{ phone_number: phone }],
            messaging_profile_id: messagingProfileId,
        });
        const ordered = order.data?.phone_numbers?.[0];
        const numberSid = ordered?.id ?? order.data?.id;
        const e164 = ordered?.phone_number ?? phone;
        if (!numberSid) throw new Error('Telnyx numberOrders.create returned no phone-number id for toll-free');

        return store.persist(tenantId, {
            provisionedNumber: e164,
            provisionedNumberSid: numberSid,
        });
    }

    // --- webhook verify / parse / cron sync ---------------------------------

    /**
     * Telnyx Ed25519 webhook-signature verification. Delegates to the shared
     * verifyTelnyxSignature helper (Ed25519 over `${timestamp}|${rawBody}`, ±300s
     * anti-replay, fail-closed). `ctx.secret` is the base64 Ed25519 public key.
     * The helper already returns false (never throws) on missing headers / bad
     * base64, so missing `telnyx-timestamp` / `telnyx-signature-ed25519` fail closed.
     */
    verifyWebhookSignature(ctx: WebhookVerifyCtx): Promise<boolean> {
        return verifyTelnyxSignature(
            ctx.secret,
            ctx.headers['telnyx-timestamp'] ?? '',
            ctx.rawBody,
            ctx.headers['telnyx-signature-ed25519'] ?? '',
            ctx.nowMs,
        );
    }

    /**
     * Parse a Telnyx compliance-status webhook into a normalized event. Telnyx
     * wraps events as `{ data: { event_type, payload } }`. The `event_type`
     * selects the entity (brand → campaign → tfv detection order, first match
     * wins, mirroring the Twilio provider); `rawStatus` / `entitySid` /
     * `rejectionReason` are pulled from the matching payload fields. Returns null
     * for unparseable bodies and unrecognized event types.
     *
     * NOTE: event_type strings + payload field paths are a best-understanding
     * mapping pending LIVE confirmation — see the BRAND/CAMPAIGN/TFV_EVENT_TYPES
     * docblock at the top of this file.
     */
    parseCallback(_headers: Record<string, string>, rawBody: string): ComplianceEvent | null {
        let env: TelnyxWebhookEnvelope;
        try {
            env = JSON.parse(rawBody) as TelnyxWebhookEnvelope;
        } catch {
            return null; // unparseable body
        }
        const eventType = env.data?.event_type ?? '';
        const payload = env.data?.payload ?? {};

        // Brand branch.
        if (BRAND_EVENT_TYPES.has(eventType)) {
            return {
                entity: 'brand',
                rawStatus: payload.identityStatus ?? '',
                rejectionReason: payload.failureReasons ?? null,
                entitySid: payload.brandId ?? '',
            };
        }
        // Campaign branch.
        if (CAMPAIGN_EVENT_TYPES.has(eventType)) {
            return {
                entity: 'campaign',
                rawStatus: payload.campaignStatus ?? '',
                rejectionReason: payload.failureReasons ?? null,
                entitySid: payload.campaignId ?? '',
            };
        }
        // TFV branch.
        if (TFV_EVENT_TYPES.has(eventType)) {
            return {
                entity: 'tfv',
                rawStatus: payload.verificationStatus ?? '',
                rejectionReason: payload.reason ?? null,
                entitySid: payload.id ?? '',
            };
        }
        return null; // unrecognized event type
    }

    /**
     * Cron-poll fallback: re-read status from Telnyx for a non-terminal managed
     * row and advance the normalized enum. Branches are mutually exclusive
     * (`else if`) and ordered terminal-entity-first so a terminal verdict can't
     * be clobbered:
     *   - TFV (tollfree, terminal): requests.retrieve(tfvSid) → Verified/Rejected.
     *   - Campaign (sp10dlc, terminal): campaign.retrieve(campaignSid). Unlike
     *     Twilio (no campaign REST read), Telnyx exposes the campaign status, so
     *     this advances to approved/rejected directly.
     *   - Brand (sp10dlc, intermediate): brand.retrieve(brandSid). Brand approval
     *     only advances to brand_pending and, per no-regress, NEVER rolls back a
     *     row already at campaign_pending / approved (guarded explicitly AND by the
     *     else-if: a row with a campaignSid never reaches this branch).
     */
    async syncStatus(input: { tenantId: string }, store: ComplianceStateStore): Promise<ComplianceSnapshot> {
        const { tenantId } = input;
        const row = await store.load(tenantId);
        if (!row) return { complianceStatus: 'not_started', rejectionReason: null };

        const updates: Parameters<ComplianceStateStore['persist']>[1] = {};

        if (row.tfvSid) {
            const tfv = await this.client.messagingTollfree.verification.requests.retrieve(row.tfvSid);
            const raw = tfv.verificationStatus ?? '';
            updates.tfvStatus = raw;
            const norm = normalizeTfvStatus(raw);
            if (norm === 'approved') {
                updates.complianceStatus = 'approved';
                updates.rejectionReason = null;
            } else if (norm === 'rejected') {
                updates.complianceStatus = 'rejected';
                updates.rejectionReason = tfv.reason ?? raw;
            }
        } else if (row.campaignSid) {
            const camp = await this.client.messaging10dlc.campaign.retrieve(row.campaignSid);
            const raw = camp.campaignStatus ?? '';
            updates.campaignStatus = raw;
            const norm = normalizeCampaignStatus(raw);
            if (norm === 'approved') {
                updates.complianceStatus = 'approved';
                updates.rejectionReason = null;
            } else if (norm === 'rejected') {
                updates.complianceStatus = 'rejected';
                updates.rejectionReason = camp.failureReasons ?? raw;
            }
            // else: stays campaign_pending (no change).
        } else if (row.brandSid) {
            const brand = await this.client.messaging10dlc.brand.retrieve(row.brandSid);
            const raw = brand.identityStatus ?? '';
            updates.brandStatus = raw;
            // No-regress: brand approval can only set brand_pending, never roll back
            // a row already at campaign_pending / approved.
            if (isBrandApproved(raw)
                && row.complianceStatus !== 'approved'
                && row.complianceStatus !== 'campaign_pending') {
                updates.complianceStatus = 'brand_pending';
            }
        }

        const newStatus = updates.complianceStatus ?? row.complianceStatus;
        const newRejectionReason = 'rejectionReason' in updates
            ? (updates.rejectionReason ?? null)
            : (row.rejectionReason ?? null);
        if (Object.keys(updates).length > 0) await store.persist(tenantId, updates);
        return { complianceStatus: newStatus, rejectionReason: newRejectionReason };
    }

    /** Public compliance-status webhook URL for a tenant slug (single source of truth). */
    webhookUrl(baseUrl: string, tenantSlug: string): string {
        return complianceWebhookUrl(baseUrl, 'telnyx', tenantSlug);
    }
}

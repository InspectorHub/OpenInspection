// server/lib/messaging/providers/twilio-compliance.ts
//
// TwilioComplianceProvider — behaviour-equivalent port of the hand-rolled
// managed-compliance orchestration (server/services/messaging-compliance.service.ts
// + server/lib/messaging/twilio.ts) onto the official `twilio-node` SDK, behind
// the ComplianceProvider interface, persisting through the injected state store.
//
// The constructor takes an ALREADY-BUILT client implementing TwilioComplianceClient.
// Production builds it with the fetch-based REST client (no twilio-node SDK — the
// full SDK is dropped to stay under the Workers Free bundle limit):
//   createTwilioRestClient({ accountSid, apiKeySid, apiKeySecret })  (see resolve-compliance-provider.ts)
// Tests inject a structural fake recording each resource call.
//
// MAPPING — hand-rolled REST call → twilio-node equivalent (URL/method matched
// against node_modules/twilio/lib/rest). Three endpoints use the SDK's generic
// `client.request({ method, uri, data })` path (still on the SDK + our fetch
// transport) because twilio-node v6 models them with a DIFFERENT param shape than
// the ISV flow this code drives — using the modeled resource would change the wire
// params and break behaviour-equivalence:
//
//   - CustomerProfiles create: twilio-node's customerProfiles.create REQUIRES
//     `policySid` and sends `StatusCallback`; the ISV flow here sends
//     `IsvRegisteringForSelfOrSubaccounts` + `StatusCallbackUrl` and NO policySid.
//   - Usa2p (campaign) create: carries the `MessageSamples[]` array; the SDK
//     serializes arrays in a form our minimal fetch transport cannot reproduce,
//     so we send the exact indexed-key form the hand-rolled code used.
//   - Tollfree Verifications create: twilio-node's tollfreeVerifications.create
//     models the newer schema (businessName/website/…) and does NOT model
//     `UseCaseDescription` or `MessagingServiceSid`, which the ISV flow requires.
//
// All other calls map to first-class twilio-node resource methods (see provision).
//
// DRIFT SURFACE — Twilio field names / resource paths live in THIS file only.

import type {
    ComplianceProvider,
    ComplianceProviderId,
    ComplianceEvent,
    ComplianceSnapshot,
    ProvisionInput,
    WebhookVerifyCtx,
} from '../compliance-provider';
import type { ComplianceStateStore } from '../compliance-state-store';
import { validateTwilioSignature } from '../twilio';
import { complianceWebhookUrl } from '../../sms/compliance-webhook';

// ---------------------------------------------------------------------------
// Minimal structural type of the twilio-node client surface the provider uses.
// The real `twilio(...)` client structurally satisfies these names; the resolver
// (Task 5/6) casts it to this type. Tests inject a fake of the same shape.
// ---------------------------------------------------------------------------

interface TwilioGenericResponse { statusCode: number; body: unknown; }

interface MessagingServiceContext {
    phoneNumbers: { create(params: { phoneNumberSid: string }): Promise<{ sid: string }> };
}
interface MessagingServicesListInstance {
    (sid: string): MessagingServiceContext;
    create(params: { friendlyName: string }): Promise<{ sid: string }>;
}
interface BrandRegistrationsListInstance {
    create(params: {
        customerProfileBundleSid: string;
        a2PProfileBundleSid: string;
        brandType: string;
    }): Promise<{ sid: string; status: string }>;
    list(params?: { limit?: number }): Promise<Array<{ sid: string; status: string }>>;
}
interface TollfreeVerificationsListInstance {
    list(params?: { limit?: number }): Promise<Array<{ sid: string; status: string }>>;
}
interface AvailableNumbersList {
    list(params?: { areaCode?: string; limit?: number }): Promise<Array<{ phoneNumber: string }>>;
}
interface AvailablePhoneNumberCountryContext {
    local: AvailableNumbersList;
    tollFree: AvailableNumbersList;
}
interface IncomingPhoneNumbersListInstance {
    create(params: { phoneNumber: string }): Promise<{ sid: string; phoneNumber: string }>;
}

export interface TwilioComplianceClient {
    request(opts: { method: string; uri: string; data?: Record<string, string> }): Promise<TwilioGenericResponse>;
    messaging: {
        v1: {
            brandRegistrations: BrandRegistrationsListInstance;
            services: MessagingServicesListInstance;
            tollfreeVerifications: TollfreeVerificationsListInstance;
        };
    };
    availablePhoneNumbers(country: string): AvailablePhoneNumberCountryContext;
    incomingPhoneNumbers: IncomingPhoneNumbersListInstance;
}

// Twilio REST hostnames for the generic-request calls (full absolute URIs; the
// SDK's client.request rewrites only the hostname for edge/region routing).
const TRUSTHUB = 'https://trusthub.twilio.com';
const MESSAGING = 'https://messaging.twilio.com';

const isApproved = (s: string) => s === 'TWILIO_APPROVED' || s === 'APPROVED';
const isRejected = (s: string) => s === 'TWILIO_REJECTED' || s === 'REJECTED' || s === 'FAILED';

export class TwilioComplianceProvider implements ComplianceProvider {
    readonly id: ComplianceProviderId = 'twilio';

    constructor(private client: TwilioComplianceClient) {}

    /**
     * POST through the SDK's generic transport and surface Twilio's error message
     * on a non-2xx (mirrors the hand-rolled `throwIfError`; client.request does NOT
     * throw on error status — only higher resource layers do).
     */
    private async genericPost(uri: string, data: Record<string, string>): Promise<{ sid: string; status?: string }> {
        const resp = await this.client.request({ method: 'post', uri, data });
        if (resp.statusCode < 200 || resp.statusCode >= 300) {
            const msg = (resp.body as { message?: string } | null)?.message ?? `Twilio ${resp.statusCode}`;
            throw new Error(msg);
        }
        const body = (resp.body ?? {}) as { sid: string; status?: string };
        return body;
    }

    /**
     * Idempotent managed provisioning orchestrator. Each step is GUARDED by its
     * persisted SID: a step whose SID already exists is skipped (resume). A step
     * that throws stops the chain with all prior SIDs persisted, so a later call
     * resumes from the first missing SID. Step ordering follows Twilio resource
     * dependencies (each step's inputs are prior-persisted SIDs):
     *
     *   sp10dlc:  customer profile → brand → messaging service → campaign → number(buy+attach)
     *   tollfree: customer profile → messaging service → number(buy+attach) → tfv
     *
     * Final complianceStatus after a full run = 'campaign_pending' (sp10dlc) or
     * 'tfv_pending' (tollfree). 'approved' is set asynchronously by the webhook /
     * sync poll, never here.
     */
    async provision(input: ProvisionInput, store: ComplianceStateStore): Promise<ComplianceSnapshot> {
        const { tenantId, channel, businessInfo, statusCallbackUrl } = input;
        let row = (await store.load(tenantId)) ?? (await store.init(tenantId, this.id));

        // Step 1 (shared): customer profile — generic (ISV variant param shape).
        // statusCallbackUrl is registered HERE so Twilio delivers status transitions
        // automatically; only NEW provisions register it (a resume whose
        // customerProfileSid already exists skips this step).
        if (!row.customerProfileSid) {
            const cp = await this.genericPost(`${TRUSTHUB}/v1/CustomerProfiles`, {
                FriendlyName: businessInfo.legalName,
                Email: businessInfo.email ?? '',
                IsvRegisteringForSelfOrSubaccounts: 'false',
                ...(statusCallbackUrl ? { StatusCallbackUrl: statusCallbackUrl } : {}),
            });
            row = await store.persist(tenantId, {
                customerProfileSid: cp.sid,
                customerProfileStatus: cp.status ?? 'PENDING',
                complianceStatus: 'profile_pending',
            });
        }

        if (channel === 'sp10dlc') {
            // Step 2 (sp10dlc): brand registration — needs customerProfileSid.
            // → messaging.v1.brandRegistrations.create (POST /v1/a2p/BrandRegistrations)
            if (!row.brandSid) {
                const b = await this.client.messaging.v1.brandRegistrations.create({
                    customerProfileBundleSid: row.customerProfileSid!,
                    a2PProfileBundleSid: row.customerProfileSid!, // same bundle for sole-prop
                    brandType: 'SOLE_PROPRIETOR',
                });
                row = await store.persist(tenantId, {
                    brandSid: b.sid,
                    brandStatus: b.status,
                    complianceStatus: 'brand_pending',
                });
            }

            // Step 3 (sp10dlc): messaging service.
            // → messaging.v1.services.create (POST /v1/Services)
            if (!row.messagingResourceSid) {
                const ms = await this.client.messaging.v1.services.create({ friendlyName: businessInfo.legalName });
                row = await store.persist(tenantId, { messagingResourceSid: ms.sid });
            }

            // Step 4 (sp10dlc): campaign — needs messagingResourceSid + brandSid.
            // generic (Usa2p MessageSamples[] array form).
            if (!row.campaignSid) {
                const c = await this.genericPost(
                    `${MESSAGING}/v1/Services/${row.messagingResourceSid}/Compliance/Usa2p`,
                    {
                        BrandRegistrationSid: row.brandSid!,
                        Description: `Inspection notifications for ${businessInfo.legalName}`,
                        MessageFlow: 'Clients opt in via the inspection booking form.',
                        UsAppToPersonUsecase: 'MIXED',
                        HasEmbeddedLinks: 'true',
                        HasEmbeddedPhone: 'false',
                        'MessageSamples[0]': 'Your inspection report is ready. View it at {{link}}.',
                        'MessageSamples[1]': 'Reminder: your inspection is scheduled for {{date}}.',
                    },
                );
                row = await store.persist(tenantId, {
                    campaignSid: c.sid,
                    campaignStatus: c.status,
                    complianceStatus: 'campaign_pending',
                });
            }

            // Step 5 (sp10dlc): buy number (guarded on provisionedNumberSid), then
            // attach (guarded separately on senderAttached). Independent markers so a
            // crash between buy and attach resumes by attaching the already-bought
            // number — never re-buying, never orphaning.
            if (!row.provisionedNumberSid) {
                row = await this.buyNumber(tenantId, 'local', businessInfo.areaCode, store);
            }
            if (!row.senderAttached) {
                await this.attachSender(row.messagingResourceSid!, row.provisionedNumberSid!);
                row = await store.persist(tenantId, { senderAttached: true });
            }
        } else {
            // tollfree channel

            // Step 2 (tollfree): messaging service.
            if (!row.messagingResourceSid) {
                const ms = await this.client.messaging.v1.services.create({ friendlyName: businessInfo.legalName });
                row = await store.persist(tenantId, { messagingResourceSid: ms.sid });
            }

            // Step 3 (tollfree): buy number (guarded), then attach (guarded separately).
            if (!row.provisionedNumberSid) {
                row = await this.buyNumber(tenantId, 'tollfree', businessInfo.areaCode, store);
            }
            if (!row.senderAttached) {
                await this.attachSender(row.messagingResourceSid!, row.provisionedNumberSid!);
                row = await store.persist(tenantId, { senderAttached: true });
            }

            // Step 4 (tollfree): toll-free verification — needs provisionedNumberSid +
            // messagingResourceSid. generic (ISV param shape: UseCaseDescription +
            // MessagingServiceSid). tollfreePhoneNumberSid is the PN... SID, not E.164.
            if (!row.tfvSid) {
                const tfv = await this.genericPost(`${MESSAGING}/v1/Tollfree/Verifications`, {
                    TollfreePhoneNumberSid: row.provisionedNumberSid!,
                    UseCaseDescription: `Inspection notifications for ${businessInfo.legalName}`,
                    MessagingServiceSid: row.messagingResourceSid!,
                    NotificationEmail: businessInfo.email ?? '',
                    UseCaseSummary: 'Send inspection reports, scheduling reminders, and repair request updates to clients.',
                    ProductionMessageSample: 'Your inspection report is ready. View it at {{link}}.',
                    OptInType: 'VERBAL',
                });
                row = await store.persist(tenantId, {
                    tfvSid: tfv.sid,
                    tfvStatus: tfv.status,
                    complianceStatus: 'tfv_pending',
                });
            }
        }

        return { complianceStatus: row.complianceStatus, rejectionReason: row.rejectionReason ?? null };
    }

    /**
     * Search + buy a US DID and persist (provisionedNumber, provisionedNumberSid)
     * BEFORE returning — so a crash after the buy resumes by attaching, not re-buying.
     *   - 'local'    → availablePhoneNumbers('US').local.list (10DLC sole-prop)
     *   - 'tollfree' → availablePhoneNumbers('US').tollFree.list
     * buy → incomingPhoneNumbers.create (POST .../IncomingPhoneNumbers.json).
     */
    private async buyNumber(
        tenantId: string,
        kind: 'local' | 'tollfree',
        areaCode: string | undefined,
        store: ComplianceStateStore,
    ) {
        const country = this.client.availablePhoneNumbers('US');
        const search = kind === 'local' ? country.local : country.tollFree;
        const available = await search.list(areaCode ? { areaCode } : {});
        const bought = await this.client.incomingPhoneNumbers.create({ phoneNumber: available[0].phoneNumber });
        return store.persist(tenantId, {
            provisionedNumber: bought.phoneNumber,
            provisionedNumberSid: bought.sid,
        });
    }

    /** Attach a bought number to the messaging service (POST /v1/Services/{sid}/PhoneNumbers). */
    private async attachSender(messagingServiceSid: string, phoneNumberSid: string): Promise<void> {
        const attached = await this.client.messaging.v1.services(messagingServiceSid).phoneNumbers.create({ phoneNumberSid });
        // A 2xx with no sid is not a valid attach result — surface it rather than
        // mark senderAttached on a non-attach.
        if (!attached.sid) throw new Error('Twilio attachSender returned no sid');
    }

    /**
     * Cron-poll fallback: re-read status from Twilio for a non-terminal managed row
     * and advance the normalized enum. READ-ONLY surfaces only:
     *   - TFV path (tollfree): tollfreeVerifications.list (terminal entity).
     *   - Brand path (sp10dlc): brandRegistrations.list (brand approval only advances
     *     to brand_pending — campaign is terminal and has no REST read, so it stays
     *     campaign_pending until the webhook posts it).
     * Mutually exclusive (`else if`) so a just-read TFV verdict can't be clobbered by
     * the brand block. Brand approval must NEVER regress campaign_pending/approved.
     */
    async syncStatus(input: { tenantId: string }, store: ComplianceStateStore): Promise<ComplianceSnapshot> {
        const { tenantId } = input;
        const row = await store.load(tenantId);
        if (!row) return { complianceStatus: 'not_started', rejectionReason: null };

        const updates: Parameters<ComplianceStateStore['persist']>[1] = {};

        if (row.tfvSid || row.tfvStatus) {
            const tfvs = await this.client.messaging.v1.tollfreeVerifications.list().catch(() => []);
            const tfv = row.tfvSid ? tfvs.find((t) => t.sid === row.tfvSid) : tfvs[0];
            if (tfv) {
                updates.tfvStatus = tfv.status;
                if (isApproved(tfv.status)) {
                    updates.complianceStatus = 'approved';
                    updates.rejectionReason = null;
                } else if (isRejected(tfv.status)) {
                    updates.complianceStatus = 'rejected';
                    updates.rejectionReason = tfv.status;
                }
            }
        } else if (row.brandSid || row.brandStatus) {
            const brands = await this.client.messaging.v1.brandRegistrations.list().catch(() => []);
            const brand = row.brandSid ? brands.find((b) => b.sid === row.brandSid) : brands[0];
            if (brand) {
                updates.brandStatus = brand.status;
                if (isApproved(brand.status) && row.complianceStatus !== 'approved' && row.complianceStatus !== 'campaign_pending') {
                    updates.complianceStatus = 'brand_pending';
                } else if (isRejected(brand.status) && row.complianceStatus !== 'rejected') {
                    updates.complianceStatus = 'rejected';
                    updates.rejectionReason = brand.status;
                }
            }
        }

        const newStatus = updates.complianceStatus ?? row.complianceStatus;
        const newRejectionReason = 'rejectionReason' in updates
            ? (updates.rejectionReason ?? null)
            : (row.rejectionReason ?? null);
        if (Object.keys(updates).length > 0) await store.persist(tenantId, updates);
        return { complianceStatus: newStatus, rejectionReason: newRejectionReason };
    }

    /** Twilio HMAC-SHA1 request-signature verification (fail-closed on missing sig). */
    verifyWebhookSignature(ctx: WebhookVerifyCtx): Promise<boolean> {
        return validateTwilioSignature(ctx.secret, ctx.url, ctx.params, ctx.headers['x-twilio-signature'] ?? '');
    }

    /**
     * Parse the Twilio compliance-status form params into a normalized event.
     * Verbatim port of compliance-webhook's parseComplianceEvent (entity detection
     * order: tfv → campaign → brand; first match wins). Unknown payload → null.
     */
    parseCallback(_headers: Record<string, string>, rawBody: string): ComplianceEvent | null {
        const params: Record<string, string> = {};
        for (const [k, v] of new URLSearchParams(rawBody)) params[k] = v;

        const parts: string[] = [];
        if (params.ErrorCode) parts.push(`code=${params.ErrorCode}`);
        if (params.ErrorMessage) parts.push(params.ErrorMessage);
        const rejectionReason = parts.length ? parts.join(': ') : null;

        // TFV branch — Twilio uses VerificationStatus for toll-free callbacks.
        if (params.VerificationStatus || params.TollfreePhoneNumberSid) {
            return {
                entity: 'tfv',
                rawStatus: params.VerificationStatus ?? '',
                rejectionReason,
                entitySid: params.VerificationSid ?? params.TollfreePhoneNumberSid ?? '',
            };
        }
        // Campaign branch — UsAppToPersonUsecase is present in 10DLC campaign callbacks.
        if (params.CampaignSid || params.UsAppToPersonUsecase) {
            return {
                entity: 'campaign',
                rawStatus: params.CampaignStatus ?? '',
                rejectionReason,
                entitySid: params.CampaignSid ?? '',
            };
        }
        // Brand branch — BrandSid or BrandStatus present.
        if (params.BrandSid || params.BrandStatus) {
            return {
                entity: 'brand',
                rawStatus: params.BrandStatus ?? '',
                rejectionReason,
                entitySid: params.BrandSid ?? '',
            };
        }
        return null; // unrecognized payload
    }

    /** Public compliance-status webhook URL for a tenant slug (single source of truth). */
    webhookUrl(baseUrl: string, tenantSlug: string): string {
        return complianceWebhookUrl(baseUrl, 'twilio', tenantSlug);
    }
}

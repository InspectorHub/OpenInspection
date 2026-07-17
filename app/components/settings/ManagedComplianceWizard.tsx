/**
 * ManagedComplianceWizard — onboarding form + status timeline for
 * managed_dedicated SMS provisioning (Task 9).
 *
 * Renders when the tenant is SaaS + smsMode === "managed_dedicated".
 * Business-info form → POST `intent=sms-compliance-provision`.
 * Status timeline built from loader compliance sub-statuses.
 * Fix & Resubmit → POST `intent=sms-compliance-resubmit`.
 *
 * No window.confirm. DS tokens only. No `any`. SaaS-gated by the parent route.
 */
import { useState } from "react";
import { Form } from "react-router";
import { Pill } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ComplianceStatus =
  | "not_started"
  | "profile_pending"
  | "brand_pending"
  | "campaign_pending"
  | "tfv_pending"
  | "approved"
  | "rejected";

type StepState = "done" | "pending" | "idle" | "rejected";

export interface ManagedComplianceData {
  complianceStatus: ComplianceStatus;
  rejectionReason: string | null;
  customerProfileStatus: string | null;
  brandStatus: string | null;
  campaignStatus: string | null;
  tfvStatus: string | null;
  messagingServiceSid: string | null;
  provisionedNumber: string | null;
}

interface Props {
  compliance: ManagedComplianceData;
  /** Which carrier runs managed compliance provisioning (managed_dedicated mode).
   * Separate from smsByoProvider (the BYO send provider in 'own' mode). */
  managedProvider?: "twilio" | "telnyx";
  /** True while the save-managed-provider form is submitting */
  savingManagedProvider?: boolean;
  /** Server action error after a failed provision/resubmit attempt */
  actionError?: string | null;
  /** True while the form is being submitted */
  saving?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveStepState(status: string | null): StepState {
  if (!status) return "idle";
  const s = status.toLowerCase();
  if (s === "approved" || s === "active" || s === "completed") return "done";
  if (s === "rejected" || s === "failed" || s === "twilio-rejected") return "rejected";
  return "pending";
}

function pillToneForStep(s: StepState) {
  if (s === "done") return "sat" as const;
  if (s === "rejected") return "defect" as const;
  if (s === "pending") return "warning" as const;
  return "neutral" as const;
}

function stepLabel(s: StepState): string {
  if (s === "done") return m.settings_smsdelivery_compliance_approved();
  if (s === "rejected") return m.settings_smsdelivery_compliance_rejected();
  if (s === "pending") return m.settings_smsdelivery_compliance_pending();
  return m.settings_smsdelivery_compliance_not_started();
}

// Shared field class (mirrors SmsDeliveryPanel raw inputs).
const inputCls =
  "w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4 focus:border-ih-primary focus:shadow-ih-focus outline-none";

const labelCls = "block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1";

// ---------------------------------------------------------------------------
// Sub-component: Status Timeline
// ---------------------------------------------------------------------------

function StatusTimeline({
  compliance,
  saving,
}: {
  compliance: ManagedComplianceData;
  saving: boolean;
}) {
  const {
    complianceStatus,
    rejectionReason,
    customerProfileStatus,
    brandStatus,
    campaignStatus,
    tfvStatus,
    provisionedNumber,
  } = compliance;

  const profileStep = deriveStepState(customerProfileStatus);
  const brandStep = deriveStepState(brandStatus);
  const campaignStep = deriveStepState(campaignStatus);
  const tfvStep = deriveStepState(tfvStatus);
  const approvedStep: StepState = complianceStatus === "approved" ? "done" : "idle";

  const isRejected = complianceStatus === "rejected";

  function StepDot({ state, num }: { state: StepState; num: number }) {
    const base = "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0";
    const cls =
      state === "done"
        ? `${base} bg-ih-ok text-ih-fg-inverse`
        : state === "rejected"
          ? `${base} bg-ih-bad text-ih-fg-inverse`
          : state === "pending"
            ? `${base} bg-ih-watch text-ih-fg-inverse`
            : `${base} bg-ih-bg-muted text-ih-fg-4 border border-ih-border`;
    return (
      <div className={cls}>
        {state === "done" ? "✓" : state === "rejected" ? "✗" : String(num)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="text-[12px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
        {m.settings_mcw_provisioning_status()}
      </h4>

      <ol className="space-y-2">
        <li className="flex items-center gap-3">
          <StepDot state={profileStep} num={1} />
          <span className="flex-1 text-[13px] text-ih-fg-2">{m.settings_mcw_step_business_profile()}</span>
          <Pill tone={pillToneForStep(profileStep)} dot>{stepLabel(profileStep)}</Pill>
        </li>

        <li className="flex items-center gap-3">
          <StepDot state={brandStep} num={2} />
          <span className="flex-1 text-[13px] text-ih-fg-2">{m.settings_mcw_step_brand()}</span>
          <Pill tone={pillToneForStep(brandStep)} dot>{stepLabel(brandStep)}</Pill>
        </li>

        {campaignStatus !== null ? (
          <li className="flex items-center gap-3">
            <StepDot state={campaignStep} num={3} />
            <span className="flex-1 text-[13px] text-ih-fg-2">{m.settings_mcw_step_campaign()}</span>
            <Pill tone={pillToneForStep(campaignStep)} dot>{stepLabel(campaignStep)}</Pill>
          </li>
        ) : tfvStatus !== null ? (
          <li className="flex items-center gap-3">
            <StepDot state={tfvStep} num={3} />
            <span className="flex-1 text-[13px] text-ih-fg-2">{m.settings_mcw_step_tfv()}</span>
            <Pill tone={pillToneForStep(tfvStep)} dot>{stepLabel(tfvStep)}</Pill>
          </li>
        ) : null}

        <li className="flex items-center gap-3">
          <StepDot state={approvedStep} num={4} />
          <span className="flex-1 text-[13px] text-ih-fg-2">{m.settings_mcw_step_number_active()}</span>
          <Pill tone={approvedStep === "done" ? "sat" : "neutral"} dot>
            {approvedStep === "done" ? m.settings_discount_active() : m.settings_mcw_waiting()}
          </Pill>
        </li>
      </ol>

      {/* Provisioned number */}
      {provisionedNumber && (
        <p className="text-[12px] text-ih-ok-fg font-medium">
          {m.settings_mcw_provisioned_number()} <span className="font-bold">{provisionedNumber}</span>
        </p>
      )}

      {/* Rejection notice */}
      {isRejected && (
        <div className="rounded-md bg-ih-bad-bg border border-ih-bad/30 p-3 space-y-2">
          <p className="text-[13px] font-bold text-ih-bad-fg">{m.settings_mcw_registration_rejected()}</p>
          {rejectionReason && (
            <p className="text-[12px] text-ih-bad-fg">{rejectionReason}</p>
          )}
          <p className="text-[11px] text-ih-fg-3">
            {m.settings_mcw_rejection_note()}
          </p>
        </div>
      )}

      {/* Approved banner */}
      {complianceStatus === "approved" && (
        <div className="rounded-md bg-ih-ok-bg border border-ih-ok/30 p-3">
          <p className="text-[13px] font-bold text-ih-ok-fg">
            {m.settings_mcw_active_banner()}
          </p>
        </div>
      )}

      {/* In-progress notice */}
      {(complianceStatus === "profile_pending" ||
        complianceStatus === "brand_pending" ||
        complianceStatus === "campaign_pending" ||
        complianceStatus === "tfv_pending") && (
        <p className="text-[12px] text-ih-watch-fg">
          {m.settings_mcw_in_progress()}
        </p>
      )}

      {/* Resubmit button (only when rejected) */}
      {isRejected && (
        <div className="pt-2">
          <button
            form="managed-compliance-form"
            name="intent"
            value="sms-compliance-resubmit"
            type="submit"
            disabled={saving}
            className="h-8 px-4 rounded-md bg-ih-bad text-ih-fg-inverse font-bold text-[13px] hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {saving ? m.settings_mcw_resubmitting() : m.settings_mcw_fix_resubmit()}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

/**
 * Business-info form + status timeline for managed_dedicated tenants.
 *
 * The form id "managed-compliance-form" is referenced by the "Fix & resubmit"
 * button rendered inside StatusTimeline so it can submit the same form.
 */
export function ManagedComplianceWizard({ compliance, managedProvider, savingManagedProvider = false, actionError, saving = false }: Props) {
  const isNotStarted = compliance.complianceStatus === "not_started";
  const isRejected = compliance.complianceStatus === "rejected";
  const showForm = isNotStarted || isRejected;

  // Carrier selector state — initialized from the loader-supplied stored value.
  const [carrier, setCarrier] = useState<"twilio" | "telnyx">(managedProvider ?? "twilio");

  // Track whether the user has attempted submission (enables eager validation).
  const [attempted, setAttempted] = useState(false);
  const [fields, setFields] = useState({
    legalName: "",
    address: "",
    areaCode: "",
    repName: "",
    email: "",
    channel: "sp10dlc" as "sp10dlc" | "tollfree",
  });

  function fieldError(name: keyof typeof fields): string | undefined {
    if (!attempted) return undefined;
    if (name === "legalName" && !fields.legalName.trim()) return "Required.";
    if (name === "address" && !fields.address.trim()) return "Required.";
    if (name === "repName" && !fields.repName.trim()) return "Required.";
    if (name === "email" && fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) {
      return "Enter a valid email address.";
    }
    return undefined;
  }

  function onChange(name: keyof typeof fields) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setFields((prev) => ({ ...prev, [name]: e.target.value }));
  }

  return (
    <div className="space-y-5">
      {/* Managed carrier selector — Twilio or Telnyx for this tenant's dedicated number.
          Separate from the BYO provider shown in 'own' mode (smsByoProvider). */}
      <Form method="post" className="space-y-3 pb-4 border-b border-ih-border">
        <input type="hidden" name="intent" value="save-managed-provider" />
        <input type="hidden" name="managedProvider" value={carrier} />
        <div className="space-y-1.5">
          <p className={labelCls} id="managed-carrier-label">{m.settings_mcw_managed_carrier()}</p>
          <div className="flex gap-2" role="group" aria-labelledby="managed-carrier-label">
            <button
              type="button"
              aria-pressed={carrier === "twilio"}
              onClick={() => setCarrier("twilio")}
              className={`flex-1 h-9 rounded-md border text-[13px] font-bold transition-colors ${
                carrier === "twilio"
                  ? "border-ih-primary bg-ih-primary/5 text-ih-primary"
                  : "border-ih-border bg-ih-bg-card text-ih-fg-2 hover:border-ih-primary/40"
              }`}
            >
              {m.settings_sms_provider_twilio()}
            </button>
            <button
              type="button"
              aria-pressed={carrier === "telnyx"}
              onClick={() => setCarrier("telnyx")}
              className={`flex-1 h-9 rounded-md border text-[13px] font-bold transition-colors ${
                carrier === "telnyx"
                  ? "border-ih-primary bg-ih-primary/5 text-ih-primary"
                  : "border-ih-border bg-ih-bg-card text-ih-fg-2 hover:border-ih-primary/40"
              }`}
            >
              {m.settings_sms_provider_telnyx()}
            </button>
          </div>
          <p className="text-[11px] text-ih-fg-4">
            {m.settings_mcw_carrier_note()}
          </p>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingManagedProvider}
            className="h-8 px-4 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-60"
          >
            {savingManagedProvider ? m.common_saving() : m.settings_mcw_save_carrier()}
          </button>
        </div>
      </Form>

      {/* Status timeline — shown once provisioning has started */}
      {compliance.complianceStatus !== "not_started" && (
        <StatusTimeline compliance={compliance} saving={saving} />
      )}

      {/* Business-info form — shown when not started or rejected */}
      {showForm && (
        <Form
          id="managed-compliance-form"
          method="post"
          className="space-y-4"
          onSubmit={() => setAttempted(true)}
        >
          <input type="hidden" name="intent" value="sms-compliance-provision" />

          <h4 className="text-[12px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
            {isRejected ? m.settings_mcw_update_business_info() : m.settings_mcw_business_info()}
          </h4>
          <p className="text-[12px] text-ih-fg-3">
            {m.settings_mcw_business_info_desc()}
          </p>

          {/* Channel selector */}
          <div className="space-y-2">
            <p className={labelCls}>{m.settings_mcw_registration_channel()}</p>
            <div className="flex flex-col gap-2">
              <label
                className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                  fields.channel === "sp10dlc"
                    ? "border-ih-primary bg-ih-primary/5"
                    : "border-ih-border bg-ih-bg-card hover:border-ih-primary/40"
                }`}
              >
                <input
                  type="radio"
                  name="channel"
                  value="sp10dlc"
                  checked={fields.channel === "sp10dlc"}
                  onChange={() => setFields((prev) => ({ ...prev, channel: "sp10dlc" }))}
                  className="mt-0.5 accent-ih-primary"
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-bold text-ih-fg-1">{m.settings_mcw_channel_10dlc_label()}</span>
                  <span className="block text-[11px] text-ih-fg-3 mt-0.5">
                    {m.settings_mcw_channel_10dlc_desc()}
                  </span>
                </span>
              </label>
              <label
                className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                  fields.channel === "tollfree"
                    ? "border-ih-primary bg-ih-primary/5"
                    : "border-ih-border bg-ih-bg-card hover:border-ih-primary/40"
                }`}
              >
                <input
                  type="radio"
                  name="channel"
                  value="tollfree"
                  checked={fields.channel === "tollfree"}
                  onChange={() => setFields((prev) => ({ ...prev, channel: "tollfree" }))}
                  className="mt-0.5 accent-ih-primary"
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-bold text-ih-fg-1">{m.settings_mcw_channel_tollfree_label()}</span>
                  <span className="block text-[11px] text-ih-fg-3 mt-0.5">
                    {m.settings_mcw_channel_tollfree_desc()}
                  </span>
                </span>
              </label>
            </div>
          </div>

          {/* Fields: legal name + rep */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="mcw-legalName" className={labelCls}>{m.settings_mcw_legal_name_label()}</label>
              <input
                id="mcw-legalName"
                name="legalName"
                type="text"
                value={fields.legalName}
                onChange={onChange("legalName")}
                placeholder={m.settings_mcw_legal_name_placeholder()}
                autoComplete="organization"
                className={`${inputCls}${fieldError("legalName") ? " border-ih-bad" : ""}`}
              />
              {fieldError("legalName") && (
                <p className="text-[11px] text-ih-bad-fg mt-1">{fieldError("legalName")}</p>
              )}
            </div>
            <div>
              <label htmlFor="mcw-repName" className={labelCls}>{m.settings_mcw_rep_name_label()}</label>
              <input
                id="mcw-repName"
                name="repName"
                type="text"
                value={fields.repName}
                onChange={onChange("repName")}
                placeholder={m.settings_mcw_rep_name_placeholder()}
                autoComplete="name"
                className={`${inputCls}${fieldError("repName") ? " border-ih-bad" : ""}`}
              />
              {fieldError("repName") && (
                <p className="text-[11px] text-ih-bad-fg mt-1">{fieldError("repName")}</p>
              )}
            </div>
          </div>

          {/* Address */}
          <div>
            <label htmlFor="mcw-address" className={labelCls}>
              {m.settings_mcw_address_label()}
            </label>
            <input
              id="mcw-address"
              name="address"
              type="text"
              value={fields.address}
              onChange={onChange("address")}
              placeholder={m.settings_mcw_address_placeholder()}
              autoComplete="street-address"
              className={`${inputCls}${fieldError("address") ? " border-ih-bad" : ""}`}
            />
            {fieldError("address") && (
              <p className="text-[11px] text-ih-bad-fg mt-1">{fieldError("address")}</p>
            )}
          </div>

          {/* Email + area code */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="mcw-email" className={labelCls}>{m.settings_mcw_email_label()}</label>
              <input
                id="mcw-email"
                name="email"
                type="email"
                value={fields.email}
                onChange={onChange("email")}
                placeholder={m.settings_mcw_email_placeholder()}
                autoComplete="email"
                className={`${inputCls}${fieldError("email") ? " border-ih-bad" : ""}`}
              />
              {fieldError("email") && (
                <p className="text-[11px] text-ih-bad-fg mt-1">{fieldError("email")}</p>
              )}
            </div>
            <div>
              <label htmlFor="mcw-areaCode" className={labelCls}>{m.settings_mcw_areacode_label()}</label>
              <input
                id="mcw-areaCode"
                name="areaCode"
                type="text"
                value={fields.areaCode}
                onChange={onChange("areaCode")}
                placeholder="415"
                className={inputCls}
              />
              <p className="text-[11px] text-ih-fg-4 mt-1">
                {m.settings_mcw_areacode_hint()}
              </p>
            </div>
          </div>

          {/* Server-side action error */}
          {actionError && (
            <p className="text-[12px] text-ih-bad-fg bg-ih-bad-bg border border-ih-bad/20 rounded-md px-3 py-2">
              {actionError}
            </p>
          )}

          <div className="flex justify-end pt-2 border-t border-ih-border">
            <button
              type="submit"
              disabled={saving}
              className="h-8 px-4 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-60"
            >
              {saving ? m.settings_mcw_submitting() : m.settings_mcw_start_provisioning()}
            </button>
          </div>
        </Form>
      )}
    </div>
  );
}

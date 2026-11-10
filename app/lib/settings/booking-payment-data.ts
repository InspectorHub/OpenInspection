import { parseDepositPolicy } from "~/lib/deposit-policy-form";
import type { DepositPolicy } from "../../../server/lib/billing/deposit-policy";

/**
 * What the "Collect payment when clients book" section reads from the branding
 * payload.
 *
 * `depositPolicy` has THREE states, and the third is the reason this is not
 * inlined in the loader:
 *   - a policy      the company default is set
 *   - `null`        the caller may see it and it is unset (every company starts here)
 *   - `undefined`   the caller may NOT see it: the branding endpoint omits the
 *                   key for anyone without `companyFinance`, and a branding
 *                   payload that never arrived tells us nothing either
 * Collapsing `undefined` into `null` made a manager see "Off" and a button that
 * the server then refused. Absent stays absent all the way to the component.
 */
export interface PaymentSettings {
  depositPolicy: DepositPolicy | null | undefined;
  currency: string;
}

export function readPaymentSettings(branding: Record<string, unknown> | undefined): PaymentSettings {
  const currency = typeof branding?.currency === "string" && branding.currency !== "" ? branding.currency : "USD";
  if (!branding || !("depositPolicy" in branding) || branding.depositPolicy === undefined) {
    return { depositPolicy: undefined, currency };
  }
  return { depositPolicy: parseDepositPolicy(branding.depositPolicy), currency };
}

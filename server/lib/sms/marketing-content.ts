/**
 * Marketing content on the SMS channel.
 *
 * The consent a recipient gave describes appointment and report updates. A
 * review request is promotional, and promotional content changes which consent
 * the message needs — so it is refused at the send gate rather than trusted to
 * the person writing the template. That is the reason this is not
 * a template-editor warning: the compliance decision must not be left to the
 * content author. A tenant may write any body they like; the gate is the only
 * place that can hold.
 *
 * WHY A CONTENT CHECK AT ALL, given the gate also checks the class category.
 * Tenant-authored bodies carry no seeded class — `automationClassId()` returns
 * undefined for them by construction — so a category check cannot see them.
 * This is the half that can. Neither check subsumes the other, which is the
 * whole reason both exist.
 *
 * THE CHECK IS ON THE VARIABLE, NOT ON PROSE. "Please review the report before
 * Friday" is an ordinary sentence and must keep sending. `{{review_url}}`
 * resolves to the company's Google or Yelp page, and that resolution is the
 * thing that makes the message promotional — so the token is what is refused.
 *
 * ADDING AN ENTRY. A new marketing variable belongs in `MARKETING_VARS` and
 * nowhere else. The spelling has to match the interpolation dialect exactly:
 * a misspelled entry never matches any token and silently blocks nothing, so
 * `tests/unit/sms/marketing-block.spec.ts` asserts the set is non-empty and
 * names `review_url` rather than only asserting that innocent bodies pass.
 */
import { referencedVars } from '../automation-core/interpolate';

/**
 * Template variables whose presence makes a message promotional.
 *
 * `review_url` is the whole set today: it is the only variable the send path
 * resolves to a third-party review destination (`sendOneSms` fails closed when
 * a body references it and the tenant has configured none).
 */
export const MARKETING_VARS: ReadonlySet<string> = new Set(['review_url']);

/** The marketing variables a body template references, in the order they appear. */
export function marketingVarsIn(template: string): string[] {
    return referencedVars(template).filter((v) => MARKETING_VARS.has(v));
}

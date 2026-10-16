import { Form } from "react-router";
import { Banner, Button, RadioCardGroup } from "@core/shared-ui";
import { useSubmitLatch } from "~/hooks/useSubmitLatch";
import { m } from "~/paraglide/messages";

export type SourceValue = "provided" | "own";

/**
 * Whose account email runs on, for a deployment that has a built-in one.
 * Only drawn where Built-in exists; a self-hosted deployment is never asked.
 * SMS has no such choice: it always goes out on the company's own account.
 *
 * Built-in that cannot be chosen right now stays on the screen, disabled, with
 * the reason beside it, rather than vanishing: a person looking for it should
 * learn it is not available yet, not wonder where it went.
 *
 * Saving writes the choice and nothing else. The company's own account details
 * are not touched, so switching to Built-in and back loses nothing.
 */
export function SourceChoice({
  available,
  selected,
  onSelect,
  saving,
  error,
  saved,
}: {
  /** The sources that can be picked right now. */
  available: SourceValue[];
  selected: SourceValue;
  onSelect: (value: SourceValue) => void;
  saving: boolean;
  error: string | null;
  saved: boolean;
}) {
  const latch = useSubmitLatch();
  const builtInOpen = available.includes("provided");
  const service = m.integrations_delivery_service_email();
  const builtInDescription = builtInOpen
    ? m.integrations_delivery_built_in_email_desc()
    : m.integrations_source_reason_provided_not_configured({ service });
  return (
    <section aria-labelledby={`email-source-heading`} className="space-y-3">
      <div>
        <h2 id={`email-source-heading`} className="text-sm font-bold text-ih-fg-1">{m.integrations_delivery_source_heading()}</h2>
        <p className="text-xs text-ih-fg-3 mt-0.5">{m.integrations_delivery_source_help({ service })}</p>
      </div>
      {error && <Banner tone="danger">{error}</Banner>}
      {saved && !error && <Banner tone="success">{m.integrations_delivery_choice_saved()}</Banner>}
      <Form method="post" onSubmit={latch()} className="space-y-3">
        <input type="hidden" name="intent" value="save-source" />
        <input type="hidden" name="source" value={selected} />
        <RadioCardGroup
          name="_sourceRadio"
          value={selected}
          onChange={(v) => onSelect(v as SourceValue)}
          options={[
            {
              value: "provided",
              title: m.integrations_hub_source_provided(),
              description: builtInDescription,
              badge: builtInOpen ? undefined : m.integrations_delivery_badge_unavailable(),
              disabled: !builtInOpen,
            },
            {
              value: "own",
              title: m.integrations_hub_source_own(),
              description: m.integrations_delivery_own_email_desc(),
            },
          ]}
        />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" pending={saving}>{m.integrations_delivery_save_choice()}</Button>
        </div>
      </Form>
    </section>
  );
}

import { Link, type useFetcher } from "react-router";
import { useHumanGatedSubmit } from "~/components/OutboundVerification";
import { Modal, Button, Checkbox, Textarea } from "@core/shared-ui";
import type { action } from "~/routes/inspector-portal";
import { m } from "~/paraglide/messages";

/* ------------------------------------------------------------------ */
/*  Publish-report modal                                              */
/* ------------------------------------------------------------------ */

const FORM_ID = "ih-publish-report-form";

export function PublishReportModal({
  open,
  agreementRequired,
  paymentRequired,
  isAmendment,
  noticeChoice = false,
  courtesyTranslationEnabled,
  courtesyTranslationLocale,
  clientPrefersTranslation,
  blockingCount,
  fetcher,
  submitting,
  error,
  onClose,
  onPublishSubmit,
}: {
  open: boolean;
  agreementRequired: boolean;
  paymentRequired: boolean;
  /** IA-40 — this publish creates versionNumber > 1; ask what changed. */
  isAmendment: boolean;
  /**
   * #484 — whether the server will honour the notice choice for this publish:
   * the report was reopened with "Edit and republish" (in progress, published
   * once). Separate from `isAmendment`, which only decides whether the dialog
   * asks what changed: a republish after a retract has earlier versions but is
   * a fresh delivery the automation rules decide, so it offers no choice. Same
   * name and meaning as the editor's PublishModal prop.
   */
  noticeChoice?: boolean;
  /**
   * #23 — whether this workspace may PRODUCE a courtesy translation.
   *
   * The opt-in renders only when it may. Offering a control that the server
   * would refuse is the "a page must never offer an action the API refuses"
   * rule, and here the refusal costs a publish's worth of confusion.
   */
  courtesyTranslationEnabled: boolean;
  /** The locale a translation would be produced in, e.g. `es-419`. */
  courtesyTranslationLocale: string;
  /**
   * True when the client's own preferred language is the one a translation
   * would be produced in.
   *
   * A NUDGE and nothing more. It never pre-ticks the box: producing a
   * translation spends money, and a default that spends it is a decision the
   * product made on somebody's behalf.
   */
  clientPrefersTranslation: boolean;
  /**
   * How many items the report-status gate still counts as unresolved.
   *
   * SHOWN, NEVER ENFORCED. The hub card beside the Publish button already
   * counted these, but the modal that performs the publish said nothing about
   * them — so the last screen before an outward-facing act was the one screen
   * with the least information, while publishing from the editor showed a list.
   *
   * It does not disable the submit. A completeness check is a reminder, not a
   * precondition: an inspector may have good reason to publish with an item
   * left open, so the count informs and the decision stays theirs.
   *
   * A count and not a list because the list lives one step earlier: the
   * Publish button runs the readiness endpoint on demand and shows the
   * editor's PublishGateModal with the defects before this modal ever opens.
   */
  blockingCount: number;
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  submitting: boolean;
  error: string | undefined;
  onClose: () => void;
  /**
   * Item 3 — what this submit is, reported while the form still knows. The
   * banner cannot recover it after the publish: the loader revalidates and
   * the report is no longer "editing again", so `noticeChoice` is false by
   * the time the confirmation renders. The human gate re-fires the submit
   * via requestSubmit, so this runs twice with the same values; the second
   * run is the real one.
   */
  onPublishSubmit?: (choice: { offered: boolean; notified: boolean }) => void;
}) {
  const gatedSubmit = useHumanGatedSubmit();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={m.hub_publish_title()}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {m.common_cancel()}
          </Button>
          <Button variant="primary" size="sm" type="submit" form={FORM_ID} pending={submitting}>
            {submitting ? m.hub_publish_pending() : m.hub_publish_submit()}
          </Button>
        </>
      }
    >
      <fetcher.Form
        id={FORM_ID}
        method="post"
        className="space-y-3"
        onSubmit={(e) => {
          onPublishSubmit?.({
            offered: noticeChoice,
            notified: new FormData(e.currentTarget).get("notifyClient") === "on",
          });
          // `gatedSubmit` returns a promise (the human gate is async); the
          // form's own submit already happened — nothing awaits it here.
          void gatedSubmit(e);
        }}
      >
        <input type="hidden" name="intent" value="publish" />
        {blockingCount > 0 && (
          <p className="rounded-md border border-ih-watch bg-ih-watch-bg px-3 py-2 text-[12px] text-ih-watch-fg">
            {m.hub_publish_unresolved({ count: blockingCount })}
          </p>
        )}
        {/* No theme picker — rides the editor's effective default (server
            'modern'); the action sends theme:"modern" explicitly. */}

        {/* F79 — this STATES who will be told, where two switches used to ask.
            `notifyClient` / `notifyAgent` were posted, accepted, and read by
            nothing: delivery is the workspace's `report.published` automation
            rules' decision, and the publish audit row recorded the flag as given,
            so a publish ticked "notify nobody" was written down as one that
            notified nobody while every rule fired anyway.
            Dropping the switches silently would leave the question they asked
            unanswered, so the answer — and the address that decides it — is said
            plainly instead. Sentence, not a disabled control: there is nothing
            here to operate.
            #484 — one choice is back, for revisions only: the server now
            honours `notifyClient` on an amendment (it decides whether the
            `report.amended` rules fire at all), so a revision offers the same
            unchecked-by-default box the editor's PublishModal does. A first
            publish, and a republish after a retract, keep the sentence above:
            the rules decide, and there is no box to tick. */}
        {noticeChoice ? (
          <>
            <p className="rounded-md border border-ih-border bg-ih-bg-muted px-3 py-2 text-[12px] text-ih-fg-2">
              {m.report_publish_body_delivery_amendment()}
            </p>
            <Checkbox
              name="notifyClient"
              label={m.editor_publish_notify_client()}
              defaultChecked={false}
            />
          </>
        ) : (
          <p
            data-testid="publish-notify-automation"
            className="rounded-md border border-ih-border bg-ih-bg-muted px-3 py-2 text-[12px] text-ih-fg-2"
          >
            {m.hub_publish_notify_automation()}{" "}
            <Link to="/settings/automations" className="font-bold text-ih-primary hover:underline">
              {m.hub_publish_notify_automation_link()}
            </Link>
          </p>
        )}

        <Checkbox
          name="requireSignature"
          label={m.hub_publish_require_signature()}
          defaultChecked={agreementRequired}
        />
        <Checkbox
          name="requirePayment"
          label={m.hub_publish_require_payment()}
          defaultChecked={paymentRequired}
        />

        {/* #23 — the per-publish opt-in. DEFAULT OFF, and it is a checkbox
            rather than a default because producing a translation spends money
            and the decision stays with whoever incurs it. The value posted is
            the LOCALE, so the server is told what was asked for rather than
            having to guess from a boolean. */}
        {courtesyTranslationEnabled && (
          <div>
            <Checkbox
              name="translateTo"
              value={courtesyTranslationLocale}
              label={m.courtesy_translation_publish_optin()}
              defaultChecked={false}
            />
            {/* The nudge. A fact about the recipient, stated once, next to the
                control it is relevant to — never a pre-ticked box. */}
            {clientPrefersTranslation && (
              <p className="text-[12px] text-ih-fg-3 mt-1 ml-6" data-testid="courtesy-translation-nudge">
                {m.courtesy_translation_publish_nudge()}
              </p>
            )}
          </div>
        )}

        {isAmendment && (
          <Textarea
            label={m.inspections_hub_publish_summary_label()}
            name="summary"
            rows={3}
            maxLength={500}
            placeholder={m.inspections_hub_publish_summary_ph()}
          />
        )}

        {error && <p className="text-[12px] font-medium text-ih-bad-fg">{error}</p>}
      </fetcher.Form>
    </Modal>
  );
}

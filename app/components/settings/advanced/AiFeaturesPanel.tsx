import { Form, type useFetcher } from "react-router";
import { Checkbox } from "@core/shared-ui";
import { SecretField } from "~/components/SecretField";
import { TestConnectionButton } from "~/components/settings/TestConnectionButton";
import { ConnectionTestStatus, type ConnectionTestResult } from "~/components/settings/ConnectionTestStatus";
import type { action } from "~/routes/settings-advanced";
import { m } from "~/paraglide/messages";

interface AiFeaturesPanelProps {
  geminiConfigured: boolean;
  value: string;
  fieldError: (name: string) => string | undefined;
  saving: boolean;
  geminiTestFetcher: ReturnType<typeof useFetcher<typeof action>>;
  /** Persisted "Test connection" history (shared loader list, filtered to gemini). */
  testResults?: ConnectionTestResult[];
}

export function AiFeaturesPanel({ geminiConfigured, value, fieldError, saving, geminiTestFetcher, testResults = [] }: AiFeaturesPanelProps) {
  const geminiTest = geminiTestFetcher.data;

  return (
    <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_ai_heading()}</h3>
        <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
 geminiConfigured
 ? "bg-ih-ok-bg text-ih-ok-fg"
 : "bg-ih-bg-muted text-ih-fg-3"
 }`}>
          {geminiConfigured ? m.settings_ai_configured() : m.settings_ai_not_configured()}
        </span>
      </div>
      <p className="text-[13px] text-ih-fg-3">
        {m.settings_ai_desc()}{" "}
        <a href="https://aistudio.google.com" target="_blank" rel="noopener noreferrer"
          className="text-ih-primary hover:underline">
          aistudio.google.com
        </a>.
      </p>
      <Form method="post" className="space-y-3 max-w-xl">
        <input type="hidden" name="intent" value="save-ai" />
        {/* Lets the action accept a confirmation for a key that is already
            stored, without the workspace re-entering the credential. */}
        <input type="hidden" name="keyConfigured" value={geminiConfigured ? "1" : ""} />
        <SecretField
          name="GEMINI_API_KEY"
          label={m.settings_ai_key_label()}
          value={value}
          error={fieldError("GEMINI_API_KEY")}
          hint={m.settings_ai_key_hint()}
        />

        {/*
          Disclosure, then attestation — two different things on purpose. The
          paragraph states a fact about how provider terms work; it gives no
          advice and disclaims nothing. The checkboxes below are the workspace
          asserting what only it can know: the service tier lives in the billing
          project behind the key, where this application cannot look. All three
          are `required`, so the browser blocks the submit and the server refuses
          the save (422) — the key is not stored either way.
        */}
        <p className="text-[12px] text-ih-fg-3 leading-relaxed">
          {m.settings_ai_terms_disclosure()}
        </p>
        <fieldset className="space-y-2">
          <legend className="text-[11px] font-semibold text-ih-fg-2 mb-1">
            {m.settings_ai_attest_heading()}
          </legend>
          <Checkbox name="attestReviewedProviderTerms" value="on" required
            label={m.settings_ai_attest_reviewed()} />
          <Checkbox name="attestTierPermitsIntendedUse" value="on" required
            label={m.settings_ai_attest_tier()} />
          <Checkbox name="attestUnderstandsProviderProcessing" value="on" required
            label={m.settings_ai_attest_processing()} />
        </fieldset>

        <div className="flex justify-end pt-2 border-t border-ih-border">
          <button type="submit" disabled={saving}
            className="h-9 px-4 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed">
            {saving ? m.common_saving() : m.common_save()}
          </button>
        </div>
      </Form>

      {/* Test connection — probes the STORED Gemini key, no re-entry needed */}
      <TestConnectionButton fetcher={geminiTestFetcher} intent="test-gemini">
        {geminiTest && "intent" in geminiTest && geminiTest.intent === "test-gemini" && geminiTest.test && (
          <span className="text-[12px] text-ih-fg-2">{m.settings_ai_key_valid()}</span>
        )}
        {geminiTest && "intent" in geminiTest && geminiTest.intent === "test-gemini" && "success" in geminiTest && !geminiTest.success && (
          <span className="text-[12px] text-ih-bad-fg">{geminiTest.error}</span>
        )}
      </TestConnectionButton>

      {/* Persisted last-tested status + recent history (survives reloads). */}
      <ConnectionTestStatus results={testResults} target="gemini" />
    </section>
  );
}

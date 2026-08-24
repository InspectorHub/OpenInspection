import { useState } from "react";
import { Form, type useFetcher } from "react-router";
import { Checkbox, Input } from "@core/shared-ui";
import { SecretField } from "~/components/SecretField";
import { TestConnectionButton } from "~/components/settings/TestConnectionButton";
import { ConnectionTestStatus, type ConnectionTestResult } from "~/components/settings/ConnectionTestStatus";
import type { action } from "~/routes/settings-advanced";
import { m } from "~/paraglide/messages";

interface AiFeaturesPanelProps {
  geminiConfigured: boolean;
  /** Whether this workspace may be offered AI at all — a provisioning answer,
   *  not a permission. Whether a given call runs is decided server-side. */
  aiEnabled: boolean;
  /** #23 — whether this workspace may PRODUCE a courtesy translation of a
   *  report. Gates production only; it never removes one already delivered. */
  courtesyTranslationEnabled: boolean;
  aiBaseUrl: string;
  aiModel: string;
  value: string;
  fieldError: (name: string) => string | undefined;
  saving: boolean;
  geminiTestFetcher: ReturnType<typeof useFetcher<typeof action>>;
  /** Persisted "Test connection" history (shared loader list, filtered to gemini). */
  testResults?: ConnectionTestResult[];
}

export function AiFeaturesPanel({ geminiConfigured, aiEnabled, courtesyTranslationEnabled, aiBaseUrl, aiModel, value, fieldError, saving, geminiTestFetcher, testResults = [] }: AiFeaturesPanelProps) {
  const aiTest = geminiTestFetcher.data;
  // Held in state so the Test button can probe what is ON SCREEN rather than
  // what was last saved — testing the saved value would answer a question
  // nobody asked, which is the defect the old Gemini probe had.
  const [baseUrl, setBaseUrl] = useState(aiBaseUrl);
  const [model, setModel] = useState(aiModel);
  const [apiKey, setApiKey] = useState("");
  const testField = aiTest && "intent" in aiTest && aiTest.intent === "test-ai" ? aiTest.field : null;

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
      {/* No vendor link. The destination is whatever endpoint this workspace
          configures, so naming one provider here would be the same defect the
          old Test button had: describing a fixed vendor the engine no longer has. */}
      <p className="text-[13px] text-ih-fg-3">{m.settings_ai_desc()}</p>
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
          onChange={setApiKey}
        />
        <Input
          id="aiBaseUrl"
          name="aiBaseUrl"
          label={m.settings_ai_base_url_label()}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.currentTarget.value)}
          placeholder="https://api.example.com/v1"
          error={testField === "baseUrl" ? typeof aiTest?.error === "string" ? aiTest.error : undefined : fieldError("aiBaseUrl")}
          hint={m.settings_ai_base_url_hint()}
        />
        <Input
          id="aiModel"
          name="aiModel"
          label={m.settings_ai_model_label()}
          value={model}
          onChange={(e) => setModel(e.currentTarget.value)}
          error={testField === "model" ? typeof aiTest?.error === "string" ? aiTest.error : undefined : fieldError("aiModel")}
          hint={m.settings_ai_model_hint()}
        />
        <div>
          <Checkbox
            name="aiEnabled"
            value="on"
            defaultChecked={aiEnabled}
            label={m.settings_ai_enabled_label()}
          />
          {/* The one line of helper text this panel gets. It is here because it
              states a promise the save path has to keep, not because a checkbox
              needs explaining. */}
          <p className="text-[12px] text-ih-fg-3 mt-1 ml-6">{m.settings_ai_enabled_hint()}</p>
        </div>

        {/* #23 — courtesy translations. Its own control rather than a mode of
            the switch above: this one commits to spending on every publish, so
            "AI is available" and "produce a second copy of every report" are
            two decisions and are made separately. */}
        <div>
          <Checkbox
            name="courtesyTranslationEnabled"
            value="on"
            defaultChecked={courtesyTranslationEnabled}
            label={m.courtesy_translation_setting_label()}
          />
          <p className="text-[12px] text-ih-fg-3 mt-1 ml-6">{m.courtesy_translation_setting_help()}</p>
          {/* Says what OFF does, because the honest answer is surprising: it
              stops new translations and leaves delivered ones alone. */}
          <p className="text-[12px] text-ih-fg-3 mt-1 ml-6">{m.courtesy_translation_setting_off_note()}</p>
        </div>

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

      {/* Probes what is ON SCREEN. A blank key falls back to the one this
          workspace already stored — never to a deployment default, which is
          how the endpoint this replaced could go green on a configuration no
          tenant call ever used. */}
      <TestConnectionButton fetcher={geminiTestFetcher} intent="test-ai">
        <input type="hidden" name="aiBaseUrl" value={baseUrl} />
        <input type="hidden" name="aiModel" value={model} />
        <input type="hidden" name="aiApiKey" value={apiKey} />
        {aiTest && "intent" in aiTest && aiTest.intent === "test-ai" && aiTest.test && (
          <span className="text-[12px] text-ih-fg-2">{m.settings_ai_test_ok()}</span>
        )}
        {aiTest && "intent" in aiTest && aiTest.intent === "test-ai" && "success" in aiTest && !aiTest.success && !aiTest.field && (
          <span className="text-[12px] text-ih-bad-fg">{aiTest.error}</span>
        )}
      </TestConnectionButton>

      {/* Persisted last-tested status + recent history (survives reloads). */}
      <ConnectionTestStatus results={testResults} target="gemini" />
    </section>
  );
}

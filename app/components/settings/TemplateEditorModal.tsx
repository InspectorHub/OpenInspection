import { useState, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { Button, Pill, Modal } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import { SUPPORTED_CONTACT_LOCALES } from "../../../server/lib/i18n/contact-locale";
import { localeLabel } from "~/lib/locales";

// ─── Exported pure helper ────────────────────────────────────────────────────

/** GSM-ish client segment estimate — mirrors server smsSegmentInfo thresholds. */
export function smsSegmentsClient(body: string): number {
  const len = [...body].length;
  if (len === 0) return 0;
  // Client keeps the GSM happy-path estimate (server is authoritative on send).
  return len <= 160 ? 1 : Math.ceil(len / 153);
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MessageTemplate {
  id: string;
  tenantId: string;
  name: string;
  channel: "email" | "sms";
  subject: string | null;
  body: string;
  variables: string[];
  /** Which language version this row IS. */
  locale: string;
  isSeeded: boolean;
  createdAt: number;
  updatedAt: number;
}

export /** What the editor modal is currently doing. */
type EditorTarget =
  | { kind: "edit"; template: MessageTemplate }
  | { kind: "new"; channel: "email" | "sms"; locale: string; prefill: MessageTemplate | null };


// ─── Template editor modal ────────────────────────────────────────────────────

export function TemplateEditorModal({
  target,
  onClose,
}: {
  target: EditorTarget;
  onClose: () => void;
}) {
  const template = target.kind === "edit" ? target.template : null;
  const prefill = target.kind === "new" ? target.prefill : null;
  const channel = target.kind === "edit" ? target.template.channel : target.channel;
  const isEmail = channel === "email";
  // The language of the row being written. Fixed for an edit (a version's
  // language is what it IS) and for a new version of an existing template
  // (which is the whole reason the tenant clicked "Add Spanish"); choosable
  // only when starting a template from nothing.
  const fixedLocale = template?.locale ?? (prefill ? target.kind === "new" ? target.locale : "en" : null);
  const [locale, setLocale] = useState(
    template?.locale ?? (target.kind === "new" ? target.locale : "en"),
  );

  const fetcher = useFetcher<{
    ok: boolean;
    intent?: string;
    preview?: { subject?: string; html?: string; text?: string };
    error?: string;
  }>();
  const previewFetcher = useFetcher<{
    ok: boolean;
    intent?: string;
    preview?: { subject?: string; html?: string; text?: string };
    error?: string;
  }>();

  // A new language version starts from the existing one: translating beats
  // retyping, and it keeps the merge variables intact.
  const [name, setName] = useState(template?.name ?? prefill?.name ?? "");
  const [subject, setSubject] = useState(template?.subject ?? prefill?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? prefill?.body ?? "");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [testTo, setTestTo] = useState("");
  const [testSent, setTestSent] = useState(false);

  const segmentCount = !isEmail ? smsSegmentsClient(body) : 0;

  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data?.ok &&
      fetcher.data.intent !== "preview" &&
      fetcher.data.intent !== "test-send"
    ) {
      onClose();
    }
  }, [fetcher.state, fetcher.data, onClose]);

  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data?.ok &&
      fetcher.data.intent === "test-send"
    ) {
      setTestSent(true);
    }
  }, [fetcher.state, fetcher.data]);

  function insertVariable(v: string) {
    const ta = bodyRef.current;
    if (!ta) {
      setBody((b) => b + `{{${v}}}`);
      return;
    }
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    const snippet = `{{${v}}}`;
    const next = body.slice(0, start) + snippet + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      ta.setSelectionRange(start + snippet.length, start + snippet.length);
      ta.focus();
    });
  }

  const variables = template?.variables ?? prefill?.variables ?? [];
  const isSaving = fetcher.state !== "idle";
  const isTesting =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "test-send";
  const isPreviewing = previewFetcher.state !== "idle";
  const previewData = previewFetcher.data?.preview;

  return (
    <Modal
      open
      onClose={onClose}
      title={
        template
          ? m.settings_msgtpl_edit_title()
          : prefill
          ? m.settings_msgtpl_new_variant_title({ language: localeLabel(locale) })
          : m.settings_msgtpl_new_channel_title({ channel })
      }
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {m.common_cancel()}
          </Button>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value={template ? "update" : "create"} />
            {template && <input type="hidden" name="id" value={template.id} />}
            <input type="hidden" name="channel" value={channel} />
            <input type="hidden" name="name" value={name} />
            <input type="hidden" name="locale" value={locale} />
            {isEmail && <input type="hidden" name="subject" value={subject} />}
            <input type="hidden" name="body" value={body} />
            {variables.map((v) => (
              <input key={v} type="hidden" name="variables" value={v} />
            ))}
            <Button
              type="submit"
              variant="primary"
              disabled={isSaving || !name.trim() || !body.trim()}
            >
              {template ? m.common_save() : m.settings_msgtpl_create()}
            </Button>
          </fetcher.Form>
        </>
      }
    >
      <div className="space-y-4">
        {fetcher.data && !fetcher.data.ok && fetcher.data.intent !== "test-send" && (
          <div className="px-3 py-2 rounded-md bg-ih-bad-bg text-ih-bad-fg text-[12px]">
            {fetcher.data.error ?? m.settings_error_generic()}
          </div>
        )}

        {/* Language */}
        <div>
          <label htmlFor="tpl-locale" className="block text-xs font-bold text-ih-fg-2 mb-1">
            {m.settings_msgtpl_language_label()}
          </label>
          {fixedLocale ? (
            <div className="flex items-center gap-2 flex-wrap">
              <Pill tone="neutral">{localeLabel(fixedLocale)}</Pill>
              <span className="text-[11px] text-ih-fg-3">
                {m.settings_msgtpl_language_locked({ name: name || m.settings_msgtpl_name_placeholder() })}
              </span>
            </div>
          ) : (
            <select
              id="tpl-locale"
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1"
            >
              {SUPPORTED_CONTACT_LOCALES.map((l) => (
                <option key={l} value={l}>{localeLabel(l)}</option>
              ))}
            </select>
          )}
        </div>

        {/* Name */}
        <div>
          <label
            htmlFor="tpl-name"
            className="block text-xs font-bold text-ih-fg-2 mb-1"
          >
            {m.settings_msgtpl_name_label()}
          </label>
          <input
            id="tpl-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={m.settings_msgtpl_name_placeholder()}
            required
            // Versions are matched by (name, channel). Letting the name drift
            // here would silently create an unrelated template that no send
            // path would ever fall back to.
            readOnly={prefill !== null}
            className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4 read-only:text-ih-fg-3"
          />
        </div>

        {/* Subject (email only) */}
        {isEmail && (
          <div>
            <label
              htmlFor="tpl-subject"
              className="block text-xs font-bold text-ih-fg-2 mb-1"
            >
              {m.settings_msgtpl_subject_line_label()}
            </label>
            <input
              id="tpl-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={m.settings_msgtpl_subject_placeholder()}
              className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4"
            />
          </div>
        )}

        {/* Body */}
        <div>
          <label
            htmlFor="tpl-body"
            className="block text-xs font-bold text-ih-fg-2 mb-1"
          >
            {isEmail ? m.settings_msgtpl_email_body_label() : m.settings_msgtpl_sms_body_label()}
          </label>
          {variables.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              <span className="text-[11px] text-ih-fg-3 self-center">{m.settings_msgtpl_insert_label()}</span>
              {variables.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVariable(v)}
                  className="text-[11px] px-1.5 py-0.5 rounded border border-ih-border bg-ih-bg-card text-ih-primary-text font-mono hover:bg-ih-primary-tint transition-colors"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          )}
          <textarea
            id="tpl-body"
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={isEmail ? 8 : 5}
            placeholder={
              isEmail
                ? "Hi {{inspector_name}}, your report for {{address}} is ready."
                : "Hi {{name}}, your report is ready: {{link}}"
            }
            className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4 resize-y focus:outline-none focus:border-ih-primary"
          />
          {!isEmail && (
            <p className="text-[11px] text-ih-fg-3 mt-1">
              {segmentCount === 0
                ? m.settings_msgtpl_segments_zero()
                : m.settings_msgtpl_segments_count({ chars: [...body].length, segments: segmentCount, plural: segmentCount !== 1 ? "s" : "" })}
            </p>
          )}
        </div>

        {/* Email preview */}
        {isEmail && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-ih-fg-2 uppercase tracking-wide">
                {m.settings_msgtpl_preview_label()}
              </span>
              <previewFetcher.Form method="post">
                <input type="hidden" name="intent" value="preview" />
                <input type="hidden" name="channel" value="email" />
                <input type="hidden" name="subject" value={subject} />
                <input type="hidden" name="body" value={body} />
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  disabled={isPreviewing || !body.trim()}
                >
                  {isPreviewing ? m.common_loading() : m.settings_msgtpl_refresh_preview()}
                </Button>
              </previewFetcher.Form>
            </div>
            {previewData && (
              <div className="rounded-md border border-ih-border bg-ih-bg-muted p-3 space-y-2">
                {previewData.subject && (
                  <p className="text-[12px] font-bold text-ih-fg-2">
                    {m.settings_msgtpl_preview_subject_label()}{" "}
                    <span className="font-normal text-ih-fg-1">{previewData.subject}</span>
                  </p>
                )}
                {previewData.html && (
                  <div
                    className="text-[12px] text-ih-fg-1 prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: previewData.html }}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Test send */}
        <div className="border-t border-ih-border pt-3">
          <p className="text-xs font-bold text-ih-fg-2 uppercase tracking-wide mb-2">
            {isEmail ? m.settings_msgtpl_test_send_email_heading() : m.settings_msgtpl_test_send_sms_heading()}
          </p>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-xs font-bold text-ih-fg-2 mb-1">
                {isEmail ? m.settings_msgtpl_to_email_label() : m.settings_msgtpl_to_phone_label()}
              </label>
              <input
                value={testTo}
                onChange={(e) => {
                  setTestTo(e.target.value);
                  setTestSent(false);
                }}
                placeholder={isEmail ? m.settings_msgtpl_to_email_placeholder() : m.settings_msgtpl_to_phone_placeholder()}
                type={isEmail ? "email" : "tel"}
                className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4"
              />
            </div>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="test-send" />
              <input type="hidden" name="channel" value={channel} />
              {isEmail && <input type="hidden" name="subject" value={subject} />}
              <input type="hidden" name="body" value={body} />
              <input type="hidden" name="to" value={testTo} />
              <Button
                type="submit"
                variant="secondary"
                disabled={isTesting || !testTo.trim() || !body.trim()}
              >
                {isTesting ? m.settings_sending() : m.settings_send()}
              </Button>
            </fetcher.Form>
          </div>
          {testSent && (
            <p className="text-[12px] text-ih-ok-fg mt-1">{m.settings_msgtpl_test_sent()}</p>
          )}
          {fetcher.data && !fetcher.data.ok && fetcher.data.intent === "test-send" && (
            <p className="text-[12px] text-ih-bad-fg mt-1">{fetcher.data.error}</p>
          )}
        </div>
      </div>
    </Modal>
  );
}


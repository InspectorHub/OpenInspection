import { useState, useEffect, useRef } from "react";
import { Link, useLoaderData, useFetcher } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-communication-templates";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";
import { Button, Pill, TabStrip, EmptyState, Card, Modal } from "@core/shared-ui";

// ─── Exported pure helper ────────────────────────────────────────────────────

/** GSM-ish client segment estimate — mirrors server smsSegmentInfo thresholds. */
export function smsSegmentsClient(body: string): number {
  const len = [...body].length;
  if (len === 0) return 0;
  // Client keeps the GSM happy-path estimate (server is authoritative on send).
  return len <= 160 ? 1 : Math.ceil(len / 153);
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface MessageTemplate {
  id: string;
  tenantId: string;
  name: string;
  channel: "email" | "sms";
  subject: string | null;
  body: string;
  variables: string[];
  isSeeded: boolean;
  createdAt: number;
  updatedAt: number;
}

interface ReferencingAutomation {
  id: string;
  name: string;
}

// ─── Meta ────────────────────────────────────────────────────────────────────

export function meta() {
  return [{ title: "Message Templates - Settings - OpenInspection" }];
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) return { forbidden: true as const };
  const api = createApi(context, { token });
  const [emailRes, smsRes] = await Promise.all([
    api.messageTemplates.index.$get({ query: { channel: "email" } }).catch(() => null),
    api.messageTemplates.index.$get({ query: { channel: "sms" } }).catch(() => null),
  ]);
  const emailTemplates =
    (emailRes && emailRes.ok
      ? ((await emailRes.json()) as { data?: MessageTemplate[] }).data
      : []) ?? [];
  const smsTemplates =
    (smsRes && smsRes.ok
      ? ((await smsRes.json()) as { data?: MessageTemplate[] }).data
      : []) ?? [];
  return { emailTemplates, smsTemplates };
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "create") {
    const channel = String(form.get("channel") ?? "") as "email" | "sms";
    const name = String(form.get("name") ?? "").trim();
    const subject = channel === "email" ? (String(form.get("subject") ?? "").trim() || null) : null;
    const body = String(form.get("body") ?? "");
    const variables = form.getAll("variables").map(String).filter(Boolean);
    const res = await api.messageTemplates.index.$post({
      json: { name, channel, subject, body, variables },
    });
    if (!res.ok) return { ok: false, error: "Failed to create template.", intent };
    return { ok: true, intent };
  }

  if (intent === "update") {
    const id = String(form.get("id") ?? "");
    const channel = String(form.get("channel") ?? "") as "email" | "sms";
    const name = String(form.get("name") ?? "").trim();
    const subject = channel === "email" ? (String(form.get("subject") ?? "").trim() || null) : null;
    const body = String(form.get("body") ?? "");
    const variables = form.getAll("variables").map(String).filter(Boolean);
    const res = await (
      api.messageTemplates[":id"].$patch as unknown as (a: {
        param: { id: string };
        json: { name?: string; subject?: string | null; body?: string; variables?: string[] };
      }) => Promise<Response>
    )({ param: { id }, json: { name, subject, body, variables } });
    if (!res.ok) return { ok: false, error: "Failed to update template.", intent };
    return { ok: true, intent };
  }

  if (intent === "duplicate") {
    const id = String(form.get("id") ?? "");
    const res = await (
      api.messageTemplates[":id"].duplicate.$post as unknown as (a: {
        param: { id: string };
      }) => Promise<Response>
    )({ param: { id } });
    if (!res.ok) return { ok: false, error: "Failed to duplicate template.", intent };
    return { ok: true, intent };
  }

  if (intent === "delete") {
    const id = String(form.get("id") ?? "");
    const res = await (
      api.messageTemplates[":id"].$delete as unknown as (a: {
        param: { id: string };
      }) => Promise<Response>
    )({ param: { id } });
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as {
        referencing?: ReferencingAutomation[];
        error?: string;
      } | null;
      return {
        ok: false,
        intent,
        conflict: true,
        referencing: body?.referencing ?? [],
        error: body?.error ?? "Template is in use.",
      };
    }
    if (!res.ok) return { ok: false, error: "Failed to delete template.", intent };
    return { ok: true, intent };
  }

  if (intent === "preview") {
    const channel = String(form.get("channel") ?? "") as "email" | "sms";
    const subject = String(form.get("subject") ?? "");
    const body = String(form.get("body") ?? "");
    const res = await api.messageTemplates.preview.$post({
      json: { channel, subject: subject || null, body },
    });
    if (!res.ok) return { ok: false, error: "Preview failed.", intent };
    const data = (
      (await res.json()) as { data?: { subject?: string; html?: string; text?: string } }
    ).data ?? {};
    return { ok: true, intent, preview: data };
  }

  if (intent === "test-send") {
    const channel = String(form.get("channel") ?? "") as "email" | "sms";
    const subject = String(form.get("subject") ?? "");
    const body = String(form.get("body") ?? "");
    const to = String(form.get("to") ?? "").trim();
    const res = await (
      api.messageTemplates["test-send"].$post as unknown as (a: {
        json: { channel: "email" | "sms"; subject?: string | null; body: string; to: string };
      }) => Promise<Response>
    )({ json: { channel, subject: channel === "email" ? (subject || null) : null, body, to } });
    const resBody = (await res.json().catch(() => null)) as {
      success?: boolean;
      error?: string;
    } | null;
    if (!resBody?.success) return { ok: false, error: resBody?.error ?? "Test send failed.", intent };
    return { ok: true, intent };
  }

  return { ok: true, intent: String(intent ?? "") };
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SettingsCommunicationTemplates() {
  const data = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState<"email" | "sms">("email");
  const [editing, setEditing] = useState<MessageTemplate | "new-email" | "new-sms" | null>(null);
  const [deleting, setDeleting] = useState<MessageTemplate | null>(null);

  if ("forbidden" in data) return <AccessDenied />;
  const { emailTemplates, smsTemplates } = data;

  const templates = activeTab === "email" ? emailTemplates : smsTemplates;

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb
        items={[
          { label: "Settings", href: "/settings" },
          { label: "Communication", href: "/settings/communication" },
          { label: "Templates" },
        ]}
      />

      <div className="flex items-start justify-between gap-4">
        <p className="text-[13px] text-ih-fg-3">Reusable message templates for automations.</p>
        <Button
          variant="primary"
          onClick={() => setEditing(activeTab === "email" ? "new-email" : "new-sms")}
        >
          + New template
        </Button>
      </div>

      <TabStrip
        tabs={[
          { id: "email", label: "Email", count: emailTemplates.length },
          { id: "sms", label: "SMS", count: smsTemplates.length },
        ]}
        activeId={activeTab}
        onChange={(id) => setActiveTab(id as "email" | "sms")}
      />

      <TemplateList
        templates={templates}
        onEdit={setEditing}
        onDelete={setDeleting}
      />

      {/* Compliance SMS section */}
      <ComplianceSmsSection />

      {editing !== null && (
        <TemplateEditorModal
          template={
            editing === "new-email" || editing === "new-sms" ? null : editing
          }
          defaultChannel={
            editing === "new-email"
              ? "email"
              : editing === "new-sms"
              ? "sms"
              : editing.channel
          }
          onClose={() => setEditing(null)}
        />
      )}

      {deleting !== null && (
        <DeleteModal template={deleting} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}

// ─── Template list ────────────────────────────────────────────────────────────

function TemplateList({
  templates,
  onEdit,
  onDelete,
}: {
  templates: MessageTemplate[];
  onEdit: (t: MessageTemplate) => void;
  onDelete: (t: MessageTemplate) => void;
}) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();

  if (templates.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No templates yet"
          description="Create a template to reuse across your automations."
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="divide-y divide-ih-border">
        {templates.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-4 px-5 py-3.5 hover:bg-ih-bg-muted transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-bold text-ih-fg-1">{t.name}</span>
                {t.isSeeded && <Pill tone="info">Built-in</Pill>}
              </div>
              {t.subject && (
                <p className="text-[11px] text-ih-fg-3 mt-0.5 truncate">Subject: {t.subject}</p>
              )}
              {t.variables.length > 0 && (
                <p className="text-[11px] text-ih-fg-4 mt-0.5">
                  Variables: {t.variables.map((v) => `{{${v}}}`).join(", ")}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => onEdit(t)}
                className="text-[12px] text-ih-primary font-semibold hover:underline"
              >
                Edit
              </button>
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="duplicate" />
                <input type="hidden" name="id" value={t.id} />
                <button
                  type="submit"
                  className="text-[12px] text-ih-fg-3 font-semibold hover:text-ih-fg-1"
                >
                  Duplicate
                </button>
              </fetcher.Form>
              {!t.isSeeded && (
                <button
                  onClick={() => onDelete(t)}
                  className="text-[12px] text-ih-bad-fg font-semibold hover:underline"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Delete modal ─────────────────────────────────────────────────────────────

function DeleteModal({
  template,
  onClose,
}: {
  template: MessageTemplate;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{
    ok: boolean;
    intent?: string;
    conflict?: boolean;
    referencing?: ReferencingAutomation[];
    error?: string;
  }>();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  const isConflict = fetcher.data?.conflict === true;
  const referencing = fetcher.data?.referencing ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      title="Delete template"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {!isConflict && (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="id" value={template.id} />
              <Button type="submit" variant="danger" disabled={fetcher.state !== "idle"}>
                Delete
              </Button>
            </fetcher.Form>
          )}
        </>
      }
    >
      {isConflict ? (
        <div className="space-y-3">
          <p className="text-[13px] text-ih-fg-1">
            This template is used by {referencing.length} automation
            {referencing.length !== 1 ? "s" : ""} and cannot be deleted:
          </p>
          <ul className="space-y-1">
            {referencing.map((a) => (
              <li
                key={a.id}
                className="text-[13px] text-ih-fg-2 pl-3 border-l-2 border-ih-border"
              >
                {a.name}
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-ih-fg-3">
            Remove the template from those automations first, then retry.
          </p>
        </div>
      ) : (
        <p className="text-[13px] text-ih-fg-2">
          Delete <strong className="text-ih-fg-1">{template.name}</strong>? This cannot be
          undone.
        </p>
      )}
    </Modal>
  );
}

// ─── Template editor modal ────────────────────────────────────────────────────

function TemplateEditorModal({
  template,
  defaultChannel,
  onClose,
}: {
  template: MessageTemplate | null;
  defaultChannel: "email" | "sms";
  onClose: () => void;
}) {
  const channel = template?.channel ?? defaultChannel;
  const isEmail = channel === "email";

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

  const [name, setName] = useState(template?.name ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
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

  const variables = template?.variables ?? [];
  const isSaving = fetcher.state !== "idle";
  const isTesting =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "test-send";
  const isPreviewing = previewFetcher.state !== "idle";
  const previewData = previewFetcher.data?.preview;

  return (
    <Modal
      open
      onClose={onClose}
      title={template ? "Edit template" : `New ${channel} template`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value={template ? "update" : "create"} />
            {template && <input type="hidden" name="id" value={template.id} />}
            <input type="hidden" name="channel" value={channel} />
            <input type="hidden" name="name" value={name} />
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
              {template ? "Save" : "Create"}
            </Button>
          </fetcher.Form>
        </>
      }
    >
      <div className="space-y-4">
        {fetcher.data && !fetcher.data.ok && fetcher.data.intent !== "test-send" && (
          <div className="px-3 py-2 rounded-md bg-ih-bad-bg text-ih-bad-fg text-[12px]">
            {fetcher.data.error ?? "An error occurred."}
          </div>
        )}

        {/* Name */}
        <div>
          <label
            htmlFor="tpl-name"
            className="block text-xs font-bold text-ih-fg-2 mb-1"
          >
            Template name
          </label>
          <input
            id="tpl-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Report ready — email"
            required
            className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-input text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4"
          />
        </div>

        {/* Subject (email only) */}
        {isEmail && (
          <div>
            <label
              htmlFor="tpl-subject"
              className="block text-xs font-bold text-ih-fg-2 mb-1"
            >
              Subject line
            </label>
            <input
              id="tpl-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Your inspection report is ready"
              className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-input text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4"
            />
          </div>
        )}

        {/* Body */}
        <div>
          <label
            htmlFor="tpl-body"
            className="block text-xs font-bold text-ih-fg-2 mb-1"
          >
            {isEmail ? "Email body" : "SMS body"}
          </label>
          {variables.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              <span className="text-[11px] text-ih-fg-3 self-center">Insert:</span>
              {variables.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVariable(v)}
                  className="text-[11px] px-1.5 py-0.5 rounded border border-ih-border bg-ih-bg-input text-ih-primary font-mono hover:bg-ih-primary-tint transition-colors"
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
            className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-input text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4 resize-y focus:outline-none focus:border-ih-primary"
          />
          {!isEmail && (
            <p className="text-[11px] text-ih-fg-3 mt-1">
              {segmentCount === 0
                ? "0 characters · 0 segments"
                : `${[...body].length} characters · ${segmentCount} segment${segmentCount !== 1 ? "s" : ""}`}
            </p>
          )}
        </div>

        {/* Email preview */}
        {isEmail && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-ih-fg-2 uppercase tracking-wide">
                Preview
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
                  {isPreviewing ? "Loading…" : "Refresh preview"}
                </Button>
              </previewFetcher.Form>
            </div>
            {previewData && (
              <div className="rounded-md border border-ih-border bg-ih-bg-muted p-3 space-y-2">
                {previewData.subject && (
                  <p className="text-[12px] font-bold text-ih-fg-2">
                    Subject:{" "}
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
            Send test {isEmail ? "email" : "SMS"}
          </p>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-xs font-bold text-ih-fg-2 mb-1">
                {isEmail ? "To email" : "To phone (+1 555 000 0000)"}
              </label>
              <input
                value={testTo}
                onChange={(e) => {
                  setTestTo(e.target.value);
                  setTestSent(false);
                }}
                placeholder={isEmail ? "you@example.com" : "+15550001234"}
                type={isEmail ? "email" : "tel"}
                className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-input text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4"
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
                {isTesting ? "Sending…" : "Send"}
              </Button>
            </fetcher.Form>
          </div>
          {testSent && (
            <p className="text-[12px] text-ih-ok-fg mt-1">Test sent.</p>
          )}
          {fetcher.data && !fetcher.data.ok && fetcher.data.intent === "test-send" && (
            <p className="text-[12px] text-ih-bad-fg mt-1">{fetcher.data.error}</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ─── Compliance SMS section ────────────────────────────────────────────────────

function ComplianceSmsSection() {
  return (
    <section className="space-y-2">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
        Compliance SMS
      </h3>
      <Card className="p-4 space-y-3">
        <div>
          <p className="text-[13px] font-semibold text-ih-fg-1 mb-1">Opt-in disclosure</p>
          <p className="text-[12px] text-ih-fg-3">
            Your opt-in disclosure text is configured in{" "}
            <Link to="/settings/communication" className="text-ih-primary hover:underline">
              Communication settings
            </Link>{" "}
            under SMS delivery. Tenants using BYO Twilio manage disclosure copy there.
          </p>
        </div>
        <div>
          <p className="text-[13px] font-semibold text-ih-fg-1 mb-1">STOP / START / HELP</p>
          <p className="text-[12px] text-ih-fg-3">
            Inbound opt-out (STOP), opt-in (START), and help (HELP) keywords are handled
            automatically by your SMS provider. When a recipient texts STOP, future messages
            are suppressed at the provider level. You do not need to handle these replies
            manually — they are recorded in the compliance log in Communication settings.
          </p>
        </div>
      </Card>
    </section>
  );
}

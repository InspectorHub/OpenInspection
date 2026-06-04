import { Link, useLoaderData, useActionData, Form, useNavigation, redirect } from "react-router";
import { useRef, useState } from "react";
import type { Route } from "./+types/settings-communication-template";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { VariableChips } from "~/components/email-template/VariableChips";
import { EmailPreview } from "~/components/email-template/EmailPreview";

interface BlockField { key: string; label: string; multiline: boolean; value: string; }
interface Detail { trigger: string; name: string; required: boolean; enabled: boolean; subject: string; blocks: BlockField[]; variables: { name: string; desc: string }[]; }

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.detail?.name ?? "Template"} - Communication - OpenInspection` }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const res = await api.emailTemplates["email-templates"][":trigger"].$get({ param: { trigger: params.trigger } }).catch(() => null);
  if (!res || !res.ok) throw new Response("Not found", { status: 404 });
  const body = (await res.json()) as { data: Detail };
  return { detail: body.data };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const form = await request.formData();
  const intent = form.get("intent");
  const trigger = params.trigger;

  if (intent === "preview") {
    const subjectRaw = String(form.get("subject") ?? "");
    const blocks: Record<string, string> = {};
    for (const [k, v] of form.entries()) {
      if (k.startsWith("block:")) blocks[k.slice("block:".length)] = String(v);
    }
    const res = await api.emailTemplates["email-templates"][":trigger"].preview.$post({
      param: { trigger },
      json: { subject: subjectRaw.trim() ? subjectRaw : null, blocks: Object.keys(blocks).length ? blocks : null },
    });
    if (!res.ok) return { preview: null };
    const body = (await res.json()) as { data: { subject: string; html: string } };
    return { preview: body.data };
  }

  if (intent === "reset") {
    const res = await api.emailTemplates["email-templates"][":trigger"].reset.$post({ param: { trigger } });
    if (!res.ok) return { ok: false as const, error: "Failed to reset." };
    return redirect(`/settings/communication/templates/${trigger}`);
  }

  const subjectRaw = String(form.get("subject") ?? "");
  const enabled = form.get("enabled") === "on";
  const blocks: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (k.startsWith("block:")) blocks[k.slice("block:".length)] = String(v);
  }
  const res = await api.emailTemplates["email-templates"][":trigger"].$put({
    param: { trigger },
    json: { subject: subjectRaw.trim() ? subjectRaw : null, blocks: Object.keys(blocks).length ? blocks : null, enabled },
  });
  if (!res.ok) {
    const msg = await res.json().then((b) => (b as { error?: { message?: string } }).error?.message).catch(() => undefined);
    return { ok: false as const, error: msg ?? "Failed to save." };
  }
  return { ok: true as const };
}

export default function TemplateEditorRoute() {
  const { detail } = useLoaderData<typeof loader>();
  // Re-mount the stateful editor whenever the loaded values change — e.g. after
  // Reset deletes the override and the loader returns defaults — so the form's
  // useState re-seeds from the fresh detail instead of keeping stale local edits.
  const seedKey = `${detail.trigger}|${detail.subject}|${JSON.stringify(detail.blocks)}|${detail.enabled}`;
  return <TemplateEditor key={seedKey} detail={detail} />;
}

function TemplateEditor({ detail }: { detail: Detail }) {
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const saving = nav.state !== "idle" && nav.formData?.get("intent") === "save";

  const [subject, setSubject] = useState(detail.subject);
  const [blocks, setBlocks] = useState<Record<string, string>>(Object.fromEntries(detail.blocks.map((b) => [b.key, b.value])));
  const [enabled, setEnabled] = useState(detail.enabled);
  const [confirmReset, setConfirmReset] = useState(false);

  const activeRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const insert = (token: string) => {
    const el = activeRef.current; if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + token + el.value.slice(end);
    if (el.name === "subject") setSubject(next);
    else if (el.name.startsWith("block:")) setBlocks((b) => ({ ...b, [el.name.slice(6)]: next }));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  };

  return (
    <div className="space-y-[18px]">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-[13px] text-ih-fg-3">
          <Link to="/settings" className="hover:text-ih-primary transition-colors">Settings</Link><span>&rsaquo;</span>
          <Link to="/settings/communication" className="hover:text-ih-primary transition-colors">Communication</Link><span>&rsaquo;</span>
          <span className="text-ih-fg-1">{detail.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {confirmReset ? (
            <Form method="post" className="flex items-center gap-2">
              <input type="hidden" name="intent" value="reset" />
              <span className="text-[12px] text-ih-fg-3">Reset to default?</span>
              <button type="submit" className="h-8 px-3 rounded-md bg-ih-bad-bg text-ih-bad-fg border border-ih-bad text-[12px] font-bold">Reset</button>
              <button type="button" onClick={() => setConfirmReset(false)} className="h-8 px-3 rounded-md border border-ih-border text-[12px] text-ih-fg-2">Cancel</button>
            </Form>
          ) : (
            <button type="button" onClick={() => setConfirmReset(true)} className="h-8 px-3 rounded-md border border-ih-border text-[12px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors">Reset to default</button>
          )}
        </div>
      </div>

      {actionData && "ok" in actionData && actionData.ok && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok text-[13px] text-ih-ok-fg font-medium">Saved.</div>
      )}
      {actionData && "ok" in actionData && !actionData.ok && (
        <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">{actionData.error}</div>
      )}

      <Form method="post" className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <input type="hidden" name="intent" value="save" />

        <div className="space-y-5 bg-ih-bg-card border border-ih-border rounded-lg p-5">
          {!detail.required ? (
            <label className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-ih-fg-2">Send this email</span>
              <input type="checkbox" name="enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 rounded border-ih-border" />
            </label>
          ) : (
            <input type="hidden" name="enabled" value="on" />
          )}

          <div>
            <label htmlFor="field-subject" className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1">Subject</label>
            <input id="field-subject" name="subject" value={subject} onFocus={(e) => (activeRef.current = e.currentTarget)} onChange={(e) => setSubject(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none" />
          </div>

          {detail.blocks.map((b, i) => (
            <div key={b.key} style={{ animationDelay: `${i * 40}ms` }} className="motion-safe:animate-[fadeIn_.3s_ease_both]">
              <label htmlFor={`field-block-${b.key}`} className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1">{b.label}</label>
              {b.multiline ? (
                <textarea id={`field-block-${b.key}`} name={`block:${b.key}`} rows={3} value={blocks[b.key] ?? ""} onFocus={(e) => (activeRef.current = e.currentTarget)} onChange={(e) => setBlocks((s) => ({ ...s, [b.key]: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 leading-relaxed focus:border-ih-primary focus:shadow-ih-focus outline-none resize-y" />
              ) : (
                <input id={`field-block-${b.key}`} name={`block:${b.key}`} value={blocks[b.key] ?? ""} onFocus={(e) => (activeRef.current = e.currentTarget)} onChange={(e) => setBlocks((s) => ({ ...s, [b.key]: e.target.value }))}
                  className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none" />
              )}
            </div>
          ))}

          <div className="pt-3 border-t border-ih-border space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">Variables — click to insert</p>
            <VariableChips variables={detail.variables} onInsert={insert} />
          </div>

          <div className="flex justify-end pt-2">
            <button type="submit" disabled={saving} className="h-9 px-5 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-60">
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>

        <EmailPreview trigger={detail.trigger} subject={subject} blocks={blocks} />
      </Form>
    </div>
  );
}

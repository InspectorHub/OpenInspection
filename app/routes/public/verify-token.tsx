import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { m } from "~/paraglide/messages";

interface VerifyStatus {
  envelopeId: string;
  documentTitle: string | null;
  clientName: string | null;
  clientEmail: string;
  chainValid: boolean;
  chainReason: string | null;
  keyFingerprint: string | null;
  keyAlgorithm: string;
  eventCount: number;
}

export function meta() {
  return [{ title: m.public_verify_token_meta_title() }];
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const token = params.token as string;
  const origin = new URL(request.url).origin;
  const resolveRes = await fetch(`${origin}/api/public/verify-by-token/${encodeURIComponent(token)}`);
  if (!resolveRes.ok) throw new Response("Not Found", { status: 404 });
  const resolveJson = (await resolveRes.json()) as { data: { envelopeId: string } };
  const envelopeId = resolveJson.data.envelopeId;
  const statusRes = await fetch(`${origin}/api/public/verify/${envelopeId}`);
  if (!statusRes.ok) throw new Response("Not Found", { status: 404 });
  const statusJson = (await statusRes.json()) as { data: VerifyStatus };
  return { token, envelopeId, status: statusJson.data };
}

export default function VerifyToken() {
  const { envelopeId, status } = useLoaderData<typeof loader>();
  const valid = status.chainValid;
  return (
    <main className="max-w-2xl mx-auto p-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">{m.public_verify_token_heading()}</h1>
        <p className={"mt-2 text-sm " + (valid ? "text-ih-ok-fg" : "text-ih-bad-fg")}>
          {valid
            ? m.public_verify_token_valid()
            : m.public_verify_token_failed({ reason: status.chainReason ?? m.public_verify_token_unknown_reason() })}
        </p>
      </header>
      <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-sm">
        <dt className="text-ih-fg-3">{m.public_verify_token_signer_label()}</dt>
        <dd>{status.clientName ?? status.clientEmail}</dd>
        <dt className="text-ih-fg-3">{m.public_verify_token_document_label()}</dt>
        <dd>{status.documentTitle ?? m.public_verify_token_untitled()}</dd>
        <dt className="text-ih-fg-3">{m.public_verify_token_events_label()}</dt>
        <dd>{status.eventCount}</dd>
        <dt className="text-ih-fg-3">{m.public_verify_token_fingerprint_label()}</dt>
        <dd className="font-mono break-all">{status.keyFingerprint ?? "—"}</dd>
        <dt className="text-ih-fg-3">{m.public_verify_token_algorithm_label()}</dt>
        <dd>{status.keyAlgorithm}</dd>
      </dl>
      <div className="mt-8 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <a className="underline text-ih-primary" href={`/api/public/verify/${envelopeId}/document`}>{m.public_verify_token_view_document()}</a>
        <a className="underline text-ih-primary" href={`/api/public/verify/${envelopeId}/audit-trail`}>{m.public_verify_token_download_audit()}</a>
        <a className="underline text-ih-primary" href={`/api/public/verify/${envelopeId}/public-key`}>{m.public_verify_token_download_key()}</a>
        <a className="underline text-ih-primary" href="/verify">{m.public_verify_token_offline()}</a>
      </div>
      <footer className="mt-12 text-xs text-ih-fg-3">
        <p>
          {m.public_verify_token_footer()}
        </p>
      </footer>
    </main>
  );
}

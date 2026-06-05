import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

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
  return [{ title: "Verify Document - OpenInspection" }];
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
        <h1 className="text-2xl font-bold">Document Verification</h1>
        <p className={"mt-2 text-sm " + (valid ? "text-ih-ok-fg" : "text-ih-bad-fg")}>
          {valid
            ? "✓ Audit chain is intact and Ed25519 signatures are valid."
            : `✗ Chain failed: ${status.chainReason ?? "unknown reason"}`}
        </p>
      </header>
      <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-sm">
        <dt className="text-ih-fg-3">Signer</dt>
        <dd>{status.clientName ?? status.clientEmail}</dd>
        <dt className="text-ih-fg-3">Document</dt>
        <dd>{status.documentTitle ?? "Untitled"}</dd>
        <dt className="text-ih-fg-3">Audit events</dt>
        <dd>{status.eventCount}</dd>
        <dt className="text-ih-fg-3">Key fingerprint</dt>
        <dd className="font-mono break-all">{status.keyFingerprint ?? "—"}</dd>
        <dt className="text-ih-fg-3">Algorithm</dt>
        <dd>{status.keyAlgorithm}</dd>
      </dl>
      <div className="mt-8 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <a className="underline text-ih-primary" href={`/api/public/verify/${envelopeId}/document`}>View signed document</a>
        <a className="underline text-ih-primary" href={`/api/public/verify/${envelopeId}/audit-trail`}>Download audit-trail.json</a>
        <a className="underline text-ih-primary" href={`/api/public/verify/${envelopeId}/public-key`}>Download public-key.pem</a>
        <a className="underline text-ih-primary" href="/verify">Offline self-verify (advanced)</a>
      </div>
      <footer className="mt-12 text-xs text-ih-fg-3">
        <p>
          This page verifies the signed document against the tenant's Ed25519
          public key. For an audit independent of this server, download the
          evidence pack and use the offline self-verify page (above).
        </p>
      </footer>
    </main>
  );
}

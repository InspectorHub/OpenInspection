import { useLoaderData } from "react-router";
import type { Route } from "./+types/verify";
import { createApi } from "~/lib/api-client.server";
import { SanitizedHtml } from "~/components/SanitizedHtml";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.public_verify_meta_title() }];
}

interface VerifySigner {
  name: string;
  role: string;
  status: string;
  signedAt: string | null;
  channel: string | null;
}

interface VerifyData {
  envelopeId: string;
  documentTitle: string | null;
  clientName: string | null;
  chainValid: boolean;
  chainReason: string | null;
  keyFingerprint: string | null;
  keyAlgorithm: string;
  eventCount: number;
  // Track I-a — the pinned snapshot ("what was signed") + per-signer roster.
  contentSnapshot: string | null;
  contentHash: string | null;
  signers: VerifySigner[];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  try {
    const api = createApi(context);
    const res = await api.publicReport.verify[":envelopeId"].$get({
      param: { envelopeId: params.envelopeId ?? "" },
    });
    const body = res.ok ? await res.json() : {};
    const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    return {
      result: (Object.keys(d).length > 0 ? d : null) as VerifyData | null,
      error: res.ok ? null : m.public_verify_error_failed(),
    };
  } catch {
    return { result: null, error: m.public_verify_error_unavailable() };
  }
}

const roleLabel = (role: string): string => {
  switch (role) {
    case "client":
      return m.public_verify_role_client();
    case "co_client":
      return m.public_verify_role_co_client();
    case "agent":
      return m.public_verify_role_agent();
    default:
      return m.public_verify_role_signer();
  }
};

function StatusChip({ status }: { status: string }) {
  const tone =
    status === "signed"
      ? "bg-ih-ok-bg text-ih-ok-fg"
      : status === "declined" || status === "expired"
        ? "bg-ih-bad-bg text-ih-bad-fg"
        : "bg-ih-bg-muted text-ih-fg-3";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${tone}`}
    >
      {status}
    </span>
  );
}

export default function VerifyPage() {
  const { result, error } = useLoaderData<typeof loader>();

  if (error || !result) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold">{m.public_verify_failed_heading()}</h1>
        <p className="text-ih-fg-3 mt-2">
          {error ?? m.public_verify_failed_fallback()}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto p-6">
      {/* Verification result */}
      <div
        className={`p-4 rounded-lg text-center mb-6 ${
          result.chainValid
            ? "bg-ih-ok-bg text-ih-ok-fg"
            : "bg-ih-bad-bg text-ih-bad-fg"
        }`}
      >
        <p className="text-lg font-bold">
          {result.chainValid ? m.public_verify_result_valid() : m.public_verify_result_invalid()}
        </p>
        <p className="text-[13px] mt-1">
          {result.documentTitle ?? m.public_verify_document_fallback()}
          {result.clientName ? m.public_verify_for_client({ name: result.clientName }) : ""}
        </p>
      </div>

      {/* What was signed — pinned content snapshot */}
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ih-fg-3 mb-3">
        {m.public_verify_section_signed()}
      </h2>
      {result.contentSnapshot === null ? (
        <div className="rounded-lg border border-ih-border bg-ih-bg-muted p-4 text-[13px] text-ih-fg-3 mb-6">
          {m.public_verify_snapshot_unavailable()}
        </div>
      ) : (
        <SanitizedHtml
          className="prose prose-sm max-w-none rounded-lg border border-ih-border bg-ih-bg-card p-4 text-[13px] text-ih-fg-2 leading-relaxed mb-6"
          html={result.contentSnapshot}
        />
      )}

      {/* Signers */}
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ih-fg-3 mb-3">
        {m.public_verify_section_signers()}
      </h2>
      <div className="space-y-2 mb-6">
        {result.signers.length === 0 ? (
          <p className="text-[13px] text-ih-fg-3">{m.public_verify_no_signers()}</p>
        ) : (
          result.signers.map((s, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 text-[13px] p-3 rounded-lg border border-ih-border"
            >
              <div>
                <p className="font-medium">
                  {s.name}
                  <span className="text-ih-fg-3 font-normal">
                    {" "}
                    · {roleLabel(s.role)}
                  </span>
                </p>
                <p className="text-[11px] text-ih-fg-3">
                  {s.signedAt ? m.public_verify_signed_at({ signedAt: s.signedAt }) : m.public_verify_not_signed()}
                  {s.channel === "in_person" ? m.public_verify_channel_in_person() : ""}
                </p>
              </div>
              <StatusChip status={s.status} />
            </div>
          ))
        )}
      </div>

      {/* Chain summary */}
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ih-fg-3 mb-3">
        {m.public_verify_section_audit()}
      </h2>
      <div className="text-[13px] p-3 rounded-lg border border-ih-border space-y-1">
        <p>
          <span className="text-ih-fg-3">{m.public_verify_events_label()}</span> {result.eventCount}
        </p>
        <p>
          <span className="text-ih-fg-3">{m.public_verify_algorithm_label()}</span> {result.keyAlgorithm}
        </p>
        {result.keyFingerprint && (
          <p className="break-all">
            <span className="text-ih-fg-3">{m.public_verify_fingerprint_label()}</span>{" "}
            <code className="text-[11px]">{result.keyFingerprint}</code>
          </p>
        )}
        {!result.chainValid && result.chainReason && (
          <p className="text-ih-bad-fg">{result.chainReason}</p>
        )}
      </div>
    </div>
  );
}

import { useLoaderData } from "react-router";
import { usePdfExport, pdfActionLabel, PDF_BUSY_HINT } from "~/hooks/usePdfExport";
import type { Route } from "./+types/v.$token";
import { createApi } from "~/lib/api-client.server";

export function meta() {
  return [{ title: "Verify Report - OpenInspection" }];
}

// ---------------------------------------------------------------------------
// Pure model — testable without a Hono context or DOM.
// ---------------------------------------------------------------------------

export interface VerifyInput {
  legacy: boolean;
  hashValid?: boolean;
  signatureValid?: boolean;
  chainValid?: boolean;
  notPublished?: boolean;
  versionNumber?: number;
  publishedAt?: number;
  contentHash?: string;
  propertyAddressMasked?: string;
}

export interface VerifyModel {
  state: "verified" | "legacy" | "failed" | "not_published";
  versionNumber?: number;
  publishedAt?: number;
  contentHash?: string;
  address?: string;
}

export function verifyResultModel(v: VerifyInput): VerifyModel {
  const base = {
    versionNumber: v.versionNumber,
    publishedAt: v.publishedAt,
    contentHash: v.contentHash,
    address: v.propertyAddressMasked,
  };
  if (v.notPublished) return { state: "not_published", ...base };
  if (v.legacy) return { state: "legacy", ...base };
  if (v.hashValid && v.signatureValid && v.chainValid)
    return { state: "verified", ...base };
  return { state: "failed", ...base };
}

// ---------------------------------------------------------------------------
// Loader — dual-lookup: report verifier first, then agreement verifier.
// ---------------------------------------------------------------------------

type LoaderResult =
  | { kind: "report"; model: VerifyModel; token: string }
  | { kind: "agreement"; envelopeId: string }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

export async function loader({
  params,
  context,
}: Route.LoaderArgs): Promise<LoaderResult> {
  const token = params.token ?? "";
  const api = createApi(context);

  // 1. Try the report verifier (GET /api/public/verify/report/:token)
  try {
    const res = await api.publicReport.verify.report[":token"].$get({
      param: { token },
    });

    if (res.ok) {
      const body = await res.json();
      const d = ((body as Record<string, unknown>).data ?? {}) as Record<
        string,
        unknown
      >;
      if (Object.keys(d).length > 0) {
        const v = d as {
          legacy: boolean;
          hashValid: boolean;
          signatureValid: boolean;
          chainValid: boolean;
          notPublished: boolean;
          versionNumber: number;
          publishedAt: number;
          contentHash: string | null;
          propertyAddressMasked: string;
        };
        return {
          kind: "report",
          token,
          model: verifyResultModel({
            legacy: v.legacy,
            hashValid: v.hashValid,
            signatureValid: v.signatureValid,
            chainValid: v.chainValid,
            notPublished: v.notPublished,
            versionNumber: v.versionNumber,
            publishedAt: v.publishedAt,
            contentHash: v.contentHash ?? undefined,
            propertyAddressMasked: v.propertyAddressMasked,
          }),
        };
      }
    }

    // 404 from report verifier — fall through to agreement verifier below.
    if (res.status !== 404) {
      return { kind: "error", message: "Verification service unavailable" };
    }
  } catch {
    return { kind: "error", message: "Verification service unavailable" };
  }

  // 2. Fall back: try the agreement verifier (GET /api/public/verify-by-token/:token)
  // This endpoint is a plain Hono GET (not part of the typed OpenAPI router),
  // so we call it via fetch through the underlying API base URL.
  try {
    const res = await api.publicReport.verify[":envelopeId"].$get({
      // We intentionally misuse the envelopeId slot here to hit
      // GET /api/public/verify/:token so we can check if the token is an
      // agreement verification token (old /verify/:envelopeId pattern).
      // If that also 404s, the token is genuinely unknown.
      param: { envelopeId: token },
    });

    if (res.ok) {
      const body = await res.json();
      const d = ((body as Record<string, unknown>).data ?? {}) as Record<
        string,
        unknown
      >;
      if (d.envelopeId) {
        return { kind: "agreement", envelopeId: d.envelopeId as string };
      }
    }
  } catch {
    // ignore — fall through to not_found
  }

  return { kind: "not_found" };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash;
}

export default function VerifyTokenPage() {
  const result = useLoaderData<typeof loader>();
  // Shared Browser Rendering rate-limit UX for the signed-PDF download. Declared
  // before the early return below so the hook runs unconditionally.
  const pdf = usePdfExport();

  // Agreement match → redirect hint with link to existing verify page.
  if (result.kind === "agreement") {
    return (
      <div className="max-w-xl mx-auto p-6 text-center">
        <p className="text-ih-fg-2 text-[15px]">
          This link is an agreement verification token.{" "}
          <a
            href={`/verify/${result.envelopeId}`}
            className="text-ih-accent underline underline-offset-2"
          >
            View agreement verification
          </a>
        </p>
      </div>
    );
  }

  if (result.kind === "not_found") {
    return (
      <div className="max-w-xl mx-auto p-6 text-center">
        <h1 className="text-2xl font-bold text-ih-fg-1">Not Found</h1>
        <p className="text-ih-fg-3 mt-2 text-[14px]">
          No report or agreement matches this verification token.
        </p>
      </div>
    );
  }

  if (result.kind === "error") {
    return (
      <div className="max-w-xl mx-auto p-6 text-center">
        <h1 className="text-2xl font-bold text-ih-bad-fg">Error</h1>
        <p className="text-ih-fg-3 mt-2 text-[14px]">{result.message}</p>
      </div>
    );
  }

  // Report result
  const { model, token } = result;

  if (model.state === "legacy") {
    return (
      <div className="max-w-xl mx-auto p-6">
        <div className="rounded-lg bg-ih-warn-bg text-ih-warn-fg p-4 text-center mb-6">
          <p className="text-lg font-bold">
            ⚠️ Legacy Version
          </p>
          <p className="text-[13px] mt-1">
            Integrity not cryptographically verifiable — this report was
            published before signing was introduced.
          </p>
        </div>
        {model.versionNumber !== undefined && (
          <p className="text-[13px] text-ih-fg-3 text-center">
            Report version v{model.versionNumber}
            {model.publishedAt
              ? ` · Published ${formatDate(model.publishedAt)}`
              : ""}
          </p>
        )}
      </div>
    );
  }

  if (model.state === "not_published") {
    return (
      <div className="max-w-xl mx-auto p-6">
        <div className="rounded-lg bg-ih-bad-bg text-ih-bad-fg p-4 text-center mb-6">
          <p className="text-lg font-bold">Not published</p>
          <p className="text-[13px] mt-1">This report is not published.</p>
        </div>
      </div>
    );
  }

  if (model.state === "failed") {
    return (
      <div className="max-w-xl mx-auto p-6">
        <div className="rounded-lg bg-ih-bad-bg text-ih-bad-fg p-4 text-center mb-6">
          <p className="text-lg font-bold">❌ Verification Failed</p>
          <p className="text-[13px] mt-1">
            This report's cryptographic signature could not be verified. The
            content may have been altered.
          </p>
        </div>
        {model.versionNumber !== undefined && (
          <p className="text-[13px] text-ih-fg-3 text-center">
            Report version v{model.versionNumber}
          </p>
        )}
      </div>
    );
  }

  // state === 'verified'
  return (
    <div className="max-w-xl mx-auto p-6">
      {/* Result banner */}
      <div className="rounded-lg bg-ih-ok-bg text-ih-ok-fg p-4 text-center mb-6">
        <p className="text-lg font-bold">✅ Verified</p>
        {model.versionNumber !== undefined && (
          <p className="text-[13px] mt-1">
            Report version v{model.versionNumber}
            {model.publishedAt
              ? ` · Published ${formatDate(model.publishedAt)}`
              : ""}
          </p>
        )}
      </div>

      {/* Details */}
      <div className="rounded-lg border border-ih-border text-[13px] divide-y divide-ih-border mb-6">
        {model.address && (
          <div className="flex justify-between gap-3 p-3">
            <span className="text-ih-fg-3">Property</span>
            <span className="text-ih-fg-1 font-medium text-right">
              {model.address}
            </span>
          </div>
        )}
        {model.contentHash && (
          <div className="flex justify-between gap-3 p-3">
            <span className="text-ih-fg-3">Content hash</span>
            <code className="text-[11px] text-ih-fg-2 break-all text-right">
              {shortHash(model.contentHash)}
            </code>
          </div>
        )}
        <div className="flex justify-between gap-3 p-3">
          <span className="text-ih-fg-3">Algorithm</span>
          <span className="text-ih-fg-2">Ed25519</span>
        </div>
      </div>

      {/* PDF download */}
      {model.versionNumber !== undefined && (
        <>
          <button
            type="button"
            onClick={() => pdf.exportPdf(`/api/public/verify/report/${token}/pdf`, { filename: `signed-report-v${model.versionNumber}.pdf` })}
            disabled={pdf.busy}
            className="flex items-center justify-center gap-2 w-full rounded-lg border border-ih-border px-4 py-2.5 text-[13px] font-medium text-ih-fg-1 hover:bg-ih-bg-muted transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {pdfActionLabel(pdf, `Download signed v${model.versionNumber} PDF`)}
          </button>
          {pdf.error || pdf.generating ? (
            <p role="status" className="mt-2 text-[12px] leading-snug text-ih-fg-3">
              {pdf.error ?? PDF_BUSY_HINT}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

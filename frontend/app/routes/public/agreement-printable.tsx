import { useLoaderData } from "react-router";
import type { Route } from "./+types/agreement-printable";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Signed Agreement - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AgreementData {
  agreementName: string;
  bodyHtml: string;
  clientName: string | null;
  clientEmail: string;
  signatureBase64: string | null;
  signedAtUtcIso: string | null;
  envelopeId: string;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ params }: Route.LoaderArgs) {
  try {
    const res = await apiFetch(
      `/api/internal/agreement-render/${params.token}`,
    );
    const body = res.ok ? await res.json() : {};
    const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    return {
      agreement: (Object.keys(d).length > 0 ? d : null) as AgreementData | null,
      error: res.ok ? null : "Not found",
    };
  } catch {
    return { agreement: null, error: "Service unavailable" };
  }
}

/* ------------------------------------------------------------------ */
/*  Helper                                                             */
/* ------------------------------------------------------------------ */

function ensureDataUri(b64: string | null): string {
  if (!b64) return "";
  if (b64.startsWith("data:")) return b64;
  return "data:image/png;base64," + b64;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function AgreementPrintablePage() {
  const { agreement, error } = useLoaderData<typeof loader>();

  if (error || !agreement) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <p className="text-ih-fg-3">Agreement not found.</p>
      </div>
    );
  }

  const sigSrc = ensureDataUri(agreement.signatureBase64);

  return (
    <div className="min-h-screen" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif", color: "#1e293b", fontSize: 13, lineHeight: 1.6, padding: 32 }}>
      <h1 className="text-[22px] font-bold tracking-tight mb-1 text-slate-900">
        {agreement.agreementName}
      </h1>
      <div className="text-[10px] text-ih-fg-3 font-mono mb-6">
        Envelope ID: {agreement.envelopeId}
      </div>

      {/* Agreement body */}
      <div
        className="text-[13px] leading-[1.7] [&_p]:mb-3 [&_strong]:font-semibold [&_ol]:pl-6 [&_ul]:pl-6 [&_ol]:mb-3 [&_ul]:mb-3"
        dangerouslySetInnerHTML={{ __html: agreement.bodyHtml }}
      />

      {/* Signature block */}
      <div className="mt-12 pt-6 border-t border-slate-200">
        <div className="text-[10px] font-bold uppercase tracking-wide text-ih-fg-3 mb-3">
          Signed by
        </div>
        <div className="flex items-end gap-8">
          <div className="flex-1">
            {sigSrc ? (
              <img
                src={sigSrc}
                alt="Signature"
                className="h-20 max-w-[240px] border-b border-slate-400 block mb-1.5"
              />
            ) : (
              <div className="h-20 max-w-[240px] bg-slate-50 border-b border-slate-400 mb-1.5" />
            )}
            <div className="text-[13px] font-semibold text-slate-900">
              {agreement.clientName ?? agreement.clientEmail}
            </div>
            <div className="text-[10px] text-ih-fg-3 font-mono">
              {agreement.clientEmail}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-ih-fg-3 mb-1">
              Date signed (UTC)
            </div>
            <div className="text-[13px] font-semibold text-slate-900">
              {agreement.signedAtUtcIso ?? "--"}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-12 pt-4 border-t border-slate-200 text-[9px] text-slate-400 font-mono">
        This document constitutes a binding electronic agreement under the United States
        Electronic Signatures in Global and National Commerce Act (15 U.S.C. section 7001 et seq.)
        and the Uniform Electronic Transactions Act (UETA). Independent verification: see
        Certificate of Completion.
      </div>
    </div>
  );
}

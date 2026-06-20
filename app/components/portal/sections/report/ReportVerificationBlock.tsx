/**
 * <ReportVerificationBlock> — the "Verified Document" panel (QR + verify URL +
 * integrity hash) shown for published, signed reports.
 *
 * Extracted from <ReportView>'s former inline IIFE. Behavior-preserving: the
 * markup is byte-identical and the show/url/hash derivation still flows through
 * the pure `verificationBlockModel` helper.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { verificationBlockModel, formatUnixSeconds } from "~/lib/report-helpers";
import { qrToSvg } from "../../../../../server/lib/qr";
import type { ReportVerification } from "./types";

export interface ReportVerificationBlockProps {
  verification: ReportVerification | null;
  baseUrl: string;
}

export function ReportVerificationBlock({ verification, baseUrl }: ReportVerificationBlockProps) {
  const vb = verificationBlockModel({ verification }, baseUrl);
  if (!vb.show) return null;
  let qrSvg: string | null = null;
  try {
    qrSvg = qrToSvg(vb.verifyUrl, { margin: 1, width: 120 });
  } catch {
    qrSvg = null;
  }
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 mb-8">
      <div className="border border-ih-border rounded-xl p-6 bg-ih-bg-card">
        <div className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-4">
          Verified Document
        </div>
        <div className="flex flex-col sm:flex-row items-start gap-6">
          {qrSvg && (
            <div
              className="shrink-0 border border-ih-border rounded-lg overflow-hidden"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: server-generated SVG from qrToSvg — no user input
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          )}
          <div className="text-sm space-y-1.5">
            <div className="font-semibold text-ih-fg-1">
              Published &amp; signed — version v{vb.versionNumber}
              <span className="text-ih-fg-4 font-normal"> · {formatUnixSeconds(vb.publishedAt)}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mr-2">Verify at</span>
              <a
                href={vb.verifyUrl}
                className="text-ih-primary underline text-xs break-all"
                target="_blank"
                rel="noreferrer"
              >
                {vb.verifyUrl}
              </a>
            </div>
            <div className="text-xs text-ih-fg-4 font-mono">
              Integrity hash: {vb.shortHash}&hellip;
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

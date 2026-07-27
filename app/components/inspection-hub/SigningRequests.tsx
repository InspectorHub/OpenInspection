import { useState } from "react";
import { Pill, Button } from "@core/shared-ui";
import { RequestDetail } from "~/components/agreements/RequestDetail";
import { pillToneFor, pillLabelFor } from "~/components/agreements/agreements-helpers";
import { formatInspectionDateTime } from "~/lib/format-date";
import { m } from "~/paraglide/messages";

/**
 * IA-65 — the inspection's signing requests, on the inspection.
 *
 * A signing request is a live workflow instance: it has a state, an outstanding
 * party, and a chase action. It used to be listed on `/library/agreements`
 * beside the reusable templates, which meant answering "has this one been
 * signed yet?" started by leaving the inspection and finding it again in a
 * tenant-wide table. Templates stayed in the Library; this moved here.
 *
 * Capability, not page: remind / copy-link are owner-manager only on the server
 * (`requireRole` on the admin envelope routes) while the evidence downloads and
 * the pre-sign are open to inspectors too. `canManageSigners` mirrors the first
 * gate so an inspector is never offered a control the API would refuse.
 */

export interface HubAgreementRequest {
  id: string;
  status: string;
  clientEmail: string;
  signedAt: string | null;
  createdAt: string | null;
  agreementName: string | null;
  signersTotal: number;
  signersSigned: number;
}

function ProgressBadge({ req }: { req: HubAgreementRequest }) {
  if (req.signersTotal <= 0) return null;
  return (
    <Pill tone={req.signersSigned >= req.signersTotal ? "sat" : "gen"}>
      {m.agreement_progress_signed({ signed: req.signersSigned, total: req.signersTotal })}
    </Pill>
  );
}

function EvidenceLinks({ id }: { id: string }) {
  const cls = "text-[12px] text-ih-primary hover:opacity-80 font-semibold";
  return (
    <div className="flex flex-wrap gap-3">
      <a className={cls} href={`/api/admin/agreement-requests/${id}/pdf`} target="_blank" rel="noopener noreferrer">
        {m.agreement_request_signed_pdf()}
      </a>
      <a className={cls} href={`/api/admin/agreement-requests/${id}/certificate.pdf`} target="_blank" rel="noopener noreferrer">
        {m.agreement_request_certificate()}
      </a>
      <a
        className={cls}
        href={`/api/admin/agreement-requests/${id}/evidence.zip`}
        download={`evidence-${id.slice(0, 8)}.zip`}
        rel="noopener noreferrer"
      >
        {m.agreement_request_evidence_pack()}
      </a>
    </div>
  );
}

export function SigningRequests({
  requests,
  canManageSigners,
  displayTz,
  onSend,
  onPreSign,
}: {
  requests: HubAgreementRequest[];
  canManageSigners: boolean;
  displayTz: string;
  onSend: () => void;
  /** Inspector pre-sign, offered only while the envelope is still pending. */
  onPreSign: (requestId: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <>
      {requests.length > 0 ? (
        <div className="divide-y divide-ih-border mb-3">
          {requests.map((req) => {
            const expanded = expandedId === req.id;
            const when = req.signedAt || req.createdAt;
            return (
              <div key={req.id} className="py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold text-ih-fg-1 truncate">
                        {req.agreementName || m.agreement_row_untitled()}
                      </span>
                      <Pill tone={pillToneFor(req.status)}>{pillLabelFor(req.status)}</Pill>
                      <ProgressBadge req={req} />
                    </div>
                    <div className="text-[12px] text-ih-fg-3 mt-0.5 truncate">
                      {req.clientEmail}
                      {when && <> &middot; {formatInspectionDateTime(when, undefined, displayTz)}</>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {req.status === "pending" && (
                      <button
                        type="button"
                        className="text-[12px] text-ih-primary hover:opacity-80 font-semibold"
                        onClick={() => onPreSign(req.id)}
                      >
                        {m.agreement_request_sign_now()}
                      </button>
                    )}
                    {canManageSigners && (
                      <button
                        type="button"
                        className="text-[12px] text-ih-primary hover:opacity-80 font-semibold"
                        onClick={() => setExpandedId((cur) => (cur === req.id ? null : req.id))}
                        aria-expanded={expanded}
                      >
                        {expanded ? m.agreement_request_hide() : m.agreement_request_view_signers()}
                      </button>
                    )}
                  </div>
                </div>

                {req.status === "signed" && (
                  <div className="mt-2">
                    <EvidenceLinks id={req.id} />
                  </div>
                )}

                {/* Mounted only while expanded: RequestDetail loads its signers
                    on mount, so keeping every row mounted would fan out one
                    request per envelope on every page view. */}
                {expanded && canManageSigners && (
                  <div className="mt-2 rounded-md bg-ih-bg-muted/40 px-3">
                    <RequestDetail requestId={req.id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[12px] text-ih-fg-3 mb-3">{m.inspections_hub_agreement_empty()}</p>
      )}
      <Button variant="secondary" size="sm" onClick={onSend}>
        {m.inspections_hub_agreement_send()}
      </Button>
    </>
  );
}

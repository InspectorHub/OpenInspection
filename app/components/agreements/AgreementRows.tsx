import { Pill } from "@core/shared-ui";
import { RequestDetail } from "~/components/agreements/RequestDetail";
import { pillToneFor, pillLabelFor, type RequestRow as RequestRowData } from "~/components/agreements/agreements-helpers";
import { m } from "~/paraglide/messages";

/** Per-envelope progress chip, e.g. "1/2 signed". Hidden for 0-signer rows. */
function ProgressBadge({ row }: { row: RequestRowData }) {
  const total = row.signersTotal ?? 0;
  if (total <= 0) return null;
  const signed = row.signersSigned ?? 0;
  return (
    <Pill tone={signed >= total ? "sat" : "gen"}>
      {m.agreement_progress_signed({ signed, total })}
    </Pill>
  );
}

export function TemplateRow({ t }: { t: { id: string; name?: string; updatedAt?: string; createdAt?: string } }) {
  return (
    <tr key={t.id} className="hover:bg-ih-bg-muted/50 transition-colors">
                      <td className="px-4 py-3 text-[13px] font-semibold text-ih-fg-1">
                        {t.name || m.agreement_row_untitled()}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-ih-fg-3">
                        {t.updatedAt || t.createdAt || "--"}
                      </td>
                      <td className="px-4 py-3">
                        <Pill tone="sat">{m.agreement_template_status_active()}</Pill>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button className="text-[13px] text-ih-primary hover:opacity-80 font-semibold">{m.common_edit()}</button>
                      </td>
                    </tr>
  );
}

export function RequestRow({
  r,
  expandedId,
  setExpandedId,
  setSigningId,
}: {
  r: RequestRowData;
  expandedId: string | null;
  setExpandedId: (fn: (cur: string | null) => string | null) => void;
  setSigningId: (id: string | null) => void;
}) {
  return (
    <>
                      <tr
                        key={r.id}
                        className="hover:bg-ih-bg-muted/50 transition-colors cursor-pointer"
                        onClick={() => setExpandedId((cur) => (cur === r.id ? null : r.id))}
                      >
                        <td className="px-4 py-3 text-[13px] font-semibold text-ih-fg-1">
                          {r.agreementName || m.agreement_row_untitled()}
                        </td>
                        <td className="px-4 py-3 text-[13px] text-ih-fg-3">
                          {r.clientName || r.clientEmail || "--"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Pill tone={pillToneFor(r.status)}>{pillLabelFor(r.status)}</Pill>
                            <ProgressBadge row={r} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {r.status === "signed" ? (
                            <div className="flex justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                              <a
                                className="text-[13px] text-ih-primary hover:opacity-80 font-semibold"
                                href={`/api/admin/agreement-requests/${r.id}/pdf`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {m.agreement_request_signed_pdf()}
                              </a>
                              <a
                                className="text-[13px] text-ih-primary hover:opacity-80 font-semibold"
                                href={`/api/admin/agreement-requests/${r.id}/certificate.pdf`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {m.agreement_request_certificate()}
                              </a>
                              <a
                                className="text-[13px] text-ih-primary hover:opacity-80 font-semibold"
                                href={`/api/admin/agreement-requests/${r.id}/evidence.zip`}
                                download={`evidence-${r.id.slice(0, 8)}.zip`}
                                rel="noopener noreferrer"
                              >
                                {m.agreement_request_evidence_pack()}
                              </a>
                            </div>
                          ) : r.status === "pending" ? (
                            <button
                              className="text-[13px] text-ih-primary hover:opacity-80 font-semibold"
                              onClick={(e) => { e.stopPropagation(); setSigningId(r.id); }}
                            >
                              {m.agreement_request_sign_now()}
                            </button>
                          ) : (
                            <span className="text-[13px] text-ih-fg-3">
                              {expandedId === r.id ? m.agreement_request_hide() : m.agreement_request_view_signers()}
                            </span>
                          )}
                        </td>
                      </tr>
                      {expandedId === r.id && (
                        <tr key={`${r.id}-detail`}>
                          <td colSpan={4} className="p-0">
                            <RequestDetail requestId={r.id} />
                          </td>
                        </tr>
                      )}
                    </>
  );
}

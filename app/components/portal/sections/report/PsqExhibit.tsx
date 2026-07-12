import type { PsqView } from "./types";

/**
 * Commercial PCA Phase M — Appendix E, the Property Suitability Questionnaire
 * exhibit. Renders the questionnaire responses as a definition list, or a
 * "declined" note (pointing to the Deviations section, since a declined PSQ
 * is itself a deviation from the Guide) when the respondent declined to
 * answer. Renders nothing when there is no PSQ on this report (light/
 * residential reports).
 */
export function PsqExhibit({ psq }: { psq: PsqView | null }) {
  if (psq == null) return null;
  return (
    <section data-pca-psq className="mb-5 print:break-inside-avoid">
      <h3 className="mb-1 text-sm font-semibold text-ih-fg-2">Appendix E — Property Suitability Questionnaire</h3>
      {psq.status === "declined" ? (
        <p className="text-sm text-ih-fg-3">PSQ declined — see Deviations.</p>
      ) : psq.responses && Object.keys(psq.responses).length > 0 ? (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm text-ih-fg-1">
          {Object.entries(psq.responses).map(([question, answer]) => (
            <div key={question} className="contents">
              <dt className="font-medium text-ih-fg-2">{question}</dt>
              <dd>{String(answer)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-ih-fg-3">PSQ sent — response pending.</p>
      )}
    </section>
  );
}

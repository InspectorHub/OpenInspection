import type { DocReviewView } from "./types";

/**
 * Commercial PCA Phase M — the §4 Document Review & Interviews checklist.
 * Renders every requested document (never drops a row, even when it wasn't
 * provided — ASTM E2018 requires the limitation to be disclosed, not
 * silently omitted). Items requested but neither received nor marked N/A
 * are flagged as a scope limitation. Renders nothing when there are no
 * document-review items (light/residential reports).
 */
export function DocumentReviewTable({ items }: { items: DocReviewView[] }) {
  if (!items.length) return null;
  return (
    <table data-pca-document-review className="mb-5 w-full border-collapse text-sm print:break-inside-avoid">
      <thead>
        <tr className="border-b border-ih-border text-left text-ih-fg-3">
          <th className="py-2 pr-4 font-medium">Document</th>
          <th className="py-2 pr-4 font-medium">Status</th>
          <th className="py-2 font-medium">Notes</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const notProvided = item.requested && !item.received && !item.na;
          const status = item.na
            ? "Not applicable"
            : item.received
              ? item.reviewed
                ? "Received & reviewed"
                : "Received"
              : item.requested
                ? "Requested"
                : "Not requested";
          return (
            <tr key={item.documentKey} className="border-b border-ih-border last:border-0 text-ih-fg-1">
              <td className="py-2 pr-4">{item.label}</td>
              <td className="py-2 pr-4">
                {status}
                {notProvided ? (
                  <span className="ml-2 rounded bg-ih-bad-bg px-2 py-0.5 text-xs font-medium text-ih-bad-fg">
                    not provided (limitation)
                  </span>
                ) : null}
              </td>
              <td className="py-2 text-ih-fg-3">{item.notes ?? ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

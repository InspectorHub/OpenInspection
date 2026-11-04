import { useState } from "react";
import { verifyEvidenceZip } from "~/lib/evidence-zip-verify";
import type { ChainProblem } from "../../../server/lib/esign/chain-verify";
import { m } from "~/paraglide/messages";

interface VerificationResult {
  outcome: "valid" | "invalid" | "partial";
  errors: string[];
  eventCount: number;
  fingerprints: string[];
}

/** One plain line per problem. A missing key is described as exactly that, never as a bad signature. */
function describe(problem: ChainProblem): string {
  const event = problem.eventId ?? "";
  switch (problem.reason) {
    case "hash": return m.report_verify_offline_problem_hash({ event });
    case "signature": return m.report_verify_offline_problem_signature({ event });
    case "no_key": return m.report_verify_offline_problem_no_key({ event, key: problem.detail ?? "" });
    case "bad_key": return m.report_verify_offline_problem_bad_key({ detail: problem.detail ?? "" });
    case "key_mismatch": return m.report_verify_offline_problem_key_mismatch({ key: problem.detail ?? "" });
    case "fork": return m.report_verify_offline_problem_fork({ event });
    case "chain": return m.report_verify_offline_problem_chain({ event });
    case "empty": return m.report_verify_offline_problem_empty();
  }
}

const unreadable = (message: string): VerificationResult => ({ outcome: "invalid", errors: [message], eventCount: 0, fingerprints: [] });

export function meta() {
  return [{ title: m.report_verify_offline_meta_title() }];
}

export default function VerifyOffline() {
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    setBusy(true);
    setResult(null);
    try {
      if (!file.name.toLowerCase().endsWith(".zip")) {
        setResult(unreadable(m.report_verify_offline_error_not_zip()));
        return;
      }
      const verdict = await verifyEvidenceZip(new Uint8Array(await file.arrayBuffer()));
      if (verdict.unreadable === "not_zip") setResult(unreadable(m.report_verify_offline_error_not_zip()));
      else if (verdict.unreadable === "missing_files") setResult(unreadable(m.report_verify_offline_error_missing_files()));
      else if (verdict.unreadable === "bad_trail") setResult(unreadable(m.report_verify_offline_error_bad_trail()));
      else if (verdict.unreadable === "too_large") setResult(unreadable(m.report_verify_offline_error_too_large()));
      else setResult({ outcome: verdict.outcome, errors: verdict.problems.map(describe), eventCount: verdict.eventCount, fingerprints: verdict.fingerprints });
    } catch {
      setResult(unreadable(m.report_verify_offline_error_unexpected()));
    } finally {
      setBusy(false);
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) await handleFile(file);
  };

  const onSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await handleFile(file);
  };

  return (
    <main className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold">{m.report_verify_offline_heading()}</h1>
      <p className="mt-2 text-sm text-ih-fg-3">
        {m.report_verify_offline_intro_before()}<code className="bg-ih-bg-muted px-1 rounded">evidence.zip</code>{m.report_verify_offline_intro_after()}
      </p>
      <label
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        className="mt-6 block border-2 border-dashed border-ih-border rounded-lg p-12 text-center cursor-pointer hover:bg-ih-bg-muted/50"
      >
        <span className="block text-sm">{m.report_verify_offline_dropzone()}</span>
        <input type="file" accept=".zip,application/zip" onChange={onSelect} className="hidden" />
      </label>
      {busy && <p className="mt-4 text-sm text-ih-fg-3">{m.report_verify_offline_verifying()}</p>}
      {result && (
        <div
          className={
            "mt-6 p-4 rounded " +
            (result.outcome === "valid" ? "bg-ih-ok-bg border border-ih-ok"
              : result.outcome === "partial" ? "bg-ih-watch-bg border border-ih-watch"
                : "bg-ih-bad-bg border border-ih-bad")
          }
        >
          <p className="font-semibold">
            {result.outcome === "valid"
              ? m.report_verify_offline_result_valid({ count: result.eventCount })
              : result.outcome === "partial"
                ? m.report_verify_offline_result_partial({ count: result.errors.length })
                : m.report_verify_offline_result_invalid({ count: result.errors.length })}
          </p>
          {result.outcome === "valid" && result.fingerprints.length > 0 && (
            <p className="font-semibold mt-1 break-all">
              {m.report_verify_offline_result_valid_compare({ fingerprints: result.fingerprints.join(", ") })}
            </p>
          )}
          {result.errors.map((err, i) => (
            <p key={i} className="text-sm mt-1">
              {err}
            </p>
          ))}
          {result.outcome !== "valid" && result.fingerprints.length > 0 && (
            <p className="text-xs mt-3 break-all">
              {m.report_verify_offline_fingerprints({ fingerprints: result.fingerprints.join(", ") })}
            </p>
          )}
        </div>
      )}
      <p className="mt-12 text-xs text-ih-fg-3">
        {m.report_verify_offline_footer()}
      </p>
      <p className="mt-2 text-xs text-ih-fg-3">
        {m.report_verify_offline_footer_truncation()}
      </p>
    </main>
  );
}

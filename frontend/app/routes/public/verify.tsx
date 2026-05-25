import { useLoaderData } from "react-router";
import type { Route } from "./+types/verify";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Verify Signature - OpenInspection" }];
}

interface VerifyData {
  valid: boolean;
  envelopeId: string;
  signedAt: string;
  signerName: string;
  documentTitle: string;
  auditTrail: { action: string; timestamp: string; actor: string }[];
}

export async function loader({ params }: Route.LoaderArgs) {
  try {
    const res = await apiFetch(
      `/api/public/verify/${params.envelopeId}`,
    );
    const json = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
    return {
      result: (json.data as VerifyData) ?? null,
      error: res.ok ? null : "Verification failed",
    };
  } catch {
    return { result: null, error: "Service unavailable" };
  }
}

export default function VerifyPage() {
  const { result, error } = useLoaderData<typeof loader>();

  if (error || !result) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold">Verification Failed</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2">
          {error ?? "Unable to verify this signature."}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto p-6">
      {/* Verification result */}
      <div
        className={`p-4 rounded-lg text-center mb-6 ${
          result.valid
            ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400"
            : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
        }`}
      >
        <p className="text-lg font-bold">
          {result.valid ? "Signature Verified" : "Invalid Signature"}
        </p>
        <p className="text-[13px] mt-1">
          {result.documentTitle} &middot; signed by {result.signerName} on{" "}
          {result.signedAt}
        </p>
      </div>

      {/* Audit trail */}
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
        Audit Trail
      </h2>
      <div className="space-y-2">
        {result.auditTrail.map((entry, i) => (
          <div
            key={i}
            className="flex items-start gap-3 text-[13px] p-3 rounded-lg border border-slate-200 dark:border-slate-700"
          >
            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500 mt-1.5" />
            <div>
              <p className="font-medium">{entry.action}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {entry.actor} &middot; {entry.timestamp}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

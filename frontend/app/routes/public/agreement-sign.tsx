import { useLoaderData } from "react-router";
import type { Route } from "./+types/agreement-sign";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Sign Agreement - OpenInspection" }];
}

interface AgreementData {
  title: string;
  body: string;
  clientName: string | null;
  inspectorName: string;
  signedAt: string | null;
}

export async function loader({ params }: Route.LoaderArgs) {
  try {
    const res = await apiFetch(
      `/api/public/agreements/sign/${params.tenant}/${params.token}`,
    );
    const json = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
    return {
      agreement: (json.data as AgreementData) ?? null,
      error: res.ok ? null : "Agreement not found",
    };
  } catch {
    return { agreement: null, error: "Service unavailable" };
  }
}

export default function AgreementSignPage() {
  const { agreement, error } = useLoaderData<typeof loader>();

  if (error || !agreement) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold">Agreement Not Found</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2">
          {error ?? "This agreement link is invalid or expired."}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-xl font-bold mb-1">{agreement.title}</h1>
      <p className="text-[13px] text-slate-500 dark:text-slate-400 mb-6">
        From {agreement.inspectorName}
        {agreement.clientName && <span> to {agreement.clientName}</span>}
      </p>

      {/* Agreement body */}
      <div className="prose prose-sm dark:prose-invert max-w-none mb-8 p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
        <div dangerouslySetInnerHTML={{ __html: agreement.body }} />
      </div>

      {agreement.signedAt ? (
        <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-[13px] font-medium text-center">
          Signed on {agreement.signedAt}
        </div>
      ) : (
        <>
          {/* Signature pad placeholder */}
          <div className="h-32 mb-4 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center text-[13px] text-slate-400 dark:text-slate-500">
            Signature pad will be rendered here
          </div>
          <button
            type="button"
            className="w-full h-10 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 transition-colors"
          >
            Sign Agreement
          </button>
        </>
      )}
    </div>
  );
}

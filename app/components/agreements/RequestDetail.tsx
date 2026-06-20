import { useEffect } from "react";
import { useFetcher } from "react-router";
import { SignerList, type SignerRow } from "~/components/agreements/SignerList";
import type { action } from "~/routes/agreements";

/** Expandable per-request signer detail — mounts the shared SignerList. */
export function RequestDetail({ requestId }: { requestId: string }) {
  const loadFetcher = useFetcher<typeof action>();
  // Separate fetchers per competing mutation (RR rule: shared fetcher aborts in-flight).
  const remindFetcher = useFetcher<typeof action>();
  const copyFetcher = useFetcher<typeof action>();

  useEffect(() => {
    loadFetcher.submit({ intent: "load-signers", requestId }, { method: "post" });
    // Intentional: loadFetcher is omitted from deps — its identity is unstable
    // (a new ref every render from useFetcher); submit is keyed on requestId only.
    // react-hooks/exhaustive-deps is not wired in this project's ESLint config.
  }, [requestId]);

  // Reload signers after a successful reminder (lastRemindedAt changed).
  useEffect(() => {
    if (remindFetcher.data?.ok && remindFetcher.data.intent === "remind") {
      loadFetcher.submit({ intent: "load-signers", requestId }, { method: "post" });
    }
    // Intentional: loadFetcher is omitted from deps — its identity is unstable
    // (a new ref every render); re-fetch is keyed on remindFetcher.data + requestId.
    // react-hooks/exhaustive-deps is not wired in this project's ESLint config.
  }, [remindFetcher.data, requestId]);

  const signers = (loadFetcher.data?.ok && loadFetcher.data.intent === "load-signers"
    ? loadFetcher.data.signers
    : []) as SignerRow[];

  if (loadFetcher.state !== "idle" && signers.length === 0) {
    return <div className="px-4 py-3 text-[13px] text-ih-fg-3">Loading signers…</div>;
  }

  // Remind is fire-and-forget through its own fetcher; the result (including a
  // 429/409 friendly message) renders as an inline banner, never an alert.
  const onRemind = (signerId: string) => {
    remindFetcher.submit({ intent: "remind", requestId, signerId }, { method: "post" });
  };

  // Copy-link resolves the persistent URL via its own fetcher, then SignerList
  // writes it to the clipboard. We await the fetcher settling for THIS signer.
  const onCopyLink = (signerId: string) =>
    new Promise<string>((resolve, reject) => {
      copyFetcher.submit({ intent: "copy-link", requestId, signerId }, { method: "post" });
      const started = Date.now();
      const poll = () => {
        const data = copyFetcher.data;
        if (data && data.intent === "copy-link" && data.signerId === signerId && copyFetcher.state === "idle") {
          if (data.ok && "url" in data && data.url) return resolve(data.url);
          return reject(new Error(!data.ok && "error" in data ? data.error : "Could not get link."));
        }
        if (Date.now() - started > 6000) return reject(new Error("Timed out fetching link."));
        setTimeout(poll, 120);
      };
      poll();
    });

  const remindError =
    remindFetcher.data && !remindFetcher.data.ok && remindFetcher.data.intent === "remind"
      ? remindFetcher.data.error
      : null;

  return (
    <div className="px-4 py-3 bg-ih-bg-muted/40">
      {remindError && <p className="text-[12px] text-ih-bad-fg mb-2">{remindError}</p>}
      <SignerList signers={signers} onRemind={onRemind} onCopyLink={onCopyLink} />
    </div>
  );
}

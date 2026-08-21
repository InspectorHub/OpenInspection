import { useEffect } from "react";
import { useFetcher } from "react-router";
import { SignerList, type SignerRow } from "~/components/agreements/SignerList";
import type { action } from "~/routes/resources/agreement-signers";
import { AGREEMENT_SIGNERS_ACTION } from "~/routes/resources/agreement-signers";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { m } from "~/paraglide/messages";

/**
 * Expandable per-request signer detail — mounts the shared SignerList.
 *
 * IA-65 — posts to the dedicated resource route rather than to whichever page
 * happens to host it, so the inspection workspace and the Library both mount
 * the same component instead of each carrying their own copy of the wiring.
 */
export function RequestDetail({ requestId }: { requestId: string }) {
  const loadFetcher = useFetcher<typeof action>();
  // Separate fetchers per competing mutation (RR rule: shared fetcher aborts in-flight).
  // #106 - a reminder sends a real email to a real signer. The two load
  // fetchers around it stay raw: they are selects, not writes.
  // submit-guard-allow-no-busy: the row swaps to a "sent" state on the reply.
  const { fetcher: remindFetcher, submit: submitRemind } = useGuardedSubmit<typeof action>();
  const copyFetcher = useFetcher<typeof action>();
  const post = { method: "post", action: AGREEMENT_SIGNERS_ACTION } as const;

  useEffect(() => {
    loadFetcher.submit({ intent: "load-signers", requestId }, post);
    // Intentional: loadFetcher is omitted from deps — its identity is unstable
    // (a new ref every render from useFetcher); submit is keyed on requestId only.
    // react-hooks/exhaustive-deps is not wired in this project's ESLint config.
  }, [requestId]);

  // Reload signers after a successful reminder (lastRemindedAt changed).
  useEffect(() => {
    if (remindFetcher.data?.ok && remindFetcher.data.intent === "remind") {
      loadFetcher.submit({ intent: "load-signers", requestId }, post);
    }
    // Intentional: loadFetcher is omitted from deps — its identity is unstable
    // (a new ref every render); re-fetch is keyed on remindFetcher.data + requestId.
    // react-hooks/exhaustive-deps is not wired in this project's ESLint config.
  }, [remindFetcher.data, requestId]);

  const signers = (loadFetcher.data?.ok && loadFetcher.data.intent === "load-signers"
    ? loadFetcher.data.signers
    : []) as SignerRow[];

  if (loadFetcher.state !== "idle" && signers.length === 0) {
    return <div className="px-4 py-3 text-[13px] text-ih-fg-3">{m.agreement_detail_loading()}</div>;
  }

  // Remind is fire-and-forget through its own fetcher; the result (including a
  // 429/409 friendly message) renders as an inline banner, never an alert.
  const onRemind = (signerId: string) => {
    submitRemind({ intent: "remind", requestId, signerId }, post);
  };

  // Copy-link resolves the persistent URL via its own fetcher, then SignerList
  // writes it to the clipboard. We await the fetcher settling for THIS signer.
  const onCopyLink = (signerId: string) =>
    new Promise<string>((resolve, reject) => {
      copyFetcher.submit({ intent: "copy-link", requestId, signerId }, post);
      const started = Date.now();
      const poll = () => {
        const data = copyFetcher.data;
        if (data && data.intent === "copy-link" && data.signerId === signerId && copyFetcher.state === "idle") {
          if (data.ok && "url" in data && data.url) return resolve(data.url);
          return reject(new Error(!data.ok && "error" in data ? data.error : m.agreement_detail_error_no_link()));
        }
        if (Date.now() - started > 6000) return reject(new Error(m.agreement_detail_error_timeout()));
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

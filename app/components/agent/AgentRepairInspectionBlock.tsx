/**
 * <AgentRepairInspectionBlock> — one inspection's repair items on the agent
 * page, plus its delivery outlet.
 *
 * Delivery is per-inspection because the `repair_requests` / shareToken channel
 * is: one list belongs to one inspection. The agent page is an aggregate across
 * properties, so the action lives on the block, never on the page — a single
 * "share everything" button could only be built by inventing a second share
 * mechanism.
 *
 * Each block owns its OWN fetchers: two blocks shared one fetcher would cancel
 * each other's in-flight submit (see reference_rr_shared_fetcher_abort).
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { useState } from "react";
import { useFetcher } from "react-router";
import { RepairDefectRowView, type RepairDefectPhoto } from "~/components/portal/sections/repair/RepairDefectRowView";
import { RepairSharePanel } from "~/components/portal/sections/repair/RepairSharePanel";
import { agentMayWriteRepairList, type AgentRepairAccess } from "~/lib/agent-repair-access";
import { m } from "~/paraglide/messages";

export interface AgentRepairRow {
  inspectionId: string;
  /** This company's policy for agents on its repair list (IA-35). */
  repairAccess: AgentRepairAccess;
  sectionTitle: string;
  itemLabel: string;
  defectTitle: string;
  location: string | null;
  comment: string | null;
  category: string;
  isCustom: boolean;
  photos: string[];
}

interface ShareResult {
  ok?: boolean;
  error?: string;
  shareToken?: string;
}

export interface AgentRepairInspectionBlockProps {
  inspectionId: string;
  tenantName: string;
  tenantSlug: string;
  /** This company's policy for agents on its repair list (IA-35). */
  repairAccess: AgentRepairAccess;
  rows: AgentRepairRow[];
  photosFor: (row: AgentRepairRow) => RepairDefectPhoto[];
}

export function AgentRepairInspectionBlock({
  inspectionId,
  tenantName,
  tenantSlug,
  repairAccess,
  rows,
  photosFor,
}: AgentRepairInspectionBlockProps) {
  const shareFetcher = useFetcher<ShareResult>();
  const emailFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [copyLabel, setCopyLabel] = useState(m.portal_repair_copy_share());
  const [emailTo, setEmailTo] = useState("");
  const [emailMsg, setEmailMsg] = useState("");

  const shareToken = shareFetcher.data?.shareToken ?? null;
  const shareUrl = shareToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/repair-request/${shareToken}`
    : null;

  const share = () => {
    const fd = new FormData();
    fd.append("_intent", "share");
    fd.append("inspectionId", inspectionId);
    fd.append("tenantSlug", tenantSlug);
    shareFetcher.submit(fd, { method: "post" });
  };

  const copyShareLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyLabel(m.portal_repair_copied());
      setTimeout(() => setCopyLabel(m.portal_repair_copy_share()), 2000);
    } catch {
      setCopyLabel(m.portal_repair_copy_failed());
    }
  };

  const sendEmail = () => {
    if (!emailTo || !shareToken) return;
    const fd = new FormData();
    fd.append("_intent", "send-email");
    fd.append("shareToken", shareToken);
    fd.append("to", emailTo);
    if (emailMsg) fd.append("message", emailMsg);
    emailFetcher.submit(fd, { method: "post" });
  };

  return (
    <div data-testid={`repair-inspection-${inspectionId}`} className="p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold text-ih-fg-3 uppercase tracking-widest">{tenantName}</p>
        {/* Sharing creates a repair_requests row, which the API refuses under
            `read` and `off` — so the action only exists where it can succeed. */}
        {!shareToken && agentMayWriteRepairList(repairAccess) && (
          <button
            type="button"
            data-testid={`repair-share-${inspectionId}`}
            onClick={share}
            disabled={shareFetcher.state !== "idle"}
            className="h-8 px-3 rounded-md border border-ih-border text-[12px] font-semibold text-ih-fg-3 hover:bg-ih-bg-muted transition-colors disabled:opacity-60"
          >
            {shareFetcher.state === "idle"
              ? m.agent_portal_repair_share_action()
              : m.agent_portal_repair_share_pending()}
          </button>
        )}
      </div>

      {shareFetcher.data?.error && (
        <p className="text-[12px] text-ih-bad-fg">{shareFetcher.data.error}</p>
      )}

      {rows.map((row, i) => (
        <div
          key={`${row.inspectionId}-${row.defectTitle}-${i}`}
          data-testid={`repair-row-${inspectionId}-${i}`}
          className="flex items-start gap-3 p-4 border border-ih-border rounded-md bg-ih-bg-app/30"
        >
          <RepairDefectRowView
            sectionTitle={row.sectionTitle}
            itemLabel={row.itemLabel}
            defectTitle={row.defectTitle}
            location={row.location}
            comment={row.comment}
            category={row.category}
            isCustom={row.isCustom}
            photos={photosFor(row)}
          />
        </div>
      ))}

      {shareToken && (
        <RepairSharePanel
          shareToken={shareToken}
          shareUrl={shareUrl}
          copyLabel={copyLabel}
          emailTo={emailTo}
          emailMsg={emailMsg}
          emailSent={emailFetcher.data?.ok === true}
          emailSubmitting={emailFetcher.state === "submitting"}
          emailError={emailFetcher.data?.error}
          onCopyShareLink={copyShareLink}
          onEmailToChange={setEmailTo}
          onEmailMsgChange={setEmailMsg}
          onSendEmail={sendEmail}
        />
      )}
    </div>
  );
}

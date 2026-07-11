import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Modal, Button } from "@core/shared-ui";
import type { Severity } from "~/lib/severity";
import { SEVERITIES, SEVERITY_LABEL } from "~/lib/severity";
import { MoneyInput } from "~/components/MoneyInput";

export interface CommentEditorProps {
  open: boolean;
  onClose: () => void;
  /** null = create; otherwise edit */
  comment?: {
    id: string; text: string; section?: string | null; itemLabel?: string | null;
    severity?: Severity | null; repairSummary?: string | null;
    estimateMinCents?: number | null; estimateMaxCents?: number | null;
    recommendedContractorTypeId?: string | null;
  } | null;
  contractorTypes?: Array<{ id: string; name: string }>;
}

/**
 * Add/Edit modal for a canned-comment library entry (module D). Submits
 * through the `comments-library` BFF resource route (`save` for create,
 * `edit` for update — both relay to the existing admin comments API).
 * The repair fields (summary/estimate/contractor type) only make sense for a
 * defect-severity comment, so they stay hidden until `severity === 'significant'`.
 */
export function CommentEditor({ open, onClose, comment, contractorTypes = [] }: CommentEditorProps) {
  const fetcher = useFetcher<{ ok?: boolean }>();
  const editing = !!comment;
  const [text, setText] = useState("");
  const [section, setSection] = useState("");
  const [itemLabel, setItemLabel] = useState("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [repairSummary, setRepairSummary] = useState("");
  const [estimateMin, setEstimateMin] = useState("");
  const [estimateMax, setEstimateMax] = useState("");
  const [contractorTypeId, setContractorTypeId] = useState("");

  useEffect(() => {
    if (!open) return;
    setText(comment?.text ?? "");
    setSection(comment?.section ?? "");
    setItemLabel(comment?.itemLabel ?? "");
    setSeverity((comment?.severity as Severity) ?? "");
    setRepairSummary(comment?.repairSummary ?? "");
    setEstimateMin(comment?.estimateMinCents != null ? String(comment.estimateMinCents / 100) : "");
    setEstimateMax(comment?.estimateMaxCents != null ? String(comment.estimateMaxCents / 100) : "");
    setContractorTypeId(comment?.recommendedContractorTypeId ?? "");
  }, [open, comment]);

  const submittedRef = useRef(false);
  useEffect(() => {
    if (submittedRef.current && fetcher.state === "idle" && fetcher.data?.ok) {
      submittedRef.current = false;
      onClose();
    }
  }, [fetcher.state, fetcher.data, onClose]);

  const error = !text.trim() ? "Comment text is required" : null;
  const saving = fetcher.state !== "idle";
  const isDefect = severity === "significant";

  function save() {
    if (error) return;
    submittedRef.current = true;
    const toCents = (v: string) => (v.trim() ? String(Math.round(parseFloat(v) * 100)) : "");
    fetcher.submit(
      {
        intent: editing ? "edit" : "save",
        ...(editing ? { id: comment!.id } : {}),
        text: text.trim(),
        section: section.trim(),
        itemLabel: itemLabel.trim(),
        severity: severity || "",
        repairSummary: isDefect ? repairSummary.trim() : "",
        estimateMinCents: isDefect ? toCents(estimateMin) : "",
        estimateMaxCents: isDefect ? toCents(estimateMax) : "",
        recommendedContractorTypeId: isDefect ? contractorTypeId : "",
      },
      { method: "post", action: "/resources/comments-library" },
    );
  }

  const inputCls = "w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:shadow-ih-focus focus:border-ih-primary outline-none";
  const labelCls = "block text-[11px] font-bold uppercase tracking-[0.14em] text-ih-fg-4 mb-1.5";

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit comment" : "New comment"} size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving || !!error}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add comment"}
          </Button>
        </>
      }>
      <div className="space-y-4">
        <div>
          <label htmlFor="ce-text" className={labelCls}>Comment text</label>
          <textarea id="ce-text" value={text} onChange={(e) => setText(e.target.value)} rows={3}
            placeholder="Evidence of previous repair was observed."
            className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:shadow-ih-focus focus:border-ih-primary outline-none" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="ce-section" className={labelCls}>Section <span className="font-medium normal-case tracking-normal text-ih-fg-4">· optional</span></label>
            <input id="ce-section" value={section} onChange={(e) => setSection(e.target.value)} placeholder="Roof" className={inputCls} />
          </div>
          <div>
            <label htmlFor="ce-item" className={labelCls}>Item label <span className="font-medium normal-case tracking-normal text-ih-fg-4">· optional</span></label>
            <input id="ce-item" value={itemLabel} onChange={(e) => setItemLabel(e.target.value)} placeholder="Roof Covering" className={inputCls} />
          </div>
          <div>
            <label htmlFor="ce-severity" className={labelCls}>Severity</label>
            <select id="ce-severity" value={severity} onChange={(e) => setSeverity(e.target.value as Severity | "")} className={inputCls + " appearance-none"}>
              <option value="">Unclassified</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
            </select>
          </div>
        </div>

        {isDefect && (
          <div className="space-y-3 rounded-lg border border-ih-border bg-ih-bg-app/40 p-3">
            <div>
              <label htmlFor="ce-repair" className={labelCls}>Repair summary</label>
              <input id="ce-repair" value={repairSummary} onChange={(e) => setRepairSummary(e.target.value)} placeholder="Recommend licensed roofer evaluate and repair." className={inputCls} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="ce-min" className={labelCls}>Est. low</label>
                <MoneyInput id="ce-min" ariaLabel="Est. low"
                  cents={estimateMin === "" ? null : Math.round(Number(estimateMin) * 100)}
                  onChange={(c) => setEstimateMin(c == null ? "" : String(c / 100))} className={inputCls} />
              </div>
              <div>
                <label htmlFor="ce-max" className={labelCls}>Est. high</label>
                <MoneyInput id="ce-max" ariaLabel="Est. high"
                  cents={estimateMax === "" ? null : Math.round(Number(estimateMax) * 100)}
                  onChange={(c) => setEstimateMax(c == null ? "" : String(c / 100))} className={inputCls} />
              </div>
              <div>
                <label htmlFor="ce-ct" className={labelCls}>Contractor type</label>
                <select id="ce-ct" value={contractorTypeId} onChange={(e) => setContractorTypeId(e.target.value)} className={inputCls + " appearance-none"}>
                  <option value="">None</option>
                  {contractorTypes.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="px-3 py-2 rounded-lg bg-ih-bad-bg border border-ih-bad text-[12px] text-ih-bad-fg">{error}</div>
        )}
      </div>
    </Modal>
  );
}

import { Form, useNavigation } from "react-router";
import { pendingProps, PENDING_CLASS } from "@core/shared-ui";
import { useSubmitLatch } from "~/hooks/useSubmitLatch";
import { m } from "~/paraglide/messages";

export function DataExportPanel() {
  const latch = useSubmitLatch();
  const busy = useNavigation().state !== "idle";
  return (
    <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-4">
      <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_dataexport_heading()}</h3>
      <p className="text-[13px] text-ih-fg-3">
        {m.settings_dataexport_desc()}
      </p>
      <Form method="post" onSubmit={latch()}>
        <input type="hidden" name="intent" value="export-data" />
        <button type="submit" {...pendingProps(busy)}
          className={`h-9 px-4 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-2 text-[13px] font-semibold hover:bg-ih-bg-muted transition-colors ${PENDING_CLASS}`}>
          {m.settings_dataexport_button()}
        </button>
      </Form>
    </section>
  );
}

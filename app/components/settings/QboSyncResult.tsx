import { useEffect, useState } from "react";
import { Banner } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/** The count the Sync now action reports, as one short sentence. */
function syncResultLabel(processed: number): string {
  if (processed <= 0) return m.settings_qbo_sync_result_none();
  return processed === 1 ? m.settings_qbo_sync_result_one() : m.settings_qbo_sync_result_many({ count: processed });
}

/**
 * What the last Sync now found, shown for a few seconds and then gone. Takes
 * the fetcher's data as it is: anything that is not a finished sync says nothing.
 */
export function QboSyncResult({ data }: { data: { success: boolean; intent?: string | null; sync?: { processed: number } } | undefined }) {
  const processed = data?.success && data.intent === "qbo-sync" ? data.sync?.processed : undefined;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (processed === undefined) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(t);
  }, [data]);
  if (!visible || processed === undefined) return null;
  return <Banner tone="success">{syncResultLabel(processed)}</Banner>;
}

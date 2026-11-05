/** Where the report stands for the editor, read off the inspection detail payload (see `ReportPublishState`). */
export interface EditorReportState {
  publishedVersionNumber: number | null;
  editingAgain: boolean;
  readOnly: boolean;
}

/**
 * A published report opens READ-ONLY until the inspector chooses "Edit and republish", which moves it to `editingAgain`
 * without withdrawing it: clients keep reading `publishedVersionNumber` meanwhile. The server derives all three from the
 * report rows (they sit beside `inspection` in the detail payload's data), and `readOnly` is the server's own write
 * lock (`contentLocked`), not a guess from the order status: the editor is read-only exactly when a write would be refused.
 */
export function deriveReportState(data: Record<string, unknown> | undefined): EditorReportState {
  return {
    publishedVersionNumber: typeof data?.publishedVersionNumber === "number" ? data.publishedVersionNumber : null,
    editingAgain: data?.editingAgain === true,
    readOnly: data?.contentLocked === true,
  };
}

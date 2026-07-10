import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Modal, Button } from "@core/shared-ui";

export interface EditorDefectCategory {
  id: string;
  name: string;
  color: string;
  drivesSummary: boolean;
  sortOrder: number;
  isSeed?: boolean;
}

/**
 * Add/Edit modal for an account-level defect category (module K). Submits
 * through the `resources/defect-categories` BFF resource route (`save` for
 * create, `edit` for update — both relay to the admin defect-categories API).
 * Seed rows (maintenance/recommendation/safety) may have their color and
 * drivesSummary toggled here; the page hides Delete for them.
 */
export function DefectCategoryEditor({
  open,
  onClose,
  category,
}: {
  open: boolean;
  onClose: () => void;
  category?: EditorDefectCategory | null;
}) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const editing = !!category;

  const [name, setName] = useState("");
  const [color, setColor] = useState("#6b7280");
  const [drivesSummary, setDrivesSummary] = useState(true);
  const [sortOrder, setSortOrder] = useState(0);

  // Seed the form whenever the modal opens (new = blank defaults, edit = the category).
  useEffect(() => {
    if (!open) return;
    if (category) {
      setName(category.name);
      setColor(category.color);
      setDrivesSummary(category.drivesSummary);
      setSortOrder(category.sortOrder);
    } else {
      setName("");
      setColor("#6b7280");
      setDrivesSummary(true);
      setSortOrder(0);
    }
  }, [open, category]);

  const saving = fetcher.state !== "idle";
  const submittedRef = useRef(false);
  useEffect(() => {
    if (submittedRef.current && fetcher.state === "idle" && fetcher.data?.ok) {
      submittedRef.current = false;
      onClose();
    }
  }, [fetcher.state, fetcher.data, onClose]);

  const error = !name.trim() ? "Name is required" : fetcher.data?.error ?? null;

  function save() {
    if (error && error !== fetcher.data?.error) return;
    submittedRef.current = true;
    fetcher.submit(
      {
        intent: editing ? "edit" : "save",
        ...(category ? { id: category.id } : {}),
        name: name.trim(),
        color,
        drivesSummary: String(drivesSummary),
        sortOrder: String(sortOrder),
      },
      { method: "post", action: "/resources/defect-categories" },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit defect category" : "New defect category"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving || (!!error && error !== fetcher.data?.error)}>
            {saving ? "Saving…" : editing ? "Save changes" : "Create category"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          {/* Color swatch — user-picked category color (data, not a design token);
              same inline-style exemption RatingSystemEditor.tsx relies on. */}
          <label
            className="relative w-9 h-9 rounded-md shrink-0 cursor-pointer ring-1 ring-inset ring-black/10"
            style={{ backgroundColor: color }}
            title="Pick color"
          >
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer"
              aria-label="Category color"
            />
          </label>
          <div className="flex-1 min-w-0">
            <label htmlFor="defect-category-name" className="block text-[11px] font-bold uppercase tracking-[0.14em] text-ih-fg-4 mb-1.5">Name</label>
            <input
              id="defect-category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Safety"
              className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:shadow-ih-focus focus:border-ih-primary outline-none"
            />
          </div>
        </div>

        <div>
          <label htmlFor="defect-category-sort-order" className="block text-[11px] font-bold uppercase tracking-[0.14em] text-ih-fg-4 mb-1.5">Sort order</label>
          <input
            id="defect-category-sort-order"
            type="number"
            min={0}
            max={999}
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
            className="w-24 h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:shadow-ih-focus focus:border-ih-primary outline-none"
          />
        </div>

        <label className="flex items-center gap-2 text-[13px] text-ih-fg-2 select-none cursor-pointer">
          <input
            id="defect-category-drives-summary"
            type="checkbox"
            checked={drivesSummary}
            onChange={(e) => setDrivesSummary(e.target.checked)}
            className="h-4 w-4 rounded border-ih-border text-ih-primary focus:ring-ih-primary/30"
          />
          Include defects in this category in the report Summary
        </label>

        {error && (
          <div className="px-3 py-2 rounded-lg bg-ih-bad-bg border border-ih-bad text-[12px] text-ih-bad-fg">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

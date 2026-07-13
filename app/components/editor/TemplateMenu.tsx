import { useRef, useState } from "react";
import { Button, MenuItem, Popover } from "@core/shared-ui";

export interface TemplateMenuProps {
  /** Open the template picker (the inspection's applied template can be swapped). */
  onChangeTemplate: () => void;
  /** Save the current structure as a brand-new template. */
  onSaveAsNewTemplate: () => void;
  /** Write the current structure back to the inspection's source template. */
  onUpdateSourceTemplate: () => void;
  /** Whether the inspection has a source template (enables "Update source"). */
  canUpdateSource: boolean;
}

/**
 * Global (document-level) template actions, consolidated into one header menu so
 * they live with the other config actions instead of being scattered across the
 * section rail. Switch the applied template, save the current structure as a new
 * template, or write it back to the source template.
 */
export function TemplateMenu({
  onChangeTemplate,
  onSaveAsNewTemplate,
  onUpdateSourceTemplate,
  canUpdateSource,
}: TemplateMenuProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <>
      <Button
        ref={anchorRef}
        variant="secondary"
        size="md"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Template"
        className="border-none bg-transparent text-ih-fg-3 hover:bg-ih-bg-muted"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z" />
        </svg>
        <span className="hidden lg:inline">Template</span>
        <svg className="w-3 h-3 text-ih-fg-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </Button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} align="right">
        <ul role="menu" aria-label="Template actions" className="py-1 min-w-[220px]">
          <li role="none">
            <MenuItem
              data-testid="change-template-btn"
              onClick={() => run(onChangeTemplate)}
            >
              Change template…
            </MenuItem>
          </li>
          <li aria-hidden className="mx-3 my-1 border-t border-ih-border" />
          <li role="none">
            <MenuItem
              data-testid="save-template-new-btn"
              onClick={() => run(onSaveAsNewTemplate)}
            >
              Save as new template…
            </MenuItem>
          </li>
          {canUpdateSource && (
            <li role="none">
              <MenuItem
                data-testid="save-template-back-btn"
                onClick={() => run(onUpdateSourceTemplate)}
              >
                Update source template
              </MenuItem>
            </li>
          )}
        </ul>
      </Popover>
    </>
  );
}

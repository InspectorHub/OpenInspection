export interface FullscreenToggleProps {
  active: boolean;
  onToggle: () => void;
}

/**
 * FullscreenToggle — toolbar icon button that toggles item fullscreen mode (D4).
 * When active, the ItemEditor fills the viewport and all sibling columns are hidden.
 * Press F (outside input fields) or Esc to toggle via the keyboard hook.
 */
export function FullscreenToggle({ active, onToggle }: FullscreenToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={active ? 'Exit fullscreen (Esc)' : 'Fullscreen (F)'}
      aria-label={active ? 'Exit fullscreen' : 'Enter fullscreen'}
      onClick={onToggle}
      className={`flex w-9 h-9 rounded-md items-center justify-center ${
        active
          ? 'bg-ih-primary-tint text-ih-primary'
          : 'text-ih-fg-3 hover:bg-ih-bg-muted'
      }`}
    >
      {active ? (
        /* Compress / exit-fullscreen icon */
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 9V4m0 5H4m11-5v5m0 0h5M9 15v5m0-5H4m11 5v-5m0 0h5"
          />
        </svg>
      ) : (
        /* Expand / enter-fullscreen icon */
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
          />
        </svg>
      )}
    </button>
  );
}

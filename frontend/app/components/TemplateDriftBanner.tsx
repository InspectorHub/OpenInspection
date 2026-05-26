interface TemplateDriftBannerProps {
  show: boolean;
  message?: string;
  onUpgrade?: () => void;
  onDismiss?: () => void;
}

export function TemplateDriftBanner({ show, message, onUpgrade, onDismiss }: TemplateDriftBannerProps) {
  if (!show) return null;
  return (
    <div className="bg-ih-watch-bg border-l-4 border-amber-500 p-4 mb-4 rounded-r-lg">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-amber-900 dark:text-amber-200">Template was updated</p>
          {message && <p className="text-xs text-ih-watch-fg mt-1">{message}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={onUpgrade} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700">Upgrade</button>
          <button onClick={onDismiss} className="px-3 py-1.5 rounded-lg ring-1 ring-amber-300 text-amber-800 dark:text-amber-200 text-xs font-bold hover:bg-amber-100 dark:hover:bg-amber-900/40">Dismiss</button>
        </div>
      </div>
    </div>
  );
}

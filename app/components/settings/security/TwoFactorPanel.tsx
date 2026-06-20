interface TwoFactorPanelProps {
  totpEnabled?: boolean;
  recoveryCodesRemaining?: number | null;
}

export function TwoFactorPanel({ totpEnabled, recoveryCodesRemaining }: TwoFactorPanelProps) {
  return (
    <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${totpEnabled ? "bg-ih-ok-bg text-ih-ok-fg" : "bg-ih-bg-muted text-ih-fg-3"}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
            </svg>
          </div>
          <div>
            <p className="font-bold text-ih-fg-1 text-[13px]">Two-factor authentication</p>
            <p className="text-[11px] text-ih-fg-3">
              {totpEnabled ? "Enabled. Required at every log in." : "Not enabled."}
            </p>
            {totpEnabled && recoveryCodesRemaining != null && (
              <p className="text-[11px] text-ih-fg-3 mt-1">{recoveryCodesRemaining} recovery codes remaining</p>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!totpEnabled ? (
            <button className="px-4 py-2 bg-ih-primary text-white rounded-md font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all">
              Enable 2FA
            </button>
          ) : (
            <>
              <button className="px-4 py-2 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-2 text-[13px] font-semibold hover:bg-ih-bg-muted transition-all">
                Regenerate codes
              </button>
              <button className="px-4 py-2 rounded-md border border-ih-bad text-ih-bad-fg text-[13px] font-bold hover:bg-ih-bad-bg transition-all">
                Disable 2FA
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

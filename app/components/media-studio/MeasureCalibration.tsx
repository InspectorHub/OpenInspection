interface MeasureCalibrationProps {
  calibKnown: string;
  calibUnit: string;
  onCalibKnownChange: (value: string) => void;
  onCalibUnitChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

/* ------------------------------------------------------------------ */
/* Calibration overlay (measure tool)                                  */
/* ------------------------------------------------------------------ */

export function MeasureCalibration({
  calibKnown,
  calibUnit,
  onCalibKnownChange,
  onCalibUnitChange,
  onCommit,
  onCancel,
}: MeasureCalibrationProps) {
  return (
    /* ds-allow: fixed-dark photo-studio chrome (white/* neutrals + amber-400 hints stay dark in both themes) */
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
      <div
        className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-[12px] text-white/80"
        style={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.1)" }}
      >
        <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>Reference length:</span>
        <input
          type="number"
          min="0"
          step="any"
          value={calibKnown}
          onChange={(e) => onCalibKnownChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit();
            }
            e.stopPropagation();
          }}
          placeholder="e.g. 12"
          className="w-20 h-7 px-2 rounded bg-slate-700 text-white text-[12px] border border-white/10 outline-none focus:border-ih-primary placeholder-white/30"
        />
        <select
          value={calibUnit}
          onChange={(e) => onCalibUnitChange(e.target.value)}
          className="h-7 px-1.5 rounded bg-slate-700 text-white text-[12px] border border-white/10 outline-none focus:border-ih-primary"
        >
          <option value="in">in</option>
          <option value="ft">ft</option>
          <option value="cm">cm</option>
          <option value="m">m</option>
          <option value="mm">mm</option>
        </select>
        <button
          onClick={onCommit}
          className="h-7 px-3 rounded bg-ih-primary text-white text-[11px] font-bold hover:bg-ih-primary-600"
        >
          Set
        </button>
        <button
          onClick={onCancel}
          className="text-white/40 hover:text-white/70 ml-1"
          aria-label="Cancel calibration"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

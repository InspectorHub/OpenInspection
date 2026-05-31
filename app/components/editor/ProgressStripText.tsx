export interface ProgressStripTextProps {
    rated:       number;
    total:       number;
    defects:     number;
    monitor:     number;
    etaMinutes:  number;
}

const Dot = ({ color }: { color: string }) => (
    <span
        className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle"
        style={{ backgroundColor: color }}
    />
);

export function ProgressStripText({ rated, total, defects, monitor, etaMinutes }: ProgressStripTextProps) {
    const isComplete = rated === total && total > 0;
    return (
        <div className="flex items-center gap-3 text-[12px] font-mono tabular-nums">
            <span>
                <Dot color="var(--ih-ok)" />
                {rated}/{total} rated
            </span>
            {defects > 0 && (
                <span>
                    <Dot color="var(--ih-bad)" />
                    {defects} defect{defects === 1 ? '' : 's'}
                </span>
            )}
            {monitor > 0 && (
                <span>
                    <Dot color="var(--ih-watch)" />
                    {monitor} monitor
                </span>
            )}
            {!isComplete && etaMinutes > 0 && (
                <span className="text-ih-fg-3">ETA {etaMinutes}min</span>
            )}
        </div>
    );
}

export function AtmosphericBg(): JSX.Element {
    return (
        <div class="fixed inset-0 pointer-events-none overflow-hidden select-none">
            <div class="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-indigo-500/5 blur-[120px] rounded-full animate-float"></div>
            <div class="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] bg-blue-500/5 blur-[120px] rounded-full animate-float" style="animation-delay: -2s"></div>
        </div>
    );
}

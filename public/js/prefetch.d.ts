interface PrefetchProgress { done: number; total: number }
interface PrefetchOptions {
    onProgress?: (p: PrefetchProgress) => void;
    onComplete?: (p: PrefetchProgress) => void;
}
export function startPrefetch(opts?: PrefetchOptions): Promise<void>;
export function stopPrefetch(): void;

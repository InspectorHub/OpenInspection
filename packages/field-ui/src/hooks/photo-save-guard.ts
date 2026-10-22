/**
 * Runs `task` while `key` is held in `inFlight`, and releases it when the task settles, whatever
 * the outcome. The caller checks `inFlight.has(key)` first and drops a repeat; the key is added
 * synchronously here, so a second call in the same frame sees it. A rejection of `task` is left
 * unhandled, exactly as the bare `void` chains this replaces left it.
 */
export function guardedSave(inFlight: Set<string>, key: string, task: () => Promise<unknown>): void {
  inFlight.add(key);
  void task().finally(() => {
    inFlight.delete(key);
  });
}

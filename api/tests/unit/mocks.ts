import { vi } from 'vitest';

/**
 * Mock D1 Database for Vitest
 * Supports result queuing for complex multi-step operations.
 */
export class MockD1 {
  private results: any[] = [];

  /**
   * Push a result to be returned by the next query/execution.
   */
  pushResult(data: any) {
    this.results.push(data);
  }

  exec(_query: string) {
    return Promise.resolve({ success: true });
  }
}

/**
 * Mock KV Namespace for Vitest
 */
export class MockKV {
  private store = new Map<string, any>();

  constructor() {}

  get = vi.fn(async (key: string, _options?: any) => {
    return this.store.get(key) || null;
  });

  put = vi.fn(async (key: string, value: any, _options?: any) => {
    this.store.set(key, value);
  });

  delete = vi.fn(async (key: string) => {
    this.store.delete(key);
  });

  list = vi.fn(async (_options?: any) => {
    return { keys: Array.from(this.store.keys()).map(k => ({ name: k })), list_complete: true };
  });
}

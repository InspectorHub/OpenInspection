export interface SnapshotEntry {
  operationId: string; method: string; pathTemplate: string;
  scopes: string[]; tag: string; tier: string; inputSchema: unknown;
  summary?: string; description?: string;
}
export function toolNameFromOperationId(op: string): string {
  const snake = op.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return `openinspection_${snake}`;
}
export function selectTools(snapshot: SnapshotEntry[], grantedScopes: string[]): SnapshotEntry[] {
  const granted = new Set(grantedScopes); // 'kind:tag'
  const has = (kind: string, tag: string) => granted.has(`${kind}:${tag}`) || granted.has(`${kind}:*`);
  return snapshot.filter(e =>
    e.tier === 'primary' && e.scopes.every(k => has(k, e.tag)),
  );
}

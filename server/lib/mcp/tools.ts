export interface SnapshotEntry {
  operationId: string; method: string; pathTemplate: string;
  scopes: string[]; tag: string; tier: string; inputSchema: unknown;
  summary?: string; description?: string;
}
export function toolNameFromOperationId(op: string): string {
  const snake = op.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return `openinspection_${snake}`;
}
export interface SelectToolsOptions {
  /** When true, `extended`-tier operations are exposed in addition to `primary`
   * (operator opt-in via the MCP_EXTENDED_TOOLS env). `excluded` is NEVER exposed. */
  includeExtended?: boolean;
}
export function selectTools(
  snapshot: SnapshotEntry[],
  grantedScopes: string[],
  opts: SelectToolsOptions = {},
): SnapshotEntry[] {
  const granted = new Set(grantedScopes); // 'kind:tag'
  const has = (kind: string, tag: string) => granted.has(`${kind}:${tag}`) || granted.has(`${kind}:*`);
  const tierOk = (tier: string) => tier === 'primary' || (opts.includeExtended === true && tier === 'extended');
  return snapshot.filter(e =>
    tierOk(e.tier) && e.scopes.every(k => has(k, e.tag)),
  );
}

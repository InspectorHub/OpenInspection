function truthy(v: string | undefined): boolean {
  const s = (v ?? '').trim().toLowerCase();
  return s === 'true' || s === '1';
}

export function mcpEnabled(env: { MCP_ENABLED?: string }): boolean {
  return truthy(env.MCP_ENABLED);
}

/** Operator opt-in (Phase E) to expose `extended`-tier operations as MCP tools.
 * Off by default; `excluded`-tier is never exposed regardless. */
export function extendedToolsEnabled(env: { MCP_EXTENDED_TOOLS?: string }): boolean {
  return truthy(env.MCP_EXTENDED_TOOLS);
}

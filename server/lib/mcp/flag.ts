export function mcpEnabled(env: { MCP_ENABLED?: string }): boolean {
  const v = (env.MCP_ENABLED ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

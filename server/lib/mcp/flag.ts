function truthy(v: string | undefined): boolean {
  const s = (v ?? '').trim().toLowerCase();
  return s === 'true' || s === '1';
}

export function mcpEnabled(env: { MCP_ENABLED?: string }): boolean {
  return truthy(env.MCP_ENABLED);
}

/** Operator opt-in for native (iOS/Android/desktop) clients. Off by default. */
export function nativeClientEnabled(env: { NATIVE_CLIENT_ENABLED?: string }): boolean {
  return truthy(env.NATIVE_CLIENT_ENABLED);
}

/** The OAuth provider is mounted when any OAuth consumer is enabled. */
export function oauthProviderEnabled(env: { MCP_ENABLED?: string; NATIVE_CLIENT_ENABLED?: string }): boolean {
  return mcpEnabled(env) || nativeClientEnabled(env);
}

/** Operator opt-in (Phase E) to expose `extended`-tier operations as MCP tools.
 * Off by default; `excluded`-tier is never exposed regardless. */
export function extendedToolsEnabled(env: { MCP_EXTENDED_TOOLS?: string }): boolean {
  return truthy(env.MCP_EXTENDED_TOOLS);
}

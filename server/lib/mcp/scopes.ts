import type { Role } from '../auth/roles';

type Kind = 'read' | 'write' | 'admin' | 'agent';
const CAPS: Record<Role, Kind[]> = {
  owner:     ['read','write','admin'],
  manager:   ['read','write','admin'],
  inspector: ['read','write'],
  agent:     ['read','agent'],
};
export function roleAllowedScopeKinds(role: Role): Kind[] { return CAPS[role] ?? ['read']; }

function parse(s: string): { kind: string; tag: string } { const [kind, tag] = s.split(':'); return { kind, tag: tag ?? '*' }; }

export function computeGrantedScopes(input: { requested: string[]; selected: string[]; role: Role }): string[] {
  const allowed = new Set<string>(roleAllowedScopeKinds(input.role));
  const sel = new Set(input.selected);
  const granted = new Set<string>();
  for (const s of input.requested) {
    if (!sel.has(s)) continue;
    const { kind, tag } = parse(s);
    if (!allowed.has(kind)) continue;
    granted.add(`${kind}:${tag}`);
    if (kind === 'write') granted.add(`read:${tag}`); // write implies read
  }
  return [...granted];
}

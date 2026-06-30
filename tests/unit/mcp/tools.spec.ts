import { describe, it, expect } from 'vitest';
import { toolNameFromOperationId, selectTools } from '../../../server/lib/mcp/tools';

const snap = [
  { operationId: 'listInspections', method: 'get',  pathTemplate: '/api/inspections',     scopes: ['read'],  tag: 'inspections', tier: 'primary',  inputSchema: {} },
  { operationId: 'createInspection',method: 'post', pathTemplate: '/api/inspections',     scopes: ['write'], tag: 'inspections', tier: 'primary',  inputSchema: {} },
  { operationId: 'listInvoices',    method: 'get',  pathTemplate: '/api/invoices',         scopes: ['read'],  tag: 'invoices',    tier: 'primary',  inputSchema: {} },
  { operationId: 'sysadminWipe',    method: 'post', pathTemplate: '/api/sysadmin/wipe',    scopes: ['admin'], tag: 'sysadmin',    tier: 'excluded', inputSchema: {} },
] as const;

it('snake-cases with prefix', () => {
  expect(toolNameFromOperationId('listInspections')).toBe('openinspection_list_inspections');
});
it('keeps only granted tag+scope, never excluded tier', () => {
  const out = selectTools(snap as never, ['read:inspections','write:inspections']);
  expect(out.map(t => t.operationId)).toEqual(['listInspections','createInspection']);
});
it('read grant excludes write tools', () => {
  const out = selectTools(snap as never, ['read:inspections','read:invoices']);
  expect(out.map(t => t.operationId).sort()).toEqual(['listInspections','listInvoices']);
});

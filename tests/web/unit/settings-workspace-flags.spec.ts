import { describe, it, expect } from 'vitest';
import { parseWithZod } from '@conform-to/zod/v4';
import { workspaceSchema } from '../../../app/lib/forms/settings.schema';

/**
 * Regression: the "Report Features" checkboxes (enableRepairList /
 * enableCustomerRepairExport) render as a hidden "false" + checkbox "true" pair,
 * so a CHECKED box submits the field twice (["false","true"]). These flags must
 * NOT be in workspaceSchema — if they were declared z.boolean(), conform would
 * feed the array to z.boolean() and the whole form would fail to submit (the flag
 * could never be turned on). They're read via fd.getAll() in the action instead.
 */
function fd(pairs: [string, string][]) {
  const f = new FormData();
  for (const [k, v] of pairs) f.append(k, v);
  return f;
}

describe('workspace settings — report-feature flags do not block submit', () => {
  it('a checked flag (doubled value) still parses successfully', () => {
    const f = fd([
      ['siteName', 'Acme'],
      ['reportTheme', 'modern'],
      ['enableRepairList', 'false'],
      ['enableCustomerRepairExport', 'false'],
      ['enableCustomerRepairExport', 'true'], // checkbox adds the second value
    ]);
    const submission = parseWithZod(f, { schema: workspaceSchema });
    expect(submission.status).toBe('success');
  });

  it('getAll last-value-wins yields the checkbox state', () => {
    const f = fd([
      ['enableCustomerRepairExport', 'false'],
      ['enableCustomerRepairExport', 'true'],
    ]);
    const vals = f.getAll('enableCustomerRepairExport');
    expect(vals[vals.length - 1] === 'true').toBe(true);
    const unchecked = fd([['enableCustomerRepairExport', 'false']]);
    const u = unchecked.getAll('enableCustomerRepairExport');
    expect(u[u.length - 1] === 'true').toBe(false);
  });
});

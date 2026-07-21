import { describe, it, expect } from 'vitest';
import { parseWithZod } from '@conform-to/zod/v4';
import { makeWorkspaceSchema } from '../../../app/lib/forms/settings.schema';

/**
 * Regression: the "Report Features" checkboxes (enableRepairList /
 * enableCustomerRepairExport) are conform-native checkboxes — a SINGLE input with
 * value "on" and NO hidden "false" sibling. A checked box submits one "on" value
 * that conform coerces to a boolean in submission.value; an unchecked box submits
 * nothing (→ undefined → treated as false in the action).
 *
 * History: an earlier hidden("false")+checkbox("true") pair submitted the field
 * TWICE; with z.boolean() in the schema, conform fed that array to z.boolean() and
 * the whole form silently failed to submit (the flag could never be turned on).
 */
function fd(pairs: [string, string][]) {
  const f = new FormData();
  for (const [k, v] of pairs) f.append(k, v);
  return f;
}

describe('workspace settings — report-feature checkboxes coerce to booleans', () => {
  it('checked ("on") → success with the flag true', () => {
    const submission = parseWithZod(
      fd([['companyName', 'Acme'], ['enableCustomerRepairExport', 'on']]),
      { schema: makeWorkspaceSchema() },
    );
    expect(submission.status).toBe('success');
    if (submission.status === 'success') {
      expect(submission.value.enableCustomerRepairExport).toBe(true);
    }
  });

  it('unchecked (absent) → success with the flag falsy', () => {
    const submission = parseWithZod(
      fd([['companyName', 'Acme']]),
      { schema: makeWorkspaceSchema() },
    );
    expect(submission.status).toBe('success');
    if (submission.status === 'success') {
      expect(submission.value.enableCustomerRepairExport ?? false).toBe(false);
    }
  });
});

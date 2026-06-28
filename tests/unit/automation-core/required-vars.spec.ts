// apps/openinspection/tests/unit/automation-core/required-vars.spec.ts
import { describe, it, expect } from 'vitest';
import { checkRequiredVars } from '../../../server/lib/automation-core/required-vars';

describe('checkRequiredVars', () => {
  it('missing required var referenced by a template → not ok, reports the key', () => {
    expect(checkRequiredVars(['Review: {{review_url}}'], { review_url: undefined }))
      .toEqual({ ok: false, missingKey: 'review_url' });
    expect(checkRequiredVars(['Review: {{review_url}}'], { review_url: '' }))
      .toEqual({ ok: false, missingKey: 'review_url' });
  });
  it('present required var → ok', () => {
    expect(checkRequiredVars(['Review: {{review_url}}'], { review_url: 'https://g.page/r/x' }))
      .toEqual({ ok: true });
  });
  it('required var NOT referenced by any template → ok (not gated)', () => {
    expect(checkRequiredVars(['Hello'], { review_url: undefined })).toEqual({ ok: true });
  });
  it('checks subject + body together', () => {
    expect(checkRequiredVars(['Subj {{review_url}}', 'Body'], { review_url: undefined }))
      .toEqual({ ok: false, missingKey: 'review_url' });
  });
});

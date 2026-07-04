import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A structural guard: the logic-only editor must not render embedded body inputs
// and must reference the template-id fields. (Renders SSR-only; a source-level
// assertion is the cheapest reliable signal that the body editors were removed.)
const src = readFileSync(resolve(__dirname, './settings-automations.tsx'), 'utf8');

describe('logic-only automation editor', () => {
  it('no longer binds a bodyTemplate / smsBody editor input', () => {
    expect(src).not.toMatch(/name=["']bodyTemplate["']/);
    expect(src).not.toMatch(/name=["']smsBody["']/);
    expect(src).not.toMatch(/name=["']subjectTemplate["']/);
  });
  it('references the template-id fields and the templates hub link', () => {
    expect(src).toMatch(/emailTemplateId/);
    expect(src).toMatch(/smsTemplateId/);
    expect(src).toMatch(/settings\/communication\/templates/);
  });
});

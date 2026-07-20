import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A structural guard: the logic-only editor must not render embedded body inputs
// and must reference the template-id fields. (Renders SSR-only; a source-level
// assertion is the cheapest reliable signal that the body editors were removed.)
// The editor form was extracted into AutomationEditorModal for the file-size
// gate (Spec 2 Task 0), so the editor-content assertions read the modal source.
const src = readFileSync(resolve(__dirname, './settings-automations.tsx'), 'utf8');
const modalSrc = readFileSync(
  resolve(__dirname, '../components/settings/AutomationEditorModal.tsx'),
  'utf8',
);

describe('logic-only automation editor', () => {
  it('no longer binds a bodyTemplate / smsBody editor input', () => {
    expect(modalSrc).not.toMatch(/name=["']bodyTemplate["']/);
    expect(modalSrc).not.toMatch(/name=["']smsBody["']/);
    expect(modalSrc).not.toMatch(/name=["']subjectTemplate["']/);
  });
  it('references the template-id fields and the templates hub link', () => {
    expect(modalSrc).toMatch(/emailTemplateId/);
    expect(modalSrc).toMatch(/smsTemplateId/);
    expect(modalSrc).toMatch(/settings\/communication\/templates/);
  });
});

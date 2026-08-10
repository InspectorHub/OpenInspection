import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A structural guard: the logic-only editor must not render embedded body inputs
// and must reference the template-id fields. (Renders SSR-only; a source-level
// assertion is the cheapest reliable signal that the body editors were removed.)
// The editor form was extracted into AutomationEditorModal for the file-size
// gate (Spec 2 Task 0), so the "references the template-id fields" assertions
// read the modal source.
//
// The MUST-NOT-BIND half deliberately reads BOTH. The extraction moved the form
// out of the route, and for a while these assertions moved with it — which left
// the route free to grow a body input again with nothing watching. "The editor
// does not render an embedded body editor" is a claim about the whole editor
// surface, so both files have to answer it, wherever the form happens to live
// after the next split.
const routeSrc = readFileSync(resolve(__dirname, './settings-automations.tsx'), 'utf8');
const modalSrc = readFileSync(
  resolve(__dirname, '../components/settings/AutomationEditorModal.tsx'),
  'utf8',
);

describe('logic-only automation editor', () => {
  it('no longer binds a bodyTemplate / smsBody editor input', () => {
    for (const [name, source] of [['route', routeSrc], ['modal', modalSrc]] as const) {
      expect(source, `${name} source binds bodyTemplate`).not.toMatch(/name=["']bodyTemplate["']/);
      expect(source, `${name} source binds smsBody`).not.toMatch(/name=["']smsBody["']/);
      expect(source, `${name} source binds subjectTemplate`).not.toMatch(/name=["']subjectTemplate["']/);
    }
  });
  it('references the template-id fields and the templates hub link', () => {
    expect(modalSrc).toMatch(/emailTemplateId/);
    expect(modalSrc).toMatch(/smsTemplateId/);
    expect(modalSrc).toMatch(/settings\/communication\/templates/);
  });
});

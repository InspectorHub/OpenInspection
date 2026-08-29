/**
 * A Home Inspector Pro template whose panels nest inside panels loses a level
 * on import, silently.
 *
 * This spec does not fix the flattening -- fixing it needs a real three-level
 * .tpz, which nobody has, and the vendor schema records no observation of one.
 * It makes the import SAY so, which turns "nobody has looked" into "we know it
 * flattens, and it tells you".
 */
import { describe, it, expect } from 'vitest';
import { homeInspectorProAdapter } from '../../../server/lib/migration-intake/adapters/home-inspector-pro';
import { parseMigrationBundle } from '../../../server/lib/validations/migration-bundle.schema';
import { zipOf } from '../helpers/zip-fixture';

const panel = (name: string, inner = '') =>
    '<void method="add"><object class="generated.SavedPanel">'
    + `<void property="panelName"><string>${name}</string></void>${inner}</object></void>`;

const doc = (panels: string) =>
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<java version="10.0.2" class="java.beans.XMLDecoder">'
    + '<object class="generated.TemplateInfo">'
    + '<void property="templateName"><string>T</string></void>'
    + '<void property="tabbedPanesList"><void method="add">'
    + '<object class="generated.SavedTabbedPane">'
    + '<void property="tabbedPaneName"><string>Roof</string></void>'
    + `<void property="savedPanels">${panels}</void>`
    + '</object></void></void></object></java>';

const convert = async (panels: string) => {
    const result = await homeInspectorProAdapter.convert(
        await zipOf({ 'TabbedPanes.tpl': doc(panels) }),
        { name: 'Imported', ratingKind: 'severity' },
    );
    if (!result.ok) throw new Error('the fixture did not convert');
    // A warning is `{ code, message }`, not a string, and the bundle schema is
    // strict. Parsing here is what stops this spec passing on a shape the
    // import pipeline would reject a step later.
    const parsed = parseMigrationBundle(result.bundle);
    expect(parsed.ok === false ? parsed.issues : []).toEqual([]);
    return result.bundle.manifest.warnings;
};

describe('home-inspector-pro nesting', () => {
    it('warns when a panel contains another panel', async () => {
        const warnings = await convert(panel('Deck', panel('Underside')));
        expect(warnings.map((w) => w.code)).toEqual(['NESTED_PANELS_FLATTENED']);
        // And says how many, so the number is checkable against the source.
        expect(warnings[0]!.message).toContain('1 panel(s)');
    });

    it('does NOT warn on an ordinary two-level template', async () => {
        // The positive control, and the whole reason this is worth writing: a
        // warning on every import would be noise, and every real template
        // measured so far is two-level.
        expect(await convert(panel('Deck') + panel('Covering'))).toEqual([]);
    });
});

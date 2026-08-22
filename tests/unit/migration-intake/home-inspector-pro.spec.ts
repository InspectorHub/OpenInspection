/**
 * Reading a Home Inspector Pro template.
 *
 * Everything this adapter refuses to assume came from twenty-two real files,
 * and each refusal is its own test below. The rating vocabulary is
 * user-defined — three, four and five entries were seen, sharing no words, and
 * eight of the twenty-two had none at all. `showRatings` was absent far more
 * often than present. Twenty-one of twenty-two carried no version. Archives
 * held between three and fifty-four entries. And one of them was empty.
 */
import { describe, it, expect } from 'vitest';
import { homeInspectorProAdapter } from '../../../server/lib/migration-intake/adapters/home-inspector-pro';
import { parseMigrationBundle } from '../../../server/lib/validations/migration-bundle.schema';
import { zipOf } from '../helpers/zip-fixture';

const TPL = `<?xml version="1.0" encoding="UTF-8"?>
<java version="10.0.2" class="java.beans.XMLDecoder">
 <object class="example.TemplateInfo">
  <void property="templateName"><string>Commercial Inspection - Full</string></void>
  <void property="ratingNames">
   <void method="add"><string> Yes</string></void>
   <void method="add"><string>No</string></void>
   <void method="add"><string>N/A</string></void>
  </void>
  <void property="tabbedPanesList">
   <void method="add"><object class="example.SavedTabbedPane">
     <void property="tabbedPaneName"><string>First Area</string></void>
     <void property="savedPanels">
       <void method="add"><object class="example.SavedPanel">
         <void property="panelName"><string>One</string></void></object></void>
       <void method="add"><object class="example.SavedPanel">
         <void property="panelName"><string>Two</string></void></object></void>
     </void>
   </object></void>
   <void method="add"><object class="example.SavedTabbedPane">
     <void property="tabbedPaneName"><string>Second Area</string></void>
     <void property="savedPanels">
       <void method="add"><object class="example.SavedPanel">
         <void property="panelName"><string>Three</string></void></object></void>
     </void>
   </object></void>
  </void>
 </object>
</java>`;

const template = (tpl = TPL, extra: Record<string, string> = {}): Promise<Uint8Array> =>
    zipOf({ 'TabbedPanes.tpl': tpl, ...extra });

describe('homeInspectorProAdapter.inspect', () => {
    it('reports the template name the FILE carries, not the filename', async () => {
        const got = await homeInspectorProAdapter.inspect?.(await template());
        expect(got?.kind).toBe('template');
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.name).toBe('Commercial Inspection - Full');
    });

    it('reports the rating vocabulary VERBATIM, spaces and all', async () => {
        // Real files carry entries like ` Yes` and `Acceptable `. Trimming here
        // would hide it from the person being asked to classify them, and the
        // classifying is the whole point of the mapping step.
        const got = await homeInspectorProAdapter.inspect?.(await template());
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.ratings).toEqual([' Yes', 'No', 'N/A']);
    });

    it('counts sections and items through the nesting', async () => {
        const got = await homeInspectorProAdapter.inspect?.(await template());
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.sections).toBe(2);
        expect(got.items).toBe(3);
    });

    it('reports ratingsShown as NULL when the property is absent', async () => {
        // Absent is not false. In twenty-two real templates it was missing far
        // more often than present, and folding it to false asserts something
        // the file did not say.
        const got = await homeInspectorProAdapter.inspect?.(await template());
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.ratingsShown).toBeNull();
    });

    it('POSITIVE CONTROL — a present showRatings IS read', async () => {
        const withFlag = TPL.replace('<void property="ratingNames">',
            '<void property="showRatings"><boolean>false</boolean></void>\n<void property="ratingNames">');
        const got = await homeInspectorProAdapter.inspect?.(await template(withFlag));
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.ratingsShown).toBe(false);
    });

    it('an EMPTY template reports zero, and is not an error', async () => {
        // One of the twenty-two is empty, and that shape is exactly what makes
        // an importer report success while importing nothing.
        const empty = `<?xml version="1.0"?><java class="java.beans.XMLDecoder">
          <object class="example.TemplateInfo"></object></java>`;
        const got = await homeInspectorProAdapter.inspect?.(await template(empty));
        expect(got?.kind).toBe('template');
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.sections).toBe(0);
        expect(got.items).toBe(0);
        expect(got.ratings).toEqual([]);
        expect(got.name).toBeNull();
    });

    it('does not require any entry other than the structure file', async () => {
        // Real archives carry between three and fifty-four entries. A reader
        // that required a fixed set fails on most of them.
        const bare = await homeInspectorProAdapter.inspect?.(await template());
        const crowded = await homeInspectorProAdapter.inspect?.(await template(TPL, {
            'Inserts.xml': '<x/>', 'Notes.txt': 'anything', 'images/a.png': 'not really a png',
        }));
        expect(bare).not.toBeNull();
        expect(crowded).not.toBeNull();
        expect(JSON.stringify(crowded)).toBe(JSON.stringify(bare));
    });

    it('does not branch on a version — a document carrying none still reads', async () => {
        // Twenty-one of the twenty-two carry no version at all, and the Java
        // versions of the ones that do span 2009 to 2024.
        const versionless = TPL.replace(' version="10.0.2"', '');
        const got = await homeInspectorProAdapter.inspect?.(await template(versionless));
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.sections).toBe(2);
    });

    it('returns null for a zip that is not one of these templates', async () => {
        expect(await homeInspectorProAdapter.inspect?.(
            await zipOf({ 'xl/worksheets/sheet1.xml': '<worksheet/>' }),
        )).toBeNull();
    });

    it('returns null for bytes that are not a zip at all', async () => {
        expect(await homeInspectorProAdapter.inspect?.(
            new TextEncoder().encode('Full Name,Email\nA,b@c.test'),
        )).toBeNull();
    });
});

describe('homeInspectorProAdapter.convert', () => {
    it('produces a bundle that passes the format validator', async () => {
        const result = await homeInspectorProAdapter.convert(await template(), { name: 'Imported', ratingKind: 'severity' });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('unreachable');
        const parsed = parseMigrationBundle(result.bundle);
        expect(parsed.ok === false ? parsed.issues : []).toEqual([]);
    });

    it('keeps the file\'s sections and items, in the file\'s order', async () => {
        const result = await homeInspectorProAdapter.convert(await template(), { name: 'Imported', ratingKind: 'severity' });
        if (!result.ok) throw new Error('unreachable');
        const schema = result.bundle.templates[0]!.schema;
        expect(schema.sections.map((s) => s.title)).toEqual(['First Area', 'Second Area']);
        expect(schema.sections[0]!.items.map((i) => i.label)).toEqual(['One', 'Two']);
    });

    it('gives every item the operator\'s OWN rating words, verbatim', async () => {
        // Not ours. The file supplies a vocabulary, and replacing it with a
        // default would throw away the one thing the mapping step is there to
        // ask about.
        const result = await homeInspectorProAdapter.convert(await template(), { name: 'Imported', ratingKind: 'severity' });
        if (!result.ok) throw new Error('unreachable');
        expect(result.bundle.templates[0]!.schema.sections[0]!.items[0]!.ratingOptions)
            .toEqual([' Yes', 'No', 'N/A']);
    });

    it('falls back to our own words only when the file supplies NONE', async () => {
        // Eight of twenty-two templates carry no vocabulary. An item still
        // needs options, so it gets ours — and this is the only case where it
        // does.
        const noRatings = TPL.replace(/ *<void property="ratingNames">[\s\S]*?<\/void>\n/, '');
        const result = await homeInspectorProAdapter.convert(await template(noRatings), { name: 'X', ratingKind: 'severity' });
        if (!result.ok) throw new Error('unreachable');
        const options = result.bundle.templates[0]!.schema.sections[0]!.items[0]!.ratingOptions ?? [];
        expect(options.length).toBeGreaterThan(0);
        expect(options).not.toContain(' Yes');
    });

    it('converts an EMPTY template rather than refusing it', async () => {
        // A legitimate file. It becomes a staged row that the repair step calls
        // out — a template with no sections — rather than an upload refused
        // with a sentence saying the operator's own file is wrong.
        const empty = `<?xml version="1.0"?><java class="java.beans.XMLDecoder">
          <object class="example.TemplateInfo"></object></java>`;
        const result = await homeInspectorProAdapter.convert(await template(empty), { name: 'Blank', ratingKind: 'severity' });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('unreachable');
        expect(result.bundle.templates[0]!.schema.sections).toEqual([]);
    });

    it('is PURE — the same bytes convert to the same bundle', async () => {
        const bytes = await template();
        const first = await homeInspectorProAdapter.convert(bytes, { name: 'X', ratingKind: 'severity' });
        const second = await homeInspectorProAdapter.convert(bytes, { name: 'X', ratingKind: 'severity' });
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });

    it('refuses a file that is not one of these templates, as a value', async () => {
        const result = await homeInspectorProAdapter.convert(
            await zipOf({ 'xl/worksheets/sheet1.xml': '<worksheet/>' }), { name: 'X', ratingKind: 'severity' },
        );
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.error.code).toBe('NOT_AN_EXPORT');
    });
});

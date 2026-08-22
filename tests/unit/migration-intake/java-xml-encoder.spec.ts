/**
 * Reading a `java.beans.XMLDecoder` document without decoding it.
 *
 * ⚠️ The distinction is the point. A real decoder INSTANTIATES the classes a
 * document names and CALLS the methods it names, which is why that format is a
 * well-known remote-code-execution vector. Everything here extracts text.
 */
import { describe, it, expect } from 'vitest';
import {
    objectsOfClass,
    propertyBoolean,
    propertyStrings,
} from '../../../server/lib/migration-intake/formats/java-xml-encoder';

const DOC = `<?xml version="1.0" encoding="UTF-8"?>
<java version="10.0.2" class="java.beans.XMLDecoder">
 <object class="example.TemplateInfo">
  <void property="templateName"><string>Commercial Full</string></void>
  <void property="ratingNames">
   <void method="add"><string> Yes</string></void>
   <void method="add"><string>No</string></void>
   <void method="add"><string>N/A</string></void>
  </void>
  <void property="tabbedPanesList">
   <void method="add"><object class="example.SavedTabbedPane">
     <void property="tabbedPaneName"><string>First</string></void>
     <void property="savedPanels">
       <void method="add"><object class="example.SavedPanel">
         <void property="panelName"><string>One</string></void></object></void>
       <void method="add"><object class="example.SavedPanel">
         <void property="panelName"><string>Two</string></void></object></void>
     </void>
   </object></void>
  </void>
 </object>
</java>`;

describe('propertyStrings', () => {
    it('reads a single-valued property', () => {
        expect(propertyStrings(DOC, 'templateName')).toEqual(['Commercial Full']);
    });

    it('reads a list VERBATIM, leading and trailing spaces included', () => {
        // Real files carry entries like ` Yes` and `Acceptable `. Trimming here
        // would hide from the person being asked to classify them exactly the
        // thing he is classifying.
        expect(propertyStrings(DOC, 'ratingNames')).toEqual([' Yes', 'No', 'N/A']);
    });

    it('returns an empty list for a property the document does not carry', () => {
        expect(propertyStrings(DOC, 'notPresent')).toEqual([]);
    });

    it('does NOT reach into a nested object for its strings', () => {
        // `tabbedPanesList` holds objects, and those objects hold names. A
        // reader that flattened them would report every section name as a value
        // of the list property, and a rating vocabulary would silently acquire
        // the whole template.
        expect(propertyStrings(DOC, 'tabbedPanesList')).toEqual([]);
    });

    it('decodes XML entities in a value', () => {
        const doc = '<void property="templateName"><string>Decks &amp; Steps</string></void>';
        expect(propertyStrings(doc, 'templateName')).toEqual(['Decks & Steps']);
    });
});

describe('propertyBoolean', () => {
    it('returns NULL when the property is absent', () => {
        // Absent is not false. In real templates this property was missing far
        // more often than present, and folding absent into false asserts
        // something the file did not say.
        expect(propertyBoolean(DOC, 'showRatings')).toBeNull();
    });

    it('POSITIVE CONTROL — a present property IS read, in both directions', () => {
        const off = DOC.replace('<void property="ratingNames">',
            '<void property="showRatings"><boolean>false</boolean></void>\n<void property="ratingNames">');
        const on = off.replace('<boolean>false</boolean>', '<boolean>true</boolean>');
        expect(propertyBoolean(off, 'showRatings')).toBe(false);
        expect(propertyBoolean(on, 'showRatings')).toBe(true);
    });
});

describe('objectsOfClass', () => {
    it('finds every object of a class, matched on the class name\'s last segment', () => {
        // The package prefix is not matched: the same class has shipped under
        // more than one package across fifteen years of these files, and a
        // reader pinned to one of them reads none of the others.
        expect(objectsOfClass(DOC, 'SavedPanel')).toHaveLength(2);
        expect(objectsOfClass(DOC, 'SavedTabbedPane')).toHaveLength(1);
    });

    it('returns each object\'s own body, so nested reads stay scoped', () => {
        const [pane] = objectsOfClass(DOC, 'SavedTabbedPane');
        expect(propertyStrings(pane!, 'tabbedPaneName')).toEqual(['First']);
        expect(objectsOfClass(pane!, 'SavedPanel')
            .flatMap((panel) => propertyStrings(panel, 'panelName'))).toEqual(['One', 'Two']);
    });

    it('does not confuse a class whose name merely ENDS with the same letters', () => {
        const doc = '<object class="example.UnsavedPanel"><void property="panelName">'
            + '<string>x</string></void></object>';
        expect(objectsOfClass(doc, 'SavedPanel')).toEqual([]);
    });

    it('returns nothing for a document holding no such object', () => {
        expect(objectsOfClass('<java/>', 'SavedPanel')).toEqual([]);
    });

    it('INSTANTIATES NOTHING — a hostile document is inert text here', () => {
        // The security property this module exists for, made assertable. A real
        // decoder would construct the named class and invoke the named method.
        const hostile = '<java class="java.beans.XMLDecoder">'
            + '<object class="java.lang.ProcessBuilder">'
            + '<void property="templateName"><string>whoami</string></void>'
            + '</object></java>';
        expect(propertyStrings(hostile, 'templateName')).toEqual(['whoami']);
        expect(objectsOfClass(hostile, 'ProcessBuilder')).toHaveLength(1);
    });
});

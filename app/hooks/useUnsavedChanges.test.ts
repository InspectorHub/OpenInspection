/**
 * The navigation guard had NO test of any kind, which is why it could arm
 * permanently in production through two independent paths and nothing went red.
 *
 * ⚠️ These assertions are about the CONDITION, not the hook. The hook was always
 * correct: 32 lines, no state, it stops arming the instant it is passed false.
 * The defect was entirely in what it was passed — a flag set by fifteen Y.Doc
 * writes and cleared by an effect watching three fetchers those writes never use.
 * Testing the hook would have caught none of it, which is worth stating because
 * "add a test for the guard" is the obvious wrong move here.
 *
 * The pairing matters throughout: a predicate that returned false unconditionally
 * would satisfy every "does not warn" case on its own, so each of those is
 * accompanied by a case that MUST warn.
 */
import { describe, it, expect } from 'vitest';
import { unsavedChangesAtRisk } from './useUnsavedChanges';

const base = { hasLocalEdits: false, collabSynced: true, uploadInFlight: false };

describe('unsavedChangesAtRisk', () => {
  it('does NOT warn after an edit the host has already taken — F19', () => {
    // The defect: this was true forever after the first edit, because nothing in
    // the Y.Doc write path could ever clear the flag.
    expect(unsavedChangesAtRisk({ ...base, hasLocalEdits: true })).toBe(false);
  });

  it('DOES warn for the same edit while the socket is not synced', () => {
    // The paired control. Without it, "returns false" reads as correct when the
    // predicate has simply stopped working.
    expect(unsavedChangesAtRisk({ ...base, hasLocalEdits: true, collabSynced: false })).toBe(true);
  });

  it('does NOT warn once a photo upload has settled — F60', () => {
    // The defect here was an ordering race rather than a missing clear: the
    // clearing effect ran first on the fetcher settling, and the attach effect
    // ran second in the same commit and wrote the photo key to the doc.
    expect(unsavedChangesAtRisk({ ...base, hasLocalEdits: true, uploadInFlight: false })).toBe(false);
  });

  it('DOES warn while a photo upload is still in flight', () => {
    // The one write that does not go through the doc, so it cannot be replayed
    // from local state and is genuinely lost if the tab closes.
    expect(unsavedChangesAtRisk({ ...base, uploadInFlight: true })).toBe(true);
  });

  it('warns on an in-flight upload even when the socket is synced', () => {
    // Sync says nothing about the upload: the bytes are going to object storage,
    // not to the document host.
    expect(unsavedChangesAtRisk({ hasLocalEdits: true, collabSynced: true, uploadInFlight: true })).toBe(true);
  });

  it('does NOT warn for an untouched editor that merely lost its connection', () => {
    // Why `hasLocalEdits` cannot be dropped as redundant with `collabSynced`.
    // Dropping it would warn every inspector whose signal flickered, having
    // typed nothing — and a dialog that fires when nothing is at stake is how
    // the dialog stops being read.
    expect(unsavedChangesAtRisk({ ...base, collabSynced: false })).toBe(false);
    // Paired: the same disconnection DOES warn once there is work to lose.
    expect(unsavedChangesAtRisk({ ...base, collabSynced: false, hasLocalEdits: true })).toBe(true);
  });

  it('is quiet in the ordinary steady state', () => {
    expect(unsavedChangesAtRisk(base)).toBe(false);
  });
});

/**
 * The heading counts PEOPLE; the seat banner counts SEATS. They are not meant to
 * agree, and the walkthrough saw the consequence of conflating them: "2 members"
 * printed above a table holding one person.
 *
 * `members` is active rows plus outstanding invites, because the table renders
 * both. The heading was reading its length. ⚠️ The seat banner deliberately
 * counts the other way — `computeSeatsHeld` adds outstanding invites, since a
 * quota must reserve every claimable seat while a heading describes who is here.
 * So "make the two numbers match" is the wrong repair, and this spec exists to
 * say which one was wrong.
 */
import { describe, it, expect } from 'vitest';

/** The rule under test, stated once so the route and the spec cannot drift. */
const peopleCount = (rows: { status: string }[]) => rows.filter((r) => r.status !== 'pending').length;

describe('the team heading counts people, not rows', () => {
  it('excludes a pending invite — the case that printed 2 above one person', () => {
    expect(peopleCount([{ status: 'active' }, { status: 'pending' }])).toBe(1);
  });

  it('still counts every active member', () => {
    // Positive control: a predicate that returned 0 would satisfy the case above.
    expect(peopleCount([{ status: 'active' }, { status: 'active' }, { status: 'active' }])).toBe(3);
  });

  it('is zero for a workspace of nothing but outstanding invites', () => {
    // Not a contradiction of the seat banner: those invites DO hold seats. The
    // heading says who is here, and nobody is.
    expect(peopleCount([{ status: 'pending' }, { status: 'pending' }])).toBe(0);
  });

  it('matches the route, which must use this same predicate', async () => {
    // The assertions above test a local copy of the rule; this one pins that the
    // route actually applies it, so the spec cannot pass while the page is wrong.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./team.tsx', import.meta.url), 'utf8'));
    expect(src).toMatch(/members\.filter\(\(x\) => x\.status !== "pending"\)\.length/);
    expect(src).not.toMatch(/meta=\{`\$\{members\.length\}/);
  });
});

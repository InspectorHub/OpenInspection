/**
 * The order a form's dependency rules are applied in, and the refusal for a ring.
 *
 * -- THE LIMIT THIS ENDS -----------------------------------------------------
 * `applicability.ts` used to apply its rules in DECLARATION order against one
 * values object, and said so in as many words: a question whose controlling
 * field is itself conditional would be judged against a key that may or may not
 * have been removed yet. It also named the honest fix -- a dependency order
 * computed from the graph rather than a second pass -- and this is that.
 *
 * The form that needs it is FL OIR-B1-1802 Rev. 04/26, whose question 8 is
 * printed three levels deep:
 *
 *   sealed_roof_deck                    A / B / C   asked of every inspection
 *     sealed_roof_deck_method           four boxes  printed only under A
 *       ..._spray_foam_underside_...    one box     printed only under spray foam
 *
 * Judged in declaration order with the deepest rule first, the third of those
 * reads its controller's answer BEFORE the middle rule has removed it. An
 * inspection answering "B. No Sealed Roof Deck" while carrying a stale method of
 * spray foam then KEEPS the underside key, and the page prints a ticked "entire
 * roof deck underside covered" beneath a form that says the deck is not sealed
 * at all. Nothing raises, and the document files.
 *
 * -- WHY NOT "APPLY THE RULES TWICE" -----------------------------------------
 * Because such a fix is correct exactly as deep as the number of passes it
 * makes. Two passes settle a two-link chain and get a three-link one wrong, in
 * the same silent way as before and with a change in the tree that everybody now
 * believes. An order is either right at every depth or it does not exist, and
 * those are the only two outcomes worth shipping.
 *
 * -- THE GRAPH IS FUNCTIONAL, WHICH IS WHY THIS IS SHORT ---------------------
 * A rule names exactly ONE controlling field, so every node has at most one edge
 * leaving it. The order is therefore a DEPTH: a rule whose controller is
 * unconditional sits at 0, and every other sits one below its own controller.
 * Walking that single edge from a node reaches one of three things -- a field
 * that is not conditional, a node an earlier walk already measured, or a node
 * still on this walk. The third is a ring, and the walk is holding its members.
 */
import type { StatutoryFieldDependencies } from '../../types/statutory-declaration';
import { fail } from './resolve-source';

/** Is this field itself one of the form's conditional questions? */
function isConditional(dependencies: StatutoryFieldDependencies, field: string): boolean {
    // `hasOwnProperty` rather than `in`, for the reason `applicability.ts` gives
    // about its own reads: a `Record` types every key as present, so `in` on an
    // inherited name would quietly enrol `toString` as a question on the form.
    return Object.prototype.hasOwnProperty.call(dependencies, field);
}

/**
 * A set of questions that gate each other, refused BY NAME.
 *
 * Naming every member is the whole value of the message. A ring has no first
 * element, so "a cycle was detected" leaves the person who wrote the template
 * reading all of it to find which rules are involved; the names are the two or
 * three lines they have to look at.
 *
 * Each link is stated the way the rule states it rather than drawn as an arrow:
 * the reader is holding a template, not a graph, and the sentence they need is
 * the one they wrote.
 */
function refuseRing(
    dependencies: StatutoryFieldDependencies, walk: readonly string[], repeated: string,
): never {
    const ring = walk.slice(walk.indexOf(repeated));
    const links = ring.map(
        (name) => `"${name}" applies only for certain answers to "${dependencies[name].field}"`,
    );
    fail(`${links.join(', and ')}. Those questions gate each other in a ring, so there is no `
        + 'order in which they could be judged and nothing could ever say which of them this '
        + 'form asked. At least one of them has to be a question the form puts to every '
        + 'inspection.');
}

/**
 * Every conditional question, controllers before the questions they control.
 *
 * The returned order is what `applyDependencies` walks. Ties keep the order the
 * template declares them in -- `Array.prototype.sort` is stable -- so two rules
 * at the same depth are judged in the order somebody wrote them, and a refusal
 * names the same first offender on every run rather than a different one each
 * time the keys are enumerated.
 *
 * @throws when the rules form a ring, naming every question in it. That is a
 *   property of the template alone, so it is also raised from
 *   `refuseUnusableDependencies` -- before any of this inspection's answers are
 *   read, where the other shape refusals live.
 */
export function dependencyOrder(dependencies: StatutoryFieldDependencies): readonly string[] {
    const names = Object.keys(dependencies);
    const depth = new Map<string, number>();

    for (const start of names) {
        if (depth.has(start)) continue;
        const walk: string[] = [];
        const onWalk = new Set<string>();
        let node: string | undefined = start;
        while (node !== undefined && !depth.has(node)) {
            if (onWalk.has(node)) refuseRing(dependencies, walk, node);
            onWalk.add(node);
            walk.push(node);
            // Annotated, not inferred: `node` is assigned from this and this is
            // read off `node`, which is a circularity the compiler refuses to
            // resolve rather than one that exists at run time.
            const controller: string = dependencies[node].field;
            node = isConditional(dependencies, controller) ? controller : undefined;
        }
        // The walk stopped either off the graph -- a controller the form asks of
        // every inspection, which is depth 0 -- or on a node an earlier walk
        // measured, and this one sits immediately below that.
        let below = node === undefined ? 0 : (depth.get(node) ?? 0) + 1;
        for (let i = walk.length - 1; i >= 0; i--) depth.set(walk[i], below++);
    }

    return [...names].sort((a, b) => (depth.get(a) ?? 0) - (depth.get(b) ?? 0));
}

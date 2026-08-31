/**
 * Reading one option out of an attribute's `choices` list.
 *
 * `ItemChoice` is `string | { value, label }`: a bare string is an option whose
 * value and label are the same word, which is what every template written
 * before the pair existed says, and it keeps meaning that. The pair carries a
 * statutory form's PRINTED wording beside the token the form is matched on.
 *
 * 🔴 THESE TWO ARE NOT INTERCHANGEABLE. `choiceValue` is what gets stored and
 * what `render.ts` compares against a mapping's `whenValue`, byte for byte.
 * `choiceLabel` is what a human reads and must never be stored: a label in the
 * results is an answer no box on the form matches, so the document prints with
 * that question blank -- see `c6569cae`, where a whole form came out white and
 * no gate went red.
 *
 * There IS a backstop, and it is worth knowing where: `checkValuesAgainstMap`,
 * run by the RENDERER because only it holds the field map, refuses an answer no
 * box can take and names the field, the answer and the boxes that do exist.
 * `collectStatutoryValues` does not -- it has no map, so it hands a label
 * onward without complaint. Calling the right function here is the first
 * defence and the only one that acts before the answer is stored.
 *
 * They live in one module, imported by both programs, rather than being
 * open-coded at each of the three call sites in the attributes panel: a
 * `typeof c === 'string' ? c : c.value` written out by hand is a place where
 * somebody eventually writes `.label`, and it reads as correct.
 */
import type { ItemChoice } from '../types/template-schema';

/** The token stored in the results and matched against a form's `whenValue`. */
export function choiceValue(choice: ItemChoice): string {
    return typeof choice === 'string' ? choice : choice.value;
}

/** What the inspector reads on screen. Display only -- never stored. */
export function choiceLabel(choice: ItemChoice): string {
    return typeof choice === 'string' ? choice : choice.label;
}

/** B-19b: the notes placeholder promises "type / for snippets" — make it true.
 *  "/" opens the snippet palette only at line/word starts so URLs and "w/" still type. */
export function shouldTriggerSlash(value: string, selectionStart: number): boolean {
  if (selectionStart <= 0) return true;
  const prev = value[selectionStart - 1];
  return prev === ' ' || prev === '\n' || prev === '\t';
}

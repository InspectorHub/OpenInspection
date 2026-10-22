import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { bindResultMap } from '../collab/results-binding';
import { mergeUnsyncedResults } from '../collab/results-merge';
import type { ResultsDocHandle } from '../collab/use-results-doc';
import type { ResultMap } from './useInspection';

/**
 * Projects the live results document into the editor's `results`. Once the document has synced with the
 * server's copy its projection is adopted whole (so a collaborator's deletion arrives); before that it is
 * merged over what the page already shows, finding by finding (see `mergeUnsyncedResults`), because an
 * unsynced document is nearly empty and adopting it would blank the page on the first local write.
 */
export function useResultsProjection(collab: ResultsDocHandle | null, setResults: Dispatch<SetStateAction<ResultMap>>): void {
  const synced = useRef(false);
  synced.current = collab?.synced === true;
  const doc = collab?.doc;
  useEffect(() => {
    if (!doc) return;
    return bindResultMap(doc, (next) => setResults((prev) => (synced.current ? next : mergeUnsyncedResults(prev, doc))));
  }, [doc, setResults]);
}

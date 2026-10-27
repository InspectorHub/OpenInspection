import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { FieldDataSourceProvider, useFieldDataSource, useFieldSlots } from './context';
import { readOnlyView } from './read-only-view';

const ReadOnlyContext = createContext(false);

/** True when the editor is read-only: a control that writes must not be offered. False outside an editor. */
export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}

/**
 * Wraps the editor. Read-only, the editor gets the host's data source with every write refused (`readOnlyView`) and
 * `useReadOnly()` answers true for the controls that write; otherwise it is a pass-through and changes nothing.
 */
export function ReadOnlyScope({ readOnly, children }: { readOnly: boolean; children: ReactNode }) {
  const dataSource = useFieldDataSource();
  const slots = useFieldSlots();
  const view = useMemo(() => (readOnly ? readOnlyView(dataSource) : dataSource), [readOnly, dataSource]);
  return (
    <FieldDataSourceProvider dataSource={view} slots={slots}>
      <ReadOnlyContext.Provider value={readOnly}>{children}</ReadOnlyContext.Provider>
    </FieldDataSourceProvider>
  );
}

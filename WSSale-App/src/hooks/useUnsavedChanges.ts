import { useEffect, useRef } from 'react';
import { registerUnsavedEditor } from '../utils/unsaved-changes';

/** In-memory only: passwords, customer data and reservation IDs are never persisted by this guard. */
export function useUnsavedChanges(dirty: boolean) {
  const id = useRef(Symbol('editor'));
  useEffect(() => {
    registerUnsavedEditor(id.current, dirty);
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    if (dirty) window.addEventListener('beforeunload', beforeUnload);
    const editor = id.current;
    return () => {
      registerUnsavedEditor(editor, false);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [dirty]);
  return () => registerUnsavedEditor(id.current, false);
}

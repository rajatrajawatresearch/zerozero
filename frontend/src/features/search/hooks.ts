/**
 * Feature-local hooks for the Search slice.
 *
 *  - `useDebouncedValue` — local copy (delay default 250 ms) so the search
 *    feature stays self-sufficient even if other slices tweak their own
 *    debounce defaults.
 *  - `useGlobalSearchShortcut` — binds the classic cmd/ctrl-K *and* the
 *    "/" hotkey to open the palette. Ignores the shortcut while the user
 *    is typing in another input / textarea / contenteditable surface.
 */
import { useEffect, useRef, useState } from 'react';

/* -------------------------------------------------------------------------- */
/*                              Debounced value                               */
/* -------------------------------------------------------------------------- */
/**
 * Returns a value that only updates `delay` ms after the most recent change.
 * Mirrors `features/location/hooks#useDebouncedValue` but with a snappier
 * 250 ms default geared at keystroke-level search.
 */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState<T>(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebounced(value), delay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, delay]);

  return debounced;
}

/* -------------------------------------------------------------------------- */
/*                              Global shortcut                               */
/* -------------------------------------------------------------------------- */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Registers the global search hotkeys:
 *   - `cmd+K` / `ctrl+K`  (any focus)
 *   - `/`                  (only when focus is NOT in an editable element)
 *
 * `onOpen` is stored in a ref so callers can pass an inline arrow function
 * without re-registering the listener on every render.
 */
export function useGlobalSearchShortcut(onOpen: () => void): void {
  const handlerRef = useRef(onOpen);
  handlerRef.current = onOpen;

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent): void {
      const isModK =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'k';

      if (isModK) {
        event.preventDefault();
        handlerRef.current();
        return;
      }

      if (event.key === '/' && !isEditableTarget(event.target)) {
        event.preventDefault();
        handlerRef.current();
      }
    }

    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  }, []);
}

import { useSyncExternalStore } from "react";

/**
 * A minimal observable value. Fast-changing state (the hover target updates
 * on every pointer move) lives here so only the components that read it
 * re-render, not the whole app.
 */
export function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      for (const fn of listeners) fn();
    },
    use: () => useSyncExternalStore(subscribe, () => value),
  };
}

import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Hooks do debouncingu — opóźniają trigger zmiennej / callbacku do czasu N ms ciszy.
 *
 * Use case (główny): search input. User typuje "Mokot", po 50ms "Mokoto", po 60ms "Mokotów".
 * Bez debounce → 3 zapytania do backendu. Z debounce(300ms) → 1 zapytanie 300ms po końcu typowania.
 *
 * Plus efekt cleanup: useEffect z return clear-timeout zapobiega memory leak gdy component unmount.
 *
 * Dwa eksporty:
 *   - useDebouncedValue(value, delay): zwraca opóźnioną wersję value (cleanup auto)
 *   - useDebouncedCallback(fn, delay): zwraca opóźnioną funkcję (np. do onChange)
 */

/**
 * Zwraca opóźnioną wersję `value` — aktualizuje się dopiero po `delayMs` ciszy.
 *
 * @example
 *   const [query, setQuery] = useState('');
 *   const debouncedQuery = useDebouncedValue(query, 300);
 *   useEffect(() => { searchAPI(debouncedQuery); }, [debouncedQuery]);
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}

/**
 * Zwraca callback który opóźnia wykonanie `fn` o `delayMs` od ostatniego wywołania.
 *
 * Useful gdy event handler trigger'uje akcję (np. logging, API call), a chcemy
 * batch'ować wiele triggerów w czasie.
 *
 * @example
 *   const debouncedSave = useDebouncedCallback((data) => saveAPI(data), 500);
 *   <TextInput onChangeText={(text) => debouncedSave({ text })} />
 *
 * Cleanup: timer cancelowany przy unmount albo gdy callback się zmieni.
 */
export function useDebouncedCallback<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delayMs: number,
): (...args: TArgs) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);

  // Update ref gdy fn się zmieni (zawsze najnowsza closure).
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  // Cleanup timer przy unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return useCallback((...args: TArgs) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fnRef.current(...args);
    }, delayMs);
  }, [delayMs]);
}

/**
 * Throttle — wywołuje `fn` max raz na `intervalMs` (immediate first call,
 * potem ignore aż minie interval).
 *
 * Use case: scroll handler — react na scroll co 100ms, nie każdy single event.
 *
 * @example
 *   const throttledScroll = useThrottledCallback((y) => trackScroll(y), 100);
 *   <ScrollView onScroll={(e) => throttledScroll(e.nativeEvent.contentOffset.y)} />
 */
export function useThrottledCallback<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  intervalMs: number,
): (...args: TArgs) => void {
  const lastCallRef = useRef<number>(0);
  const fnRef = useRef(fn);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  return useCallback((...args: TArgs) => {
    const now = Date.now();
    if (now - lastCallRef.current >= intervalMs) {
      lastCallRef.current = now;
      fnRef.current(...args);
    }
  }, [intervalMs]);
}

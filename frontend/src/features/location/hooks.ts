/**
 * Custom hooks for the Location feature.
 *
 * `useGeolocation` turns the callback-based `navigator.geolocation` API into
 * a promise so call-sites can `await` and try/catch cleanly.
 *
 * `useDebouncedValue` is a tiny generic helper used by the address-picker
 * search input to throttle outbound `/geo/search` requests.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/* -------------------------------------------------------------------------- */
/*                               Geolocation                                  */
/* -------------------------------------------------------------------------- */
export interface GeolocationResult {
  lat: number;
  lng: number;
  accuracy: number;
}

export type GeolocationErrorCode = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

export class GeolocationError extends Error {
  public readonly code: GeolocationErrorCode;
  constructor(code: GeolocationErrorCode, message: string) {
    super(message);
    this.name = 'GeolocationError';
    this.code = code;
  }
}

/**
 * Returns `{ locate, isLoading, error, data }`.
 *
 *  - `locate()` resolves to `{ lat, lng, accuracy }` or rejects with a
 *    `GeolocationError` whose `.code` is one of `unsupported` / `denied` /
 *    `unavailable` / `timeout` so UIs can render friendly copy.
 *  - The hook also tracks the latest resolution in state for consumers
 *    that want to subscribe (e.g. for a pulsing indicator).
 */
export function useGeolocation() {
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<GeolocationResult | null>(null);
  const [error, setError] = useState<GeolocationError | null>(null);

  const locate = useCallback((): Promise<GeolocationResult> => {
    return new Promise((resolve, reject) => {
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
        const err = new GeolocationError(
          'unsupported',
          'Location is not supported on this device.',
        );
        setError(err);
        reject(err);
        return;
      }

      setIsLoading(true);
      setError(null);

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const result: GeolocationResult = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          };
          setData(result);
          setIsLoading(false);
          resolve(result);
        },
        (positionError) => {
          setIsLoading(false);
          let code: GeolocationErrorCode;
          let message: string;
          switch (positionError.code) {
            case positionError.PERMISSION_DENIED:
              code = 'denied';
              message = 'Enable location access or enter your address manually.';
              break;
            case positionError.POSITION_UNAVAILABLE:
              code = 'unavailable';
              message = 'Could not determine your location. Try again.';
              break;
            case positionError.TIMEOUT:
              code = 'timeout';
              message = 'Location request timed out. Try again.';
              break;
            default:
              code = 'unavailable';
              message = positionError.message || 'Could not fetch location.';
          }
          const err = new GeolocationError(code, message);
          setError(err);
          reject(err);
        },
        {
          enableHighAccuracy: true,
          timeout: 10_000,
          maximumAge: 60_000,
        },
      );
    });
  }, []);

  return { locate, isLoading, data, error };
}

/* -------------------------------------------------------------------------- */
/*                              Debounced value                               */
/* -------------------------------------------------------------------------- */
/**
 * Returns a value that only updates `delay` ms after the most recent change.
 *
 * Standard pattern: user types into an input → `value` updates every
 * keystroke → `debouncedValue` only updates once typing settles → the query
 * hook keyed on `debouncedValue` fires one request, not ten.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
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

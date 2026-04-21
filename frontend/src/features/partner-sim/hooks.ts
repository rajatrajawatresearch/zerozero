/**
 * Feature-local hooks for the partner simulator.
 *
 *  `useGeolocationStream(onPoint, {enabled})`
 *     Wraps `navigator.geolocation.watchPosition` with sensible defaults
 *     (high-accuracy, 10s timeout, 5s max-age). Cleans up the watch on
 *     unmount / when `enabled` flips false. Surfaces errors via `error`.
 *
 *  `useRouteSimulation(from, to, onPoint, {enabled, intervalMs, steps})`
 *     Dev-only helper: walks a straight line between two LatLngs in `steps`
 *     equidistant increments, invoking `onPoint` each tick. Pauses when
 *     `enabled` flips false, restarts when toggled back on.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { LatLng } from '@/types';
import type { StreamPoint } from './types';

/* -------------------------------------------------------------------------- */
/*                              Geolocation stream                            */
/* -------------------------------------------------------------------------- */
export interface GeolocationStreamOptions {
  enabled: boolean;
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

export interface GeolocationStreamState {
  /** Latest error reported by the geolocation API, or null. */
  error: GeolocationPositionError | null;
  /** Total points delivered to `onPoint` since the stream started. */
  count: number;
}

/** Type-guard: the API is available in this browser + over a secure context. */
function hasGeolocation(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

export function useGeolocationStream(
  onPoint: (p: StreamPoint) => void,
  options: GeolocationStreamOptions,
): GeolocationStreamState {
  const {
    enabled,
    enableHighAccuracy = true,
    timeout = 10_000,
    maximumAge = 5_000,
  } = options;

  const [error, setError] = useState<GeolocationPositionError | null>(null);
  const [count, setCount] = useState(0);
  // Keep the callback ref fresh without re-subscribing watchPosition.
  const cbRef = useRef(onPoint);
  cbRef.current = onPoint;

  useEffect(() => {
    if (!enabled) return;
    if (!hasGeolocation()) {
      // Fabricate a PositionError-like object. The native type has a
      // private ctor so we build the shape and let TS infer it.
      const fakeError: GeolocationPositionError = {
        code: 2,
        message: 'Geolocation API not available in this context',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      };
      setError(fakeError);
      return;
    }

    setError(null);
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const point: StreamPoint = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          at: pos.timestamp,
          accuracy: pos.coords.accuracy,
          ...(pos.coords.heading != null ? { heading: pos.coords.heading } : {}),
          ...(pos.coords.speed != null ? { speed: pos.coords.speed } : {}),
        };
        setCount((c) => c + 1);
        cbRef.current(point);
      },
      (err) => setError(err),
      { enableHighAccuracy, timeout, maximumAge },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [enabled, enableHighAccuracy, timeout, maximumAge]);

  return { error, count };
}

/* -------------------------------------------------------------------------- */
/*                              Route simulation                              */
/* -------------------------------------------------------------------------- */
export interface RouteSimulationOptions {
  enabled: boolean;
  /** ms between steps. Defaults to 3000 per PHASE4_CONTRACTS. */
  intervalMs?: number;
  /** Number of equidistant steps between `from` and `to`. Defaults to 20. */
  steps?: number;
}

export interface RouteSimulationState {
  /** Index of the last step fired, 0-based; -1 until the first tick. */
  stepIndex: number;
  /** True once every step has been emitted. */
  done: boolean;
}

/**
 * Linear-interpolation walker between two LatLngs.
 *
 * We don't use great-circle math because over delivery-scale distances the
 * error is under a metre — straight-line lerp reads cleaner on the map.
 */
export function useRouteSimulation(
  from: LatLng | null,
  to: LatLng | null,
  onPoint: (p: StreamPoint) => void,
  options: RouteSimulationOptions,
): RouteSimulationState {
  const { enabled, intervalMs = 3_000, steps = 20 } = options;
  const [stepIndex, setStepIndex] = useState<number>(-1);
  const [done, setDone] = useState<boolean>(false);

  const cbRef = useRef(onPoint);
  cbRef.current = onPoint;

  // Reset state whenever the route endpoints or step count change.
  useEffect(() => {
    setStepIndex(-1);
    setDone(false);
  }, [from?.lat, from?.lng, to?.lat, to?.lng, steps]);

  useEffect(() => {
    if (!enabled || !from || !to || done) return;

    const timer = setInterval(() => {
      setStepIndex((prev) => {
        const next = prev + 1;
        if (next >= steps) {
          setDone(true);
          return prev;
        }
        const t = steps === 1 ? 1 : next / (steps - 1);
        const lat = from.lat + (to.lat - from.lat) * t;
        const lng = from.lng + (to.lng - from.lng) * t;
        cbRef.current({ lat, lng, at: Date.now() });
        return next;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [enabled, from, to, intervalMs, steps, done]);

  return { stepIndex, done };
}

/* -------------------------------------------------------------------------- */
/*                            Browser-position probe                          */
/* -------------------------------------------------------------------------- */
/**
 * One-shot reader — used by "Go online" to grab an initial fix. Returns a
 * stable callback rather than a hook body so consumers can await it inside
 * an event handler without juggling promise refs.
 */
export function getCurrentPosition(): Promise<StreamPoint> {
  return new Promise((resolve, reject) => {
    if (!hasGeolocation()) {
      reject(new Error('Geolocation API unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          at: pos.timestamp,
          accuracy: pos.coords.accuracy,
          ...(pos.coords.heading != null ? { heading: pos.coords.heading } : {}),
          ...(pos.coords.speed != null ? { speed: pos.coords.speed } : {}),
        });
      },
      (err) => reject(new Error(err.message || 'Geolocation failed')),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  });
}

/* -------------------------------------------------------------------------- */
/*                             Batching helper                                */
/* -------------------------------------------------------------------------- */
/**
 * Accumulates points in a ref and flushes every `intervalMs`. Returns a
 * stable `push` callback — fire it from inside `useGeolocationStream`.
 * The flush handler receives the pending batch; returning from it clears
 * the buffer regardless of success so errors don't pile points up forever.
 */
export function useBatchedFlush<T>(
  onFlush: (batch: T[]) => void,
  options: { enabled: boolean; intervalMs?: number },
): (item: T) => void {
  const { enabled, intervalMs = 3_000 } = options;
  const bufferRef = useRef<T[]>([]);
  const flushRef = useRef(onFlush);
  flushRef.current = onFlush;

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (bufferRef.current.length === 0) return;
      const batch = bufferRef.current;
      bufferRef.current = [];
      flushRef.current(batch);
    }, intervalMs);
    return () => {
      clearInterval(id);
      // Best-effort final flush so we don't drop points on unmount.
      if (bufferRef.current.length > 0) {
        const batch = bufferRef.current;
        bufferRef.current = [];
        flushRef.current(batch);
      }
    };
  }, [enabled, intervalMs]);

  return useCallback((item: T) => {
    bufferRef.current.push(item);
  }, []);
}

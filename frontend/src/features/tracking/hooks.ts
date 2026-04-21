/**
 * Tracking WS hooks — replace 10s polling on OrderDetailPage + PublicTrackPage.
 *
 * Per CLAUDE.md rule #10: realtime state flows through the TanStack Query
 * cache, NOT a separate Zustand store. Each incoming `WsMessage` updates
 * `['orders', id, 'track']` (or `['public-track', shareToken]`) via
 * `queryClient.setQueryData`, so consumers of `useOrderTrackQuery` keep
 * working unchanged.
 *
 * Socket lifecycle uses `ReconnectingWS` from `@/lib/ws` (exp. backoff,
 * heartbeat, token query-param). The hooks return a small `snapshot`
 * (state + tick counter + last status) so the page can show a live
 * status badge and decide whether to fall back to polling.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { env } from '@/lib/env';
import { ReconnectingWS, type WsState } from '@/lib/ws';
import { useAuthStore } from '@/store/auth';
import type { OrderTrackOut } from '@/features/orders/types';

import type {
  LatLng,
  PartnerLocationPoint,
  TrackingSocketSnapshot,
  WsDataMessage,
  WsMessage,
} from './types';

/* -------------------------------------------------------------------------- */
/*                           Query-cache update helper                        */
/* -------------------------------------------------------------------------- */
/**
 * Fold a single WS message into the `OrderTrackOut` cached snapshot.
 *
 * Kept as a pure function so it can be unit-tested without React. The
 * cache may be empty when the first message lands (the fallback
 * polling hasn't returned yet) — we seed a minimal skeleton in that
 * case so the page renders immediately.
 */
export function applyWsMessageToTrack(
  prev: OrderTrackOut | undefined,
  msg: WsDataMessage,
): OrderTrackOut {
  const base: OrderTrackOut = prev ?? {
    status: 'placed',
    events: [],
    partner_location: null,
    eta_minutes: null,
  };

  switch (msg.type) {
    case 'status': {
      return {
        ...base,
        status: msg.status,
        events: [
          ...base.events,
          { status: msg.status, note: msg.note ?? null, created_at: msg.at },
        ],
      };
    }
    case 'partner_location': {
      return {
        ...base,
        partner_location: { lat: msg.lat, lng: msg.lng },
      };
    }
    case 'eta': {
      return {
        ...base,
        eta_minutes: msg.minutes,
      };
    }
    case 'assignment': {
      // Seed restaurant coords if the page doesn't already have them.
      return {
        ...base,
        restaurant_lat: base.restaurant_lat ?? msg.pickup.lat,
        restaurant_lng: base.restaurant_lng ?? msg.pickup.lng,
        restaurant_name: base.restaurant_name ?? msg.pickup.name,
      };
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                      useOrderTrackingSocket (authed)                       */
/* -------------------------------------------------------------------------- */
/**
 * Subscribe to `/ws/orders/{id}` for the logged-in customer.
 *
 * Writes every data message into `['orders', 'track', id, false]` so
 * `useOrderTrackQuery(id)` consumers (stepper, map, ETA badge) re-render
 * without a round-trip. Returns a small snapshot the page can use to
 * show a pulsing "live" badge and fall back to polling when WS is dead.
 */
export function useOrderTrackingSocket(
  orderId: string | undefined,
): TrackingSocketSnapshot {
  const qc = useQueryClient();
  const [snapshot, setSnapshot] = useState<TrackingSocketSnapshot>({
    liveState: 'closed',
    lastTick: 0,
    lastStatus: null,
  });
  const wsRef = useRef<ReconnectingWS | null>(null);

  useEffect(() => {
    if (!orderId) return;
    const token = useAuthStore.getState().accessToken ?? undefined;

    const ws = new ReconnectingWS(`${env.WS_BASE_URL}/orders/${orderId}`, {
      ...(token ? { token } : {}),
      onOpen: () =>
        setSnapshot((s) => ({ ...s, liveState: 'open' })),
      onClose: () =>
        setSnapshot((s) => ({ ...s, liveState: 'closed' })),
      onError: () =>
        setSnapshot((s) => ({ ...s, liveState: 'reconnecting' })),
      onMessage: (raw) => {
        const msg = raw as WsMessage;
        if (msg.type === 'ping' || msg.type === 'pong') return;
        // Write into the authed track cache key (matches useOrderTrackQuery).
        qc.setQueryData<OrderTrackOut | undefined>(
          ['orders', 'track', orderId, false] as const,
          (prev) => applyWsMessageToTrack(prev, msg),
        );
        setSnapshot((s) => ({
          ...s,
          lastTick: s.lastTick + 1,
          lastStatus: msg.type === 'status' ? msg.status : s.lastStatus,
        }));
      },
    });
    wsRef.current = ws;

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [orderId, qc]);

  return snapshot;
}

/* -------------------------------------------------------------------------- */
/*                     usePublicTrackingSocket (no auth)                      */
/* -------------------------------------------------------------------------- */
/**
 * Subscribe to `/ws/public/track/{shareToken}` for an unauthenticated
 * share-link viewer. Writes into `['orders', 'track', token, true]` so
 * it shares cache shape with the polling fallback.
 *
 * We also mirror into `['public-track', shareToken]` to match the
 * per-Phase-4 design-doc key contract; both keys point at the same
 * `OrderTrackOut`, keeping whichever consumer the UI uses in sync.
 */
export function usePublicTrackingSocket(
  shareToken: string | undefined,
): TrackingSocketSnapshot {
  const qc = useQueryClient();
  const [snapshot, setSnapshot] = useState<TrackingSocketSnapshot>({
    liveState: 'closed',
    lastTick: 0,
    lastStatus: null,
  });
  const wsRef = useRef<ReconnectingWS | null>(null);

  useEffect(() => {
    if (!shareToken) return;

    const ws = new ReconnectingWS(
      `${env.WS_BASE_URL}/public/track/${shareToken}`,
      {
        onOpen: () =>
          setSnapshot((s) => ({ ...s, liveState: 'open' })),
        onClose: () =>
          setSnapshot((s) => ({ ...s, liveState: 'closed' })),
        onError: () =>
          setSnapshot((s) => ({ ...s, liveState: 'reconnecting' })),
        onMessage: (raw) => {
          const msg = raw as WsMessage;
          if (msg.type === 'ping' || msg.type === 'pong') return;
          // Write BOTH cache keys so any reader sees the update.
          qc.setQueryData<OrderTrackOut | undefined>(
            ['orders', 'track', shareToken, true] as const,
            (prev) => applyWsMessageToTrack(prev, msg),
          );
          qc.setQueryData<OrderTrackOut | undefined>(
            ['public-track', shareToken] as const,
            (prev) => applyWsMessageToTrack(prev, msg),
          );
          setSnapshot((s) => ({
            ...s,
            lastTick: s.lastTick + 1,
            lastStatus: msg.type === 'status' ? msg.status : s.lastStatus,
          }));
        },
      },
    );
    wsRef.current = ws;

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [shareToken, qc]);

  return snapshot;
}

/* -------------------------------------------------------------------------- */
/*                       WS-closed-more-than-N-seconds helper                 */
/* -------------------------------------------------------------------------- */
/**
 * Tracks how long the socket has been in `'closed'` state. Pages use this
 * to decide whether to enable the polling fallback when the WS never
 * opens (backend down, firewall, etc.) — threshold defaults to 5s.
 */
export function useWsClosedLongerThan(
  liveState: WsState,
  thresholdMs = 5_000,
): boolean {
  const [stale, setStale] = useState(false);
  const closedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (liveState === 'open') {
      closedAtRef.current = null;
      setStale(false);
      return;
    }
    if (liveState === 'closed' || liveState === 'reconnecting') {
      closedAtRef.current ??= Date.now();
      const timer = setTimeout(() => {
        if (closedAtRef.current !== null) setStale(true);
      }, thresholdMs);
      return () => clearTimeout(timer);
    }
    return;
  }, [liveState, thresholdMs]);

  return stale;
}

/* -------------------------------------------------------------------------- */
/*                             Haversine distance                             */
/* -------------------------------------------------------------------------- */
/**
 * Great-circle distance in kilometres between two lat/lng pairs.
 * R = 6371 km (mean Earth radius) — good enough for ETA estimation.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* -------------------------------------------------------------------------- */
/*                             useEtaEstimator                                */
/* -------------------------------------------------------------------------- */
const AVG_SPEED_KMH = 15; // conservative city delivery average
const ETA_MIN = 1;
const ETA_MAX = 90;

/**
 * Given recent partner locations + the current partner position + the
 * customer drop location, compute a coarse ETA in minutes using:
 *   distance_km / 15 kmh  * 60  → clamped [1, 90].
 *
 * We accept a `points` array for a future speed-weighted estimate but
 * currently just use the latest partner position. Returns `null` when
 * no partner location is known.
 */
export function useEtaEstimator(
  points: readonly PartnerLocationPoint[],
  partnerLoc: LatLng | null,
  dropLoc: LatLng | null,
): number | null {
  return useMemo(() => {
    const latest =
      partnerLoc ?? (points.length > 0 ? points[points.length - 1] ?? null : null);
    if (!latest || !dropLoc) return null;
    const km = haversineKm(latest, dropLoc);
    const minutes = (km / AVG_SPEED_KMH) * 60;
    const clamped = Math.max(ETA_MIN, Math.min(ETA_MAX, Math.round(minutes)));
    return clamped;
  }, [points, partnerLoc, dropLoc]);
}

/* -------------------------------------------------------------------------- */
/*                       Partner trail (last N points)                        */
/* -------------------------------------------------------------------------- */
/**
 * Small helper hook that keeps a rolling buffer of the last N partner
 * positions pulled off the live cache. Used by `LiveTrackingMap` to
 * draw a faded polyline trail behind the courier marker.
 */
export function usePartnerTrail(
  current: LatLng | null,
  max = 10,
): readonly LatLng[] {
  const [trail, setTrail] = useState<LatLng[]>([]);

  const push = useCallback(
    (p: LatLng) => {
      setTrail((prev) => {
        const last = prev[prev.length - 1];
        // Skip dupes — partner_location frames can repeat when stationary.
        if (last && last.lat === p.lat && last.lng === p.lng) return prev;
        const next = [...prev, p];
        if (next.length > max) next.splice(0, next.length - max);
        return next;
      });
    },
    [max],
  );

  useEffect(() => {
    if (current) push(current);
  }, [current, push]);

  return trail;
}

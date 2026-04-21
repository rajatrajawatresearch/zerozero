/**
 * Tracking feature — WebSocket message + snapshot types.
 *
 * Mirrors backend `WsMessage` discriminated union from
 * `docs/PHASE4_CONTRACTS.md` exactly. Field names stay snake_case /
 * wire-native so messages can be fed straight from `JSON.parse` without
 * any adapter layer — same principle as `features/orders/types.ts`.
 *
 * The `ConnectionPoint` / `PartnerLoc` helpers are used by the ETA
 * estimator hook and the interpolated map marker.
 */
import type { OrderStatus } from '@/features/orders/types';
import type { WsState } from '@/lib/ws';

/* -------------------------------------------------------------------------- */
/*                            Wire-message variants                           */
/* -------------------------------------------------------------------------- */
export interface WsStatusMsg {
  type: 'status';
  status: OrderStatus;
  note?: string;
  at: string;
}

export interface WsPartnerLocationMsg {
  type: 'partner_location';
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  at: string;
}

export interface WsEtaMsg {
  type: 'eta';
  minutes: number;
  at: string;
}

export interface WsAssignmentMsg {
  type: 'assignment';
  order_id: string;
  pickup: { lat: number; lng: number; name: string };
  drop: { lat: number; lng: number; label: string };
  at: string;
}

export interface WsPingMsg {
  type: 'ping';
}

export interface WsPongMsg {
  type: 'pong';
}

/** Full discriminated union — matches backend contract. */
export type WsMessage =
  | WsStatusMsg
  | WsPartnerLocationMsg
  | WsEtaMsg
  | WsAssignmentMsg
  | WsPingMsg
  | WsPongMsg;

/** Narrow helper: messages the UI actually cares about (drops ping/pong). */
export type WsDataMessage =
  | WsStatusMsg
  | WsPartnerLocationMsg
  | WsEtaMsg
  | WsAssignmentMsg;

/* -------------------------------------------------------------------------- */
/*                               Helper shapes                                */
/* -------------------------------------------------------------------------- */
export interface LatLng {
  lat: number;
  lng: number;
}

/** A partner location sample with an ISO timestamp. */
export interface PartnerLocationPoint extends LatLng {
  at: string;
  heading?: number;
  speed?: number;
}

/**
 * Public snapshot surfaced by `useOrderTrackingSocket` /
 * `usePublicTrackingSocket` on top of the TanStack cache. Pages read
 * `liveState` to decide whether the fallback polling should kick in.
 */
export interface TrackingSocketSnapshot {
  /** Latest socket state (connecting / open / closed / reconnecting). */
  liveState: WsState;
  /** Monotonic counter — bumped on every inbound data message; drives UI pulses. */
  lastTick: number;
  /** Latest status message received (if any). */
  lastStatus: OrderStatus | null;
}

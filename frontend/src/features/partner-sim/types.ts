/**
 * Partner simulator TS shapes — mirrors the dev-only `/partner/*` surface
 * described in `docs/PHASE4_CONTRACTS.md`.
 *
 * Wire format stays snake_case to match backend Pydantic v2 models. All
 * money, timestamps and geo fields follow the same conventions used
 * elsewhere in the app (ISO-8601 strings, decimal-string money, WGS84).
 */
import type { LatLng } from '@/types';
import type { OrderStatus } from '@/features/orders/types';

/* -------------------------------------------------------------------------- */
/*                               Online payload                               */
/* -------------------------------------------------------------------------- */
/** Body for POST /partner/online — flips partner availability on. */
export interface PartnerOnlineIn {
  lat: number;
  lng: number;
}

/** Server ack after a successful `online` call. */
export interface PartnerOnlineOut {
  is_online: boolean;
  since: string;
}

/* -------------------------------------------------------------------------- */
/*                              Location batching                             */
/* -------------------------------------------------------------------------- */
/**
 * One breadcrumb sample. `recorded_at` lets the server timestamp the point
 * at capture-time rather than arrival-time so batched replays order
 * correctly even when the network lags.
 */
export interface PartnerLocationPoint extends LatLng {
  recorded_at: string;
  heading?: number | null;
  speed?: number | null;
  accuracy?: number | null;
}

/** Body for POST /partner/location — batched points. */
export interface PartnerLocationBatchIn {
  points: PartnerLocationPoint[];
}

/* -------------------------------------------------------------------------- */
/*                               Status payload                               */
/* -------------------------------------------------------------------------- */
/** Backend accepts status as a `?s=` query param; we type the allowed set. */
export type PartnerStatusStep = Extract<
  OrderStatus,
  'confirmed' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered'
>;

/** Canonical stepper ordering — index determines "already past" button state. */
export const PARTNER_STATUS_STEPS = [
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
] as const satisfies readonly PartnerStatusStep[];

/* -------------------------------------------------------------------------- */
/*                              Geolocation utils                             */
/* -------------------------------------------------------------------------- */
/** Minimal cross-tab geolocation point shape used by the streamer hooks. */
export interface StreamPoint extends LatLng {
  at: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
}

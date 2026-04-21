/**
 * Orders feature TS mirrors of backend Pydantic v2 schemas.
 *
 * Wire format is snake_case exactly as the backend serialises it — keeping the
 * TanStack Query cache a faithful view of the server response avoids any
 * adapter layer between `api.ts` and consumers.
 *
 * Contract source: `docs/PHASE3_CONTRACTS.md` — "Orders" section.
 * Money is shipped as decimal strings (`Numeric(12,2)`) to avoid JS float
 * rounding; parse at render time with `formatPrice` (imported from
 * `@/features/restaurants`).
 */
import type { MoneyAmount } from '@/types';
import type { Address } from '@/features/location/types';

/* -------------------------------------------------------------------------- */
/*                                   Enums                                    */
/* -------------------------------------------------------------------------- */
/**
 * Mirrors backend `OrderStatus` enum. Kept local (not re-exported from
 * `@/types`) so it stays in sync with the Phase 3 backend model — the global
 * types file was a Phase 1 stub.
 */
export type OrderStatus =
  | 'placed'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'failed';

export type PaymentMethod = 'card' | 'upi' | 'wallet' | 'cod';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

/* -------------------------------------------------------------------------- */
/*                          Ordered progression steps                         */
/* -------------------------------------------------------------------------- */
/**
 * Canonical progression of an in-progress order (drives the stepper).
 * `cancelled` / `failed` are terminal side-branches, not part of the trail.
 */
export const ORDER_PROGRESS_STEPS = [
  'placed',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
] as const satisfies readonly OrderStatus[];

/** Narrowed status type — only the 6 progression steps. */
export type OrderProgressStep = (typeof ORDER_PROGRESS_STEPS)[number];

/** Active statuses — shown on the "Active" tab in OrdersListPage. */
export const ACTIVE_STATUSES: readonly OrderStatus[] = [
  'placed',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
] as const;

/** Statuses where a cancel is still allowed (matches backend rule). */
export const CANCELLABLE_STATUSES: readonly OrderStatus[] = [
  'placed',
  'confirmed',
] as const;

/* -------------------------------------------------------------------------- */
/*                                 Order items                                */
/* -------------------------------------------------------------------------- */
export interface OrderItemOut {
  id: string;
  menu_item_id: string;
  name_snapshot: string;
  price_snapshot: MoneyAmount;
  qty: number;
  options: Record<string, unknown> | null;
}

/* -------------------------------------------------------------------------- */
/*                                Status events                               */
/* -------------------------------------------------------------------------- */
export interface OrderStatusEventOut {
  status: OrderStatus;
  note: string | null;
  created_at: string;
}

/* -------------------------------------------------------------------------- */
/*                                List / detail                               */
/* -------------------------------------------------------------------------- */
export interface OrderListItem {
  id: string;
  short_id: string;
  restaurant_name: string;
  restaurant_image: string | null;
  total: MoneyAmount;
  item_count: number;
  status: OrderStatus;
  placed_at: string;
  delivered_at: string | null;
}

export interface OrderDetailOut extends OrderListItem {
  items: OrderItemOut[];
  address: Address;
  subtotal: MoneyAmount;
  discount: MoneyAmount;
  delivery_fee: MoneyAmount;
  tax: MoneyAmount;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  promo_code: string | null;
  notes: string | null;
  share_token: string;
  events: OrderStatusEventOut[];
}

/* -------------------------------------------------------------------------- */
/*                              Lightweight track                              */
/* -------------------------------------------------------------------------- */
export interface OrderTrackOut {
  status: OrderStatus;
  events: OrderStatusEventOut[];
  /** {lat, lng} or null when courier hasn't started moving. */
  partner_location: { lat: number; lng: number } | null;
  eta_minutes: number | null;
  /** Present on public track endpoint so the map can show restaurant pin. */
  restaurant_lat?: number;
  restaurant_lng?: number;
  restaurant_name?: string;
}

/* -------------------------------------------------------------------------- */
/*                                  Reviews                                   */
/* -------------------------------------------------------------------------- */
export interface ReviewIn {
  rating: number;
  comment?: string | null;
}

export interface ReviewOut {
  id: string;
  order_id: string;
  user_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

/* -------------------------------------------------------------------------- */
/*                             Pagination envelope                            */
/* -------------------------------------------------------------------------- */
export interface PageOut<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  has_next: boolean;
}

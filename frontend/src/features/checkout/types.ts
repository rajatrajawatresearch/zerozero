/**
 * Checkout feature TS mirrors of backend Pydantic v2 schemas.
 *
 * Wire format is snake_case exactly as the backend serialises it — matching
 * `docs/PHASE3_CONTRACTS.md` > Orders section. UI-facing code should treat
 * these as read-only DTOs; any domain-shaped camelCase objects live in
 * `@/types` (`Order`, `OrderItem`, …) for shared store code.
 *
 * We purposefully DO NOT re-declare the shared enums (`PaymentMethod`,
 * `OrderStatus`, `PaymentStatus`) — we import from `@/types` to keep one
 * canonical source. Only the wire-shape DTOs specific to checkout live here.
 */
import type {
  MoneyAmount,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@/types';
import type { Address } from '@/features/location';

/* -------------------------------------------------------------------------- */
/*                          Checkout request payload                          */
/* -------------------------------------------------------------------------- */
/** Payload for POST /orders — matches backend `CheckoutIn`. */
export interface CheckoutIn {
  address_id: string;
  payment_method: PaymentMethod;
  promo_code?: string | null;
  notes?: string | null;
}

/* -------------------------------------------------------------------------- */
/*                              Promo validation                              */
/* -------------------------------------------------------------------------- */
/** Payload for POST /promos/validate. */
export interface PromoValidateIn {
  code: string;
  subtotal: MoneyAmount;
}

/** Response shape from POST /promos/validate. */
export interface PromoValidateOut {
  code: string;
  valid: boolean;
  /** Decimal string — zero when `valid=false`. */
  discount: MoneyAmount;
  /** One of `"expired" | "min_order" | "usage_exceeded"` or null. */
  reason: string | null;
  free_delivery: boolean;
}

/* -------------------------------------------------------------------------- */
/*                             Order detail (wire)                            */
/* -------------------------------------------------------------------------- */
/** A line item on an order, as served by the backend. */
export interface OrderItemOut {
  id: string;
  menu_item_id: string;
  name_snapshot: string;
  price_snapshot: MoneyAmount;
  qty: number;
  options: Record<string, unknown> | null;
}

/** Status-event embedded in `OrderDetailOut.events`. */
export interface OrderStatusEventOut {
  status: OrderStatus;
  note: string | null;
  created_at: string;
}

/**
 * Response shape for POST /orders (and GET /orders/{id}).
 *
 * We include enough of it here for the checkout success-redirect to pluck
 * `id` + `short_id` and push the user into `/orders/:id?new=1`. Agent 9
 * (FE-Orders) owns the richer list/detail pages and may re-declare or
 * extend this type in its own slice.
 */
export interface OrderDetailOut {
  id: string;
  short_id: string;
  restaurant_name: string;
  restaurant_image: string | null;
  total: MoneyAmount;
  item_count: number;
  status: OrderStatus;
  placed_at: string;
  delivered_at: string | null;

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
/*                              Stepper + UI state                            */
/* -------------------------------------------------------------------------- */
/** Ordered slugs of the 3 checkout steps, used for the `StepIndicator`. */
export const CHECKOUT_STEPS = ['address', 'payment', 'review'] as const;
export type CheckoutStep = (typeof CHECKOUT_STEPS)[number];

/**
 * The promo payload cached after a successful validation — drives the
 * review-step summary line and sticks across `payment → review` toggles.
 */
export interface AppliedPromo {
  code: string;
  discount: MoneyAmount;
  free_delivery: boolean;
}

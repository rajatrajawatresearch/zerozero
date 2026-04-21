/**
 * Cart feature TS mirrors of backend Pydantic v2 schemas.
 *
 * Wire format is snake_case — the `api.ts` layer calls these directly,
 * while `hooks.ts` projects the dual (server + guest) view into a single
 * camelCase-ish shape that the UI consumes. Contract source:
 * `docs/PHASE3_CONTRACTS.md` — Cart section.
 */
import type { MoneyAmount } from '@/types';

/* -------------------------------------------------------------------------- */
/*                                Menu item brief                             */
/* -------------------------------------------------------------------------- */
/**
 * `MenuItemBrief` — denormalised menu-item view returned inside `CartItemOut`.
 * Keeps the UI from having to fetch the full menu to render line rows.
 */
export interface MenuItemBrief {
  id: string;
  restaurant_id: string;
  name: string;
  price: MoneyAmount;
  image_url: string | null;
  is_veg: boolean;
  is_available: boolean;
}

/* -------------------------------------------------------------------------- */
/*                                   Inputs                                    */
/* -------------------------------------------------------------------------- */
/** `CartItemIn` — body for POST /cart/items and PATCH /cart/items/{id}. */
export interface CartItemIn {
  menu_item_id: string;
  qty: number;
  options?: Record<string, unknown> | null;
}

/** Patch shape — qty is the only mutable field per contract. */
export interface CartItemPatchIn {
  qty: number;
}

/* -------------------------------------------------------------------------- */
/*                                   Outputs                                   */
/* -------------------------------------------------------------------------- */
/**
 * `CartItemOut` — single server-side cart line row. `line_total` is the
 * price snapshot × qty and ships as a Decimal string to avoid float drift.
 */
export interface CartItemOut {
  id: string;
  restaurant_id: string;
  menu_item_id: string;
  qty: number;
  options: Record<string, unknown> | null;
  item: MenuItemBrief;
  line_total: MoneyAmount;
}

/**
 * `CartOut` — the user's current cart. Single-restaurant invariant is
 * enforced server-side; adding from a different restaurant replaces the
 * cart and returns an `X-Cart-Replaced: true` response header.
 */
export interface CartOut {
  restaurant_id: string | null;
  restaurant_name: string | null;
  items: CartItemOut[];
  subtotal: MoneyAmount;
  item_count: number;
}

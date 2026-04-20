/**
 * Shared TypeScript types used across stores, API clients, and features.
 *
 * These are intentionally coarse for Phase 1; Phase 2+ will refine or
 * generate more from the backend's OpenAPI contract. Everything here
 * must match the shapes described in `docs/AGENT_CONTRACTS.md` and
 * `contracts/openapi.yaml` (source of truth).
 */

/* -------------------------------------------------------------------------- */
/*                                   Enums                                    */
/* -------------------------------------------------------------------------- */
export type UserRole = 'customer' | 'partner' | 'owner' | 'admin';

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

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemeRadius = 'sm' | 'md' | 'lg';

/* -------------------------------------------------------------------------- */
/*                                   Money                                    */
/* -------------------------------------------------------------------------- */
/**
 * Money is serialised as a decimal string from the backend (Numeric(12,2))
 * to avoid JS float rounding; client code may parse to number only at the
 * last render step. Phase 2 helpers will centralise formatting.
 */
export type MoneyAmount = string;

/* -------------------------------------------------------------------------- */
/*                                Geo / Location                              */
/* -------------------------------------------------------------------------- */
export interface LatLng {
  lat: number;
  lng: number;
}

export interface LocationPoint extends LatLng {
  /** Human-readable label — "Home", "Office", or a geocoded string. */
  label: string;
}

export interface Address {
  id: string;
  userId: string;
  label: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  pincode: string;
  lat: number;
  lng: number;
  isDefault: boolean;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/*                                    User                                    */
/* -------------------------------------------------------------------------- */
export interface User {
  id: string;
  email: string;
  phone?: string;
  fullName: string;
  role: UserRole;
  avatarUrl?: string;
  emailVerified: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthSession extends AuthTokens {
  user: User;
}

/* -------------------------------------------------------------------------- */
/*                           Restaurants / Menu stubs                         */
/* -------------------------------------------------------------------------- */
export interface Cuisine {
  id: string;
  name: string;
  slug: string;
  icon?: string;
  isVegOnly: boolean;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon?: string;
  sortOrder: number;
}

export interface Restaurant {
  id: string;
  name: string;
  slug: string;
  description?: string;
  cuisines: string[];
  addressText: string;
  lat: number;
  lng: number;
  deliveryRadiusM: number;
  minOrder: MoneyAmount;
  deliveryFeeBase: MoneyAmount;
  avgPrepMinutes: number;
  ratingAvg: number;
  ratingCount: number;
  imageUrl?: string;
  coverUrl?: string;
  opensAt: string;
  closesAt: string;
  isActive: boolean;
  isFeatured: boolean;
}

export interface MenuItemVariant {
  name: string;
  priceDelta: MoneyAmount;
}

export interface MenuItem {
  id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  description?: string;
  price: MoneyAmount;
  imageUrl?: string;
  isVeg: boolean;
  isAvailable: boolean;
  tags: string[];
  variants: MenuItemVariant[];
  sortOrder: number;
}

/* -------------------------------------------------------------------------- */
/*                                     Cart                                   */
/* -------------------------------------------------------------------------- */
/**
 * Client-side cart line. Mirrors `cart_items` table columns needed by UI.
 * `clientId` is a local uuid used for React keys and optimistic updates
 * before the server assigns the real `id`.
 */
export interface CartLine {
  clientId: string;
  id?: string;
  menuItemId: string;
  restaurantId: string;
  name: string;
  price: MoneyAmount;
  qty: number;
  options: Record<string, string | number | boolean>;
  imageUrl?: string;
}

/* -------------------------------------------------------------------------- */
/*                                   Orders                                   */
/* -------------------------------------------------------------------------- */
export interface OrderItem {
  id: string;
  menuItemId: string;
  nameSnapshot: string;
  priceSnapshot: MoneyAmount;
  qty: number;
  options: Record<string, string | number | boolean>;
}

export interface OrderStatusEvent {
  id: string;
  status: OrderStatus;
  note?: string;
  createdAt: string;
}

export interface Order {
  id: string;
  userId: string;
  restaurantId: string;
  addressId: string;
  partnerId?: string;
  status: OrderStatus;
  subtotal: MoneyAmount;
  discount: MoneyAmount;
  deliveryFee: MoneyAmount;
  tax: MoneyAmount;
  total: MoneyAmount;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  promoCode?: string;
  placedAt: string;
  deliveredAt?: string;
  cancelledAt?: string;
  notes?: string;
  shareToken: string;
  items: OrderItem[];
  events: OrderStatusEvent[];
}

/* -------------------------------------------------------------------------- */
/*                             WebSocket message shapes                       */
/* -------------------------------------------------------------------------- */
export type OrderWsEvent =
  | { type: 'status'; status: OrderStatus; note?: string; at: string }
  | {
      type: 'partner_location';
      lat: number;
      lng: number;
      heading?: number;
      speed?: number;
      at: string;
    }
  | { type: 'eta'; minutes: number }
  | { type: 'ping' }
  | { type: 'pong' };

/* -------------------------------------------------------------------------- */
/*                           API response envelope stubs                      */
/* -------------------------------------------------------------------------- */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiErrorPayload {
  detail: string;
  code?: string;
}

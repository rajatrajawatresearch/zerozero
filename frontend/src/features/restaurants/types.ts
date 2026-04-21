/**
 * Restaurant feature types — mirror the backend Pydantic v2 schemas from
 * `backend/app/schemas/restaurant.py` exactly.
 *
 * Contract reference: `docs/PHASE2_CONTRACTS.md` — "Restaurants" section.
 * Money values ship as decimal strings (Numeric(12,2)) to avoid JS float
 * rounding; parse at render time via `useFormattedPrice`.
 */
import type { MoneyAmount } from '@/types';

/* -------------------------------------------------------------------------- */
/*                                  Taxonomies                                */
/* -------------------------------------------------------------------------- */
export interface Cuisine {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  is_veg_only: boolean;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  sort_order: number;
}

/* -------------------------------------------------------------------------- */
/*                                 Restaurants                                */
/* -------------------------------------------------------------------------- */
export interface RestaurantCard {
  id: string;
  slug: string;
  name: string;
  cover_url: string | null;
  cuisines: Cuisine[];
  rating_avg: MoneyAmount;
  rating_count: number;
  avg_prep_minutes: number;
  /** null when lat/lng not supplied to the list query. */
  distance_km: number | null;
  /** null when lat/lng not supplied to the list query. */
  delivers_here: boolean;
  is_open: boolean;
  min_order: MoneyAmount;
  delivery_fee_base: MoneyAmount;
}

export interface RestaurantDetail extends RestaurantCard {
  description: string | null;
  image_url: string | null;
  address_text: string;
  lat: number;
  lng: number;
  /** "HH:mm:ss" — backend `time` serialised. */
  opens_at: string;
  /** "HH:mm:ss" — backend `time` serialised. */
  closes_at: string;
  is_featured: boolean;
}

/* -------------------------------------------------------------------------- */
/*                                    Menu                                    */
/* -------------------------------------------------------------------------- */
export interface MenuItemVariant {
  name: string;
  price_delta: MoneyAmount;
}

export interface MenuItemOut {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: MoneyAmount;
  image_url: string | null;
  is_veg: boolean;
  is_available: boolean;
  tags: string[];
  variants: MenuItemVariant[] | null;
}

export interface MenuCategoryOut {
  category: Category;
  items: MenuItemOut[];
}

export interface RestaurantMenu {
  restaurant_id: string;
  categories: MenuCategoryOut[];
}

/* -------------------------------------------------------------------------- */
/*                                Pagination                                  */
/* -------------------------------------------------------------------------- */
export interface PageOut<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  has_next: boolean;
}

/* -------------------------------------------------------------------------- */
/*                              List query params                             */
/* -------------------------------------------------------------------------- */
export type SortOption = 'distance' | 'rating' | 'popular' | 'new';

export interface RestaurantListParams {
  lat?: number;
  lng?: number;
  /** Cuisine slugs. Serialised as a comma-separated string for the `cuisine` param. */
  cuisine?: string[];
  q?: string;
  veg?: boolean;
  sort?: SortOption;
  page?: number;
  pageSize?: number;
}

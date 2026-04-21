/**
 * Search feature types — mirror the Pydantic v2 schemas from
 * `backend/app/schemas/search.py` exactly, per `docs/PHASE3_CONTRACTS.md`
 * (Search section).
 *
 *   GET /search?q=&lat=&lng=&type= -> SearchResults
 *
 * `restaurants` reuses the shared `RestaurantCard` DTO from the Restaurants
 * slice so the row renderer can lean on existing formatting helpers.
 */
import type { MoneyAmount } from '@/types';
import type { RestaurantCard } from '@/features/restaurants/types';

/* -------------------------------------------------------------------------- */
/*                               Restaurant brief                             */
/* -------------------------------------------------------------------------- */
/**
 * Slim restaurant projection attached to each menu-item hit. Enough fields
 * for the result row to show a thumb + name and link back to the menu.
 */
export interface RestaurantBrief {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
}

/* -------------------------------------------------------------------------- */
/*                              Menu-item hit                                 */
/* -------------------------------------------------------------------------- */
export interface MenuItemSearchHit {
  id: string;
  name: string;
  price: MoneyAmount;
  image_url: string | null;
  is_veg: boolean;
  restaurant: RestaurantBrief;
}

/* -------------------------------------------------------------------------- */
/*                              Search results                                */
/* -------------------------------------------------------------------------- */
export interface SearchResults {
  restaurants: RestaurantCard[];
  menu_items: MenuItemSearchHit[];
}

/* -------------------------------------------------------------------------- */
/*                               Query params                                 */
/* -------------------------------------------------------------------------- */
export type SearchResultType = 'all' | 'restaurant' | 'menu_item';

export interface SearchParams {
  /** Optional latitude — when provided the backend filters by ST_DWithin. */
  lat?: number;
  /** Optional longitude — paired with `lat`. */
  lng?: number;
  /** Narrow the result scope; defaults to "all" server-side. */
  type?: SearchResultType;
}

/**
 * Public barrel for the Restaurants feature slice.
 *
 * Stable surface area consumed by Agent 10 (FE-Layout) and siblings:
 *   - `RestaurantGrid` + `FilterSidebar` compose the HomePage body
 *   - `restaurantRoutes` is merged into the root route table
 *   - Cards/skeletons are re-exported in case the layout wants to render
 *     its own subset (e.g. a "recommended" rail on the home hero)
 *
 * Pages are intentionally NOT re-exported here — they are code-split via
 * `routes.tsx` so they never land in the main bundle.
 */
export * from './types';
export * from './api';
export * from './hooks';

export { RestaurantCard } from './components/RestaurantCard';
export { RestaurantCardSkeleton } from './components/RestaurantCardSkeleton';
export { RestaurantGrid } from './components/RestaurantGrid';
export { FilterSidebar } from './components/FilterSidebar';
export { RatingBadge } from './components/RatingBadge';
export { CuisineChip } from './components/CuisineChip';
export { MenuItemCard } from './components/MenuItemCard';
export { MenuCategory } from './components/MenuCategory';

export { restaurantRoutes } from './routes';

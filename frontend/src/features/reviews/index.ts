/**
 * Public barrel for the Reviews feature slice.
 *
 * Reviews are surfaced as a section inside the existing restaurant detail
 * page — the slice intentionally ships **no** routes. Agent 10 (this agent)
 * mounts `<ReviewList />` into `RestaurantDetailPage` directly.
 *
 * `StarRating` is re-exported so other surfaces (home featured rail, search
 * results) can reuse the display without duplicating the fractional-fill
 * trick.
 */
export * from './types';
export * from './api';

export { ReviewList } from './components/ReviewList';
export { ReviewCard } from './components/ReviewCard';
export { StarRating } from './components/StarRating';
export { AggregateRating } from './components/AggregateRating';

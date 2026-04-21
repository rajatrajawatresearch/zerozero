/**
 * Public barrel for the Search feature slice.
 *
 * Stable surface consumed by:
 *   - The app shell / Header, which mounts `<GlobalSearchPalette />` and
 *     registers the `useGlobalSearchShortcut` cmd-K listener
 *   - The root route table, which spreads `searchRoutes` to wire `/search`
 *
 * Internals (the individual result rows, the `SearchEmpty` state) are
 * re-exported so sibling features can reuse them in context (e.g. showing
 * menu-item hits inside a restaurant detail modal later on).
 */
export * from './types';
export * from './api';
export * from './hooks';

export { GlobalSearchPalette } from './components/GlobalSearchPalette';
export { SearchResultRestaurant } from './components/SearchResultRestaurant';
export { SearchResultMenuItem } from './components/SearchResultMenuItem';
export { SearchEmpty } from './components/SearchEmpty';

export { searchRoutes } from './routes';

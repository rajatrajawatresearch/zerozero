/**
 * Public barrel for the Orders feature slice.
 *
 * Stable surface area consumed by Agent 10 (FE-Layout) and siblings:
 *  - `orderRoutes` is merged into the root route table
 *  - `OrderCard` is re-exported so the layout can show a "recent orders" rail
 *  - `OrderStatusStepper` and `TrackingMap` are re-exported for reuse in
 *    Agent 8's checkout confirmation screen
 *
 * Pages are intentionally NOT re-exported here — they are code-split via
 * `routes.tsx` so they never land in the main bundle.
 */
export * from './types';
export * from './api';
export * from './hooks';

/* -------------------------------------------------------------------------- */
/*                                Components                                  */
/* -------------------------------------------------------------------------- */
export { OrderCard } from './components/OrderCard';
export { OrderItemsList } from './components/OrderItemsList';
export { OrderStatusStepper } from './components/OrderStatusStepper';
export { OrderSummaryBox } from './components/OrderSummaryBox';
export { CancelButton } from './components/CancelButton';
export { ReviewModal } from './components/ReviewModal';
export { TrackingMap } from './components/TrackingMap';

/* -------------------------------------------------------------------------- */
/*                                   Routes                                   */
/* -------------------------------------------------------------------------- */
export { orderRoutes } from './routes';

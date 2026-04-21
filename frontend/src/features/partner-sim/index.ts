/**
 * Public barrel for the Partner Simulator feature slice (Phase 4 Agent 8).
 *
 * Consumers:
 *  - Agent 10 (FE-Layout) imports `partnerSimRoutes` and merges it into the
 *    root route table at `features/routes.tsx`.
 *  - No other feature should import from here — the simulator is fully
 *    self-contained and lives behind the `/dev/partner` role gate.
 */
export * from './types';
export * from './api';
export * from './hooks';

/* -------------------------------------------------------------------------- */
/*                                Components                                  */
/* -------------------------------------------------------------------------- */
export { AssignmentCard } from './components/AssignmentCard';
export { LocationStreamer } from './components/LocationStreamer';
export { RouteSimulator } from './components/RouteSimulator';
export { StatusButtons } from './components/StatusButtons';

/* -------------------------------------------------------------------------- */
/*                                   Routes                                   */
/* -------------------------------------------------------------------------- */
export { partnerSimRoutes } from './routes';

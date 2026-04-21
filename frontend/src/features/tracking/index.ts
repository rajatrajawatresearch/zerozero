/**
 * Public barrel for the Tracking feature slice (Phase 4).
 *
 * Consumed by the Orders slice (OrderDetailPage, PublicTrackPage) to
 * upgrade the v1 10s polling into a WebSocket-driven live feed. The
 * hooks write through the TanStack Query cache (CLAUDE.md rule #10),
 * so existing `useOrderTrackQuery` readers continue to work unchanged
 * and the socket + polling paths can coexist for graceful fallback.
 */
export * from './types';
export {
  useOrderTrackingSocket,
  usePublicTrackingSocket,
  useEtaEstimator,
  useWsClosedLongerThan,
  usePartnerTrail,
  haversineKm,
  applyWsMessageToTrack,
} from './hooks';
export { LiveTrackingMap } from './components/LiveTrackingMap';
export { LiveStatusBadge } from './components/LiveStatusBadge';
export { EtaBadge } from './components/EtaBadge';

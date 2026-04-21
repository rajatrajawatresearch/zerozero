/**
 * Upgraded tracking map — Phase 4.
 *
 * What makes it "live" vs the v1 `TrackingMap`:
 *   1. Animated courier marker: we lerp (linear-interpolate) between the
 *      previous and incoming partner position over 3s — gives a smooth
 *      glide instead of a teleport on every WS tick.
 *   2. Polyline trail of the last 10 partner points behind the marker,
 *      fading to the past so the user sees the direction of travel.
 *   3. Pickup + drop pins rendered as coloured `divIcon`s so they read
 *      clearly against the map tiles without needing extra marker PNGs.
 *
 * Map lib + CSS import stay exactly the same as the existing
 * `features/orders/components/TrackingMap.tsx` so the Leaflet default
 * icon fix (module-scope `L.Icon.Default.mergeOptions`) continues to
 * work for any other markers the user may add later.
 */
import 'leaflet/dist/leaflet.css';

import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
} from 'react-leaflet';
import { Bike, MapPin as MapPinIcon } from 'lucide-react';

import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

import { env } from '@/lib/env';
import { cn } from '@/lib/utils';

import { usePartnerTrail } from '../hooks';
import type { LatLng } from '../types';

// Module-scope Leaflet icon fix (idempotent — same pattern as v1 TrackingMap).
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

/* -------------------------------------------------------------------------- */
/*                             Pin divIcon factory                            */
/* -------------------------------------------------------------------------- */
/**
 * Builds a small pill-shaped HTML marker. Uses OKLCH theme variables via
 * Tailwind classes — no hardcoded hex (CLAUDE.md rule #8).
 */
function pillIcon(label: string, kind: 'pickup' | 'drop' | 'partner'): L.DivIcon {
  const colour =
    kind === 'pickup'
      ? 'bg-primary text-primary-foreground'
      : kind === 'drop'
        ? 'bg-success text-success-foreground'
        : 'bg-accent text-accent-foreground';
  const html = `<div class="flex items-center gap-1 rounded-full border border-border ${colour} px-2 py-0.5 text-[10px] font-semibold shadow-md whitespace-nowrap">${label}</div>`;
  return L.divIcon({
    html,
    className: 'zz-live-pin',
    iconSize: [60, 20],
    iconAnchor: [30, 10],
  });
}

/**
 * The courier marker — a bike emoji-ish glyph inside a rotating puck.
 * Rotation uses CSS variable `--heading` so we can update it without
 * recreating the marker each tick.
 */
function courierIcon(): L.DivIcon {
  const html = `<div class="zz-courier-puck flex size-9 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg ring-2 ring-background" style="transform: rotate(var(--heading, 0deg));">
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm-3 11.5V14l-3-3 4-3 2 3h2"/></svg>
  </div>`;
  return L.divIcon({
    html,
    className: 'zz-courier-icon',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

/* -------------------------------------------------------------------------- */
/*                              Fit-bounds helper                             */
/* -------------------------------------------------------------------------- */
function FitBounds({
  pickup,
  drop,
  partner,
}: {
  pickup: LatLng | null;
  drop: LatLng | null;
  partner: LatLng | null;
}) {
  const map = useMap();

  useEffect(() => {
    const pts: L.LatLngTuple[] = [];
    if (pickup) pts.push([pickup.lat, pickup.lng]);
    if (drop) pts.push([drop.lat, drop.lng]);
    if (partner) pts.push([partner.lat, partner.lng]);
    if (pts.length === 0) return;
    const [only] = pts;
    if (pts.length === 1 && only) {
      map.setView(only, 15, { animate: true });
      return;
    }
    map.fitBounds(pts, { padding: [48, 48], animate: true });
  }, [map, pickup, drop, partner]);

  return null;
}

/* -------------------------------------------------------------------------- */
/*                    Lerp hook — smooth courier marker glide                 */
/* -------------------------------------------------------------------------- */
const LERP_DURATION_MS = 3_000;

/**
 * Animates the courier marker position: given a `target` lat/lng, we
 * interpolate from the previous rendered position to the new target over
 * `LERP_DURATION_MS` using `requestAnimationFrame`. Returns `null` until
 * the first target arrives.
 */
function useLerpedPosition(target: LatLng | null): LatLng | null {
  const [rendered, setRendered] = useState<LatLng | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<{ from: LatLng; to: LatLng; t0: number } | null>(null);

  useEffect(() => {
    if (!target) return;
    // First frame ever — snap immediately, skip interpolation.
    if (!rendered) {
      setRendered(target);
      return;
    }
    // Already at the target — nothing to animate.
    if (rendered.lat === target.lat && rendered.lng === target.lng) return;

    startRef.current = { from: rendered, to: target, t0: performance.now() };

    const tick = (now: number) => {
      const state = startRef.current;
      if (!state) return;
      const progress = Math.min(1, (now - state.t0) / LERP_DURATION_MS);
      const lat = state.from.lat + (state.to.lat - state.from.lat) * progress;
      const lng = state.from.lng + (state.to.lng - state.from.lng) * progress;
      setRendered({ lat, lng });
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        startRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // We intentionally depend only on target.lat/lng — `rendered` is read
    // via closure but including it would restart the animation every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.lat, target?.lng]);

  return rendered;
}

/* -------------------------------------------------------------------------- */
/*                                   Props                                    */
/* -------------------------------------------------------------------------- */
export interface LiveTrackingMapProps {
  /** Restaurant / pickup pin — usually present once order is confirmed. */
  restaurant: { lat: number; lng: number; name?: string | null } | null;
  /** Customer delivery drop pin. */
  drop?: { lat: number; lng: number; label?: string | null } | null;
  /** Latest courier location. `null` shows the waiting overlay. */
  partnerLocation: { lat: number; lng: number } | null;
  etaMinutes?: number | null;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*                                 Component                                  */
/* -------------------------------------------------------------------------- */
export function LiveTrackingMap({
  restaurant,
  drop,
  partnerLocation,
  etaMinutes,
  className,
}: LiveTrackingMapProps): React.ReactElement {
  const partner = useLerpedPosition(partnerLocation);
  const trail = usePartnerTrail(partner, 10);

  const pickupIcon = useMemo(
    () => pillIcon(restaurant?.name?.slice(0, 22) ?? 'Pickup', 'pickup'),
    [restaurant?.name],
  );
  const dropIcon = useMemo(
    () => pillIcon(drop?.label?.slice(0, 22) ?? 'Drop', 'drop'),
    [drop?.label],
  );
  const partnerMarkerIcon = useMemo(() => courierIcon(), []);

  const initialCentre = useMemo<L.LatLngTuple>(() => {
    if (restaurant) return [restaurant.lat, restaurant.lng];
    if (drop) return [drop.lat, drop.lng];
    if (partner) return [partner.lat, partner.lng];
    return [20.5937, 78.9629]; // centre of India fallback
  }, [restaurant, drop, partner]);

  const waiting = !partnerLocation;

  const trailLatLngs = useMemo<L.LatLngTuple[]>(
    () => trail.map((p) => [p.lat, p.lng] as L.LatLngTuple),
    [trail],
  );

  return (
    <div
      className={cn(
        'relative h-72 w-full overflow-hidden rounded-lg border border-border md:h-96',
        className,
      )}
      data-testid="live-tracking-map"
    >
      <MapContainer
        center={initialCentre}
        zoom={restaurant || drop || partnerLocation ? 14 : 5}
        scrollWheelZoom
        className="h-full w-full"
      >
        <TileLayer url={env.MAP_TILES_URL} attribution={env.MAP_ATTRIBUTION} />

        {/* Faded trail polyline */}
        {trailLatLngs.length >= 2 ? (
          <Polyline
            positions={trailLatLngs}
            pathOptions={{
              color: 'var(--accent)',
              weight: 3,
              opacity: 0.55,
              dashArray: '6 6',
            }}
          />
        ) : null}

        {restaurant ? (
          <Marker
            position={[restaurant.lat, restaurant.lng]}
            icon={pickupIcon}
          />
        ) : null}

        {drop ? (
          <Marker position={[drop.lat, drop.lng]} icon={dropIcon} />
        ) : null}

        {partner ? (
          <Marker
            position={[partner.lat, partner.lng]}
            icon={partnerMarkerIcon}
          />
        ) : null}

        <FitBounds
          pickup={restaurant ? { lat: restaurant.lat, lng: restaurant.lng } : null}
          drop={drop ? { lat: drop.lat, lng: drop.lng } : null}
          partner={partner}
        />
      </MapContainer>

      {/* ETA floating badge (top-right) */}
      {typeof etaMinutes === 'number' && etaMinutes >= 0 && !waiting ? (
        <div className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-background/95 px-2.5 py-1 text-xs font-semibold shadow-sm backdrop-blur-sm">
          <Bike className="size-3.5 text-primary" aria-hidden />
          <span>{etaMinutes} min away</span>
        </div>
      ) : null}

      {/* Waiting-for-courier overlay */}
      {waiting ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/65 backdrop-blur-[1px]">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/95 px-4 py-2 text-sm text-foreground shadow-sm">
            <MapPinIcon className="size-4 animate-pulse text-primary" aria-hidden />
            Waiting for courier...
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default LiveTrackingMap;

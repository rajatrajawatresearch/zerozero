/**
 * Leaflet-backed live tracking map for an in-flight order.
 *
 * Renders:
 *  - Restaurant marker (origin pin) — from `OrderTrackOut.restaurant_*` when
 *    present, or from an explicit prop for pages that have the detail loaded.
 *  - Courier marker — only when `partner_location` is non-null; until then we
 *    show a muted "Waiting for courier..." overlay so the user knows the feed
 *    is live but the rider hasn't accepted yet.
 *
 * We reuse the `MapPreview` Leaflet setup from `@/features/location` (icon
 * fix + css import) via a static import so the hashed asset URLs stay wired.
 */
import 'leaflet/dist/leaflet.css';

import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import { Bike, MapPin as MapPinIcon } from 'lucide-react';

import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

import { env } from '@/lib/env';
import { cn } from '@/lib/utils';

// Module-scope Leaflet defaults (idempotent; same fix as MapPreview).
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

/* -------------------------------------------------------------------------- */
/*                                  Props                                     */
/* -------------------------------------------------------------------------- */
export interface TrackingMapProps {
  restaurant: { lat: number; lng: number; name?: string | null } | null;
  /** `null` when courier hasn't started — map shows the waiting overlay. */
  partnerLocation: { lat: number; lng: number } | null;
  etaMinutes?: number | null;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*                     Fit-bounds helper (zooms to both pins)                 */
/* -------------------------------------------------------------------------- */
function FitBounds({
  restaurant,
  partner,
}: {
  restaurant: { lat: number; lng: number } | null;
  partner: { lat: number; lng: number } | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!restaurant && !partner) return;
    const pts: L.LatLngTuple[] = [];
    if (restaurant) pts.push([restaurant.lat, restaurant.lng]);
    if (partner) pts.push([partner.lat, partner.lng]);
    const [only] = pts;
    if (pts.length === 1 && only) {
      map.setView(only, 15, { animate: true });
      return;
    }
    map.fitBounds(pts, { padding: [40, 40], animate: true });
  }, [map, restaurant, partner]);

  return null;
}

/* -------------------------------------------------------------------------- */
/*                                 Component                                  */
/* -------------------------------------------------------------------------- */
export function TrackingMap({
  restaurant,
  partnerLocation,
  etaMinutes,
  className,
}: TrackingMapProps): React.ReactElement {
  // Choose a sensible starting centre so the map renders even pre-data.
  const initialCentre = useMemo<L.LatLngTuple>(() => {
    if (restaurant) return [restaurant.lat, restaurant.lng];
    if (partnerLocation) return [partnerLocation.lat, partnerLocation.lng];
    // Fallback: geographic centre of India. The overlay covers the tiles
    // anyway until we have real coords.
    return [20.5937, 78.9629];
  }, [restaurant, partnerLocation]);

  const waiting = !partnerLocation;

  return (
    <div
      className={cn(
        'relative h-72 w-full overflow-hidden rounded-lg border border-border md:h-96',
        className,
      )}
    >
      <MapContainer
        center={initialCentre}
        zoom={restaurant || partnerLocation ? 14 : 5}
        scrollWheelZoom
        className="h-full w-full"
      >
        <TileLayer url={env.MAP_TILES_URL} attribution={env.MAP_ATTRIBUTION} />

        {restaurant ? (
          <Marker position={[restaurant.lat, restaurant.lng]} />
        ) : null}

        {partnerLocation ? (
          <Marker
            position={[partnerLocation.lat, partnerLocation.lng]}
            // Reuse the default icon — could swap to a custom one later; the
            // tooltip-less delivery marker keeps the surface simple for now.
          />
        ) : null}

        <FitBounds restaurant={restaurant} partner={partnerLocation} />
      </MapContainer>

      {/* ETA badge (top-right) */}
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

export default TrackingMap;

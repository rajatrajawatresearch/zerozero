/**
 * Tiny Leaflet-backed map preview with a single draggable marker.
 *
 * Why this file exists:
 *  - Leaflet assumes its default marker icons live at runtime-relative paths
 *    (`/marker-icon.png`, etc.), but Vite bundles them with content hashes,
 *    so the default marker renders as a broken image unless we explicitly
 *    wire the imported URLs into `L.Icon.Default.mergeOptions`.
 *  - `leaflet/dist/leaflet.css` must be pulled in *somewhere* for tiles and
 *    controls to render at all — we import it here so any consumer of
 *    `MapPreview` gets styles for free without touching app-level CSS.
 *
 * The marker is draggable; `onChange` fires with the new lat/lng after each
 * drag so the parent form can update its hidden coordinate fields.
 */
import 'leaflet/dist/leaflet.css';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';

import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

import { env } from '@/lib/env';
import { cn } from '@/lib/utils';

// Vite + Leaflet: wire the hashed asset URLs so the default marker renders.
// Running this at module scope is safe — Leaflet's options are global and
// idempotent, and the app only needs it set once.
L.Icon.Default.mergeOptions({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
});

/* -------------------------------------------------------------------------- */
/*                                  Props                                     */
/* -------------------------------------------------------------------------- */
export interface MapPreviewProps {
  lat: number;
  lng: number;
  /** Fires after a drag-end with the new coordinates. */
  onChange?: (coords: { lat: number; lng: number }) => void;
  /** When false, the marker is read-only and map interactions are disabled. */
  interactive?: boolean;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*                        Helper — recentre on prop change                    */
/* -------------------------------------------------------------------------- */
function RecenterOnChange({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    // `setView` skips animation when the delta is zero, so this is cheap.
    map.setView([lat, lng], map.getZoom(), { animate: true });
  }, [lat, lng, map]);
  return null;
}

/* -------------------------------------------------------------------------- */
/*                                 Component                                  */
/* -------------------------------------------------------------------------- */
export function MapPreview({
  lat,
  lng,
  onChange,
  interactive = true,
  className,
}: MapPreviewProps): React.ReactElement {
  const markerRef = useRef<L.Marker | null>(null);

  const dragEndHandler = () => {
    const marker = markerRef.current;
    if (!marker || !onChange) return;
    const { lat: nextLat, lng: nextLng } = marker.getLatLng();
    onChange({ lat: nextLat, lng: nextLng });
  };

  return (
    <div
      className={cn(
        'h-60 w-full overflow-hidden rounded-lg border border-border md:h-80',
        className,
      )}
    >
      <MapContainer
        center={[lat, lng]}
        zoom={15}
        scrollWheelZoom={interactive}
        dragging={interactive}
        doubleClickZoom={interactive}
        touchZoom={interactive}
        zoomControl={interactive}
        className="h-full w-full"
      >
        <TileLayer url={env.MAP_TILES_URL} attribution={env.MAP_ATTRIBUTION} />
        <Marker
          position={[lat, lng]}
          draggable={interactive && !!onChange}
          eventHandlers={{ dragend: dragEndHandler }}
          ref={(instance) => {
            markerRef.current = instance;
          }}
        />
        <RecenterOnChange lat={lat} lng={lng} />
      </MapContainer>
    </div>
  );
}

export default MapPreview;

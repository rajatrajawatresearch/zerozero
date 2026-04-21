/**
 * "Use my location" button.
 *
 * Wraps `useGeolocation` + the optional reverse-geocode lookup, then bubbles
 * the result up via `onLocated`. Stays dumb about what to do with the coords
 * so both the picker Sheet and the address form can reuse it.
 */
import { useState } from 'react';
import { Loader2, LocateFixed } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

import { GeolocationError, useGeolocation } from '../hooks';
import type { Place } from '../types';

export interface UseMyLocationButtonProps {
  /**
   * Called with the resolved lat/lng plus any reverse-geocoded place info.
   * `place` is null when the reverse lookup fails — callers should still
   * accept the raw coordinates in that case.
   */
  onLocated: (coords: { lat: number; lng: number }, place: Place | null) => void;
  /** Override default label. */
  children?: React.ReactNode;
  className?: string;
}

export function UseMyLocationButton({
  onLocated,
  children,
  className,
}: UseMyLocationButtonProps): React.ReactElement {
  const { locate } = useGeolocation();
  const [isWorking, setIsWorking] = useState(false);

  const handleClick = async () => {
    setIsWorking(true);
    try {
      const coords = await locate();
      let place: Place | null = null;
      try {
        // Fire-and-forget reverse lookup — the button still succeeds even if
        // Nominatim is down, it just hands back `place = null`.
        place = await api.get<Place>('/geo/reverse', {
          query: { lat: coords.lat, lng: coords.lng },
        });
      } catch {
        place = null;
      }
      onLocated({ lat: coords.lat, lng: coords.lng }, place);
    } catch (err) {
      const message =
        err instanceof GeolocationError
          ? err.message
          : 'Could not access your location.';
      toast.error(message);
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleClick}
      disabled={isWorking}
      className={className}
    >
      {isWorking ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <LocateFixed className="size-4" aria-hidden />
      )}
      {children ?? 'Use my current location'}
    </Button>
  );
}

export default UseMyLocationButton;

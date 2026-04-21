/**
 * Full address picker rendered inside a shadcn Sheet.
 *
 * Sections (top-to-bottom):
 *   1. "Use my location" CTA — geolocation + reverse geocode
 *   2. Debounced search input → /geo/search result list
 *   3. Saved addresses (only when authed)
 *
 * Picking any of these calls `useLocationStore.setPoint()` /
 * `setSelectedAddress()`, persists the choice to localStorage, and closes
 * the sheet. The `selectActiveLabel` selector then drives the header
 * `LocationTrigger` label on the next render.
 */
import { useState } from 'react';
import { Loader2, MapPin, Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/store/auth';
import { useLocationStore } from '@/store/location';
import type { Address as StoreAddress } from '@/types';

import { useAddressesQuery, useGeoSearchQuery } from '../api';
import { useDebouncedValue } from '../hooks';
import type { Address as WireAddress, Place } from '../types';
import { UseMyLocationButton } from './UseMyLocationButton';

/* -------------------------------------------------------------------------- */
/*                                   Props                                    */
/* -------------------------------------------------------------------------- */
export interface LocationPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */
/**
 * Wire-format `Address` uses snake_case + nullable line2; the store's
 * camelCase `Address` requires the non-null flavour. Keep the adapter local
 * so the rest of the feature can keep working in wire terms.
 */
function toStoreAddress(a: WireAddress): StoreAddress {
  const base: StoreAddress = {
    id: a.id,
    userId: a.user_id,
    label: a.label,
    line1: a.line1,
    city: a.city,
    state: a.state,
    pincode: a.pincode,
    lat: a.lat,
    lng: a.lng,
    isDefault: a.is_default,
    createdAt: a.created_at,
  };
  // Respect `exactOptionalPropertyTypes` — only attach `line2` when present
  // so the type stays `string` rather than `string | undefined`.
  return a.line2 ? { ...base, line2: a.line2 } : base;
}

/* -------------------------------------------------------------------------- */
/*                                 Component                                  */
/* -------------------------------------------------------------------------- */
export function LocationPicker({
  open,
  onOpenChange,
}: LocationPickerProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);

  const isAuthed = useAuthStore((s) => !!s.accessToken);
  const setPoint = useLocationStore((s) => s.setPoint);
  const setSelectedAddress = useLocationStore((s) => s.setSelectedAddress);

  const searchEnabled = debouncedQuery.trim().length >= 2;
  const searchQuery = useGeoSearchQuery(debouncedQuery.trim(), searchEnabled);
  const addressesQuery = useAddressesQuery();

  const close = () => onOpenChange(false);

  const choosePlace = (place: Place) => {
    setPoint({
      lat: place.lat,
      lng: place.lng,
      label: place.label,
    });
    close();
  };

  const chooseFreeform = (
    coords: { lat: number; lng: number },
    place: Place | null,
  ) => {
    setPoint({
      lat: coords.lat,
      lng: coords.lng,
      label: place?.label ?? 'Current location',
    });
    close();
  };

  const chooseSavedAddress = (a: WireAddress) => {
    setSelectedAddress(toStoreAddress(a));
    close();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col p-0 sm:max-w-md"
      >
        {/* Sticky header */}
        <div className="sticky top-0 z-10 border-b border-border bg-background px-6 pt-6 pb-4">
          <SheetHeader>
            <SheetTitle>Set your location</SheetTitle>
            <SheetDescription>
              We use this to show restaurants that deliver to you.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 flex flex-col gap-3">
            <UseMyLocationButton onLocated={chooseFreeform} />
            <div className="relative">
              <Search
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search street, landmark or pincode"
                className="pl-9"
                autoComplete="off"
              />
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Search results */}
          {searchEnabled && (
            <section className="mb-6" aria-label="Search results">
              <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Results
              </h3>
              {searchQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Searching…
                </div>
              ) : searchQuery.isError ? (
                <p className="text-sm text-destructive">
                  Search failed. Try again.
                </p>
              ) : (searchQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No places matched "{debouncedQuery}".
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {(searchQuery.data ?? []).map((place) => (
                    <li key={`${place.osm_place_id ?? `${place.lat},${place.lng}`}`}>
                      <button
                        type="button"
                        onClick={() => choosePlace(place)}
                        className="flex w-full items-start gap-3 rounded-md p-3 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <MapPin
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="flex flex-col">
                          <span className="text-sm font-medium leading-tight">
                            {place.label.split(',')[0]}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {place.label}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Saved addresses */}
          {isAuthed && (
            <section aria-label="Saved addresses">
              {searchEnabled && <Separator className="mb-4" />}
              <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Saved addresses
              </h3>
              {addressesQuery.isLoading ? (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : addressesQuery.isError ? (
                <p className="text-sm text-destructive">
                  Could not load saved addresses.
                </p>
              ) : (addressesQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No saved addresses yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {(addressesQuery.data ?? []).map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => chooseSavedAddress(a)}
                        className="flex w-full items-start gap-3 rounded-md border border-border p-3 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <MapPin
                          className="mt-0.5 size-4 shrink-0 text-primary"
                          aria-hidden
                        />
                        <span className="flex flex-col">
                          <span className="text-sm font-medium leading-tight">
                            {a.label}
                            {a.is_default && (
                              <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary uppercase">
                                Default
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {a.line1}
                            {a.line2 ? `, ${a.line2}` : ''}, {a.city} — {a.pincode}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {!isAuthed && !searchEnabled && (
            <p className="text-center text-sm text-muted-foreground">
              Sign in to use saved addresses, or search above to pick a location.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default LocationPicker;

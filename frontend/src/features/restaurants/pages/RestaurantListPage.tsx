import { MapPin, Search } from 'lucide-react';
import { useDeferredValue, useMemo } from 'react';

import { Input } from '@/components/ui/input';
import { selectActiveLabel, useActiveLatLng, useLocationStore } from '@/store/location';

import { FilterSidebar } from '../components/FilterSidebar';
import { RestaurantGrid } from '../components/RestaurantGrid';
import { useFilters } from '../hooks';
import type { RestaurantListParams } from '../types';

/**
 * Full restaurant-discovery page. Also consumable as a slot inside the
 * coordinator's HomePage (Agent 10) — the responsive layout and filters
 * are self-contained.
 *
 * Location flow:
 *   - Hero displays current delivery point (`selectActiveLabel`).
 *   - Clicking it dispatches a custom event that Agent 9 (FE-Location) /
 *     Agent 10 (FE-Layout) listens for to open the location picker.
 *     This keeps this page free of a hard dependency on the picker module.
 */
export default function RestaurantListPage(): React.ReactElement {
  const activeLatLng = useActiveLatLng();
  const activeLabel = useLocationStore(selectActiveLabel);
  const { filters, set } = useFilters();

  // Debounce the search input via React 19's useDeferredValue so we don't
  // trigger a new fetch on every keystroke while the user is still typing.
  const deferredQ = useDeferredValue(filters.q);

  const gridParams = useMemo<Omit<RestaurantListParams, 'page' | 'pageSize'>>(() => {
    const p: Omit<RestaurantListParams, 'page' | 'pageSize'> = {
      lat: activeLatLng.lat,
      lng: activeLatLng.lng,
      sort: filters.sort,
    };
    if (filters.cuisine.length > 0) p.cuisine = filters.cuisine;
    const trimmed = deferredQ.trim();
    if (trimmed.length > 0) p.q = trimmed;
    if (filters.veg) p.veg = true;
    return p;
  }, [activeLatLng.lat, activeLatLng.lng, filters.cuisine, filters.veg, filters.sort, deferredQ]);

  const handleOpenLocationPicker = () => {
    // Soft coupling — listeners set up by Agent 10 pick this up.
    window.dispatchEvent(new CustomEvent('zz:open-location-picker'));
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <section className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Delivering to
              </p>
              <button
                type="button"
                onClick={handleOpenLocationPicker}
                className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-md text-left text-lg font-semibold text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <MapPin className="size-4 shrink-0 text-primary" aria-hidden />
                <span className="truncate">{activeLabel}</span>
                <span className="text-sm font-normal text-muted-foreground underline-offset-4 hover:underline">
                  Change
                </span>
              </button>
              <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
                Restaurants near you
              </h1>
            </div>

            {/* Search box */}
            <div className="relative w-full sm:max-w-sm">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                placeholder="Search restaurants or dishes"
                value={filters.q}
                onChange={(e) => set({ q: e.target.value })}
                className="pl-9"
                aria-label="Search restaurants"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Body: filters + grid */}
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-4 flex items-center justify-between lg:hidden">
          <p className="text-sm text-muted-foreground">
            {filters.cuisine.length > 0 || filters.veg || filters.q
              ? 'Filtered results'
              : 'All restaurants'}
          </p>
          <FilterSidebar />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
          <FilterSidebar className="hidden lg:block" />

          <div>
            <RestaurantGrid
              params={gridParams}
              emptyState={
                <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/50 p-12 text-center">
                  <MapPin
                    className="size-8 text-muted-foreground"
                    aria-hidden
                  />
                  <div>
                    <p className="text-base font-semibold text-foreground">
                      No restaurants deliver to your location
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Try a different spot or clear your filters.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenLocationPicker}
                    className="mt-2 inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Change location
                  </button>
                </div>
              }
            />
          </div>
        </div>
      </main>
    </div>
  );
}

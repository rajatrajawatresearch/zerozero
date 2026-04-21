import { useMemo, type ReactElement } from 'react';
import { FilterSidebar, RestaurantGrid } from '@/features/restaurants';
import { HeroSection } from './HeroSection';
import { PromoBanner } from './PromoBanner';
import {
  selectActiveLabel,
  selectActiveLatLng,
  useLocationStore,
} from '@/store/location';

/**
 * Phase 2 home page. Composition, left-to-right:
 *
 *   HeroSection    — brand + cuisine chips + CTA
 *   PromoBanner    — hardcoded promo carousel (Phase 3 wires the API)
 *   [sidebar]      — FilterSidebar (from Agent 8) collapses under sm
 *   RestaurantGrid — Agent 8's grid; we pass `lat`/`lng` from the location store
 *
 * The store is subscribed via atom-level selectors so a location change
 * re-renders the grid + heading in one go without re-rendering the hero.
 */
export default function HomePage(): ReactElement {
  const { lat, lng } = useLocationStore(selectActiveLatLng);
  const label = useLocationStore(selectActiveLabel);
  const gridParams = useMemo(() => ({ lat, lng }), [lat, lng]);

  return (
    <>
      <HeroSection />
      <PromoBanner />

      <section
        aria-labelledby="grid-heading"
        className="mx-auto w-full max-w-7xl px-6 pb-10"
      >
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2
              id="grid-heading"
              className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
            >
              What&apos;s hot near{' '}
              <span className="text-primary">{label}</span>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Hand-picked kitchens delivering to you right now.
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <aside className="hidden lg:block" aria-label="Filters">
            <div className="sticky top-24">
              <FilterSidebar />
            </div>
          </aside>

          <div>
            <RestaurantGrid params={gridParams} />
          </div>
        </div>
      </section>
    </>
  );
}

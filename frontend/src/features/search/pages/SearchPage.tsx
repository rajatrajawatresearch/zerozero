import { useCallback, useMemo, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Loader2 } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RestaurantCard } from '@/features/restaurants/components/RestaurantCard';
import { selectActiveLatLng, useLocationStore } from '@/store/location';
import { cn } from '@/lib/utils';

import { useGlobalSearchQuery } from '../api';
import { useDebouncedValue } from '../hooks';
import { SearchEmpty } from '../components/SearchEmpty';
import { SearchResultMenuItem } from '../components/SearchResultMenuItem';
import type { SearchResultType } from '../types';

/* -------------------------------------------------------------------------- */
/*                          Popular cuisine shortcuts                          */
/* -------------------------------------------------------------------------- */
const POPULAR_CUISINES = [
  'Pizza',
  'Biryani',
  'Burger',
  'Chinese',
  'South Indian',
  'Pasta',
  'Dosa',
  'Momos',
  'Sushi',
  'Desserts',
] as const;

const VALID_TABS: readonly SearchResultType[] = [
  'all',
  'restaurant',
  'menu_item',
] as const;

function parseTab(raw: string | null): SearchResultType {
  if (!raw) return 'all';
  return (VALID_TABS as readonly string[]).includes(raw)
    ? (raw as SearchResultType)
    : 'all';
}

/* -------------------------------------------------------------------------- */
/*                                 Page                                       */
/* -------------------------------------------------------------------------- */
/**
 * Full-page search results at `/search?q=&type=`.
 *
 *  - State lives in the URL so refresh/deep-link round-trips cleanly
 *  - Tabs select the result slice (All / Restaurants / Menu items)
 *  - Empty `q` → renders popular cuisine chips to seed exploration
 *  - Leverages the same `useGlobalSearchQuery` as the palette so the
 *    TanStack cache is shared between the two surfaces.
 */
export default function SearchPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawQuery = searchParams.get('q') ?? '';
  const tab = parseTab(searchParams.get('type'));

  const debounced = useDebouncedValue(rawQuery.trim(), 300);
  const geo = useLocationStore(selectActiveLatLng);

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === null || value.length === 0) next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setQuery = useCallback(
    (value: string) => updateParam('q', value.length > 0 ? value : null),
    [updateParam],
  );
  const setTab = useCallback(
    (value: SearchResultType) =>
      updateParam('type', value === 'all' ? null : value),
    [updateParam],
  );

  const { data, isFetching, isError } = useGlobalSearchQuery(
    debounced,
    { ...geo, type: tab },
    { enabled: debounced.length >= 2 },
  );

  const restaurants = data?.restaurants ?? [];
  const menuItems = data?.menu_items ?? [];
  const totalCount = restaurants.length + menuItems.length;
  const restaurantsVisible = tab === 'all' || tab === 'restaurant';
  const itemsVisible = tab === 'all' || tab === 'menu_item';

  const headline = useMemo(() => {
    if (debounced.length < 2) return 'Search ZeroZero';
    if (isFetching) return `Searching for "${debounced}"...`;
    if (isError) return `Couldn't load results for "${debounced}"`;
    return `${totalCount} result${totalCount === 1 ? '' : 's'} for "${debounced}"`;
  }, [debounced, isFetching, isError, totalCount]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {headline}
        </h1>
        <Input
          type="search"
          value={rawQuery}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search restaurants, dishes, cuisines..."
          aria-label="Search"
          className="h-11 w-full"
          autoFocus
        />
      </div>

      {debounced.length < 2 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Popular right now
          </h2>
          <div className="flex flex-wrap gap-2">
            {POPULAR_CUISINES.map((cuisine) => (
              <Link
                key={cuisine}
                to={`/search?q=${encodeURIComponent(cuisine)}`}
                className={cn(
                  'inline-flex items-center rounded-full border border-border bg-background px-4 py-1.5 text-sm font-medium',
                  'transition-colors hover:border-primary hover:text-primary',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                {cuisine}
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <div className="mt-6">
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as SearchResultType)}
          >
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="restaurant">
                Restaurants ({restaurants.length})
              </TabsTrigger>
              <TabsTrigger value="menu_item">
                Menu items ({menuItems.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value={tab} className="mt-6">
              {isFetching ? (
                <div className="flex items-center gap-2 py-12 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Loading results...
                </div>
              ) : isError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                  Something went wrong fetching search results. Try again in a moment.
                </div>
              ) : totalCount === 0 ? (
                <SearchEmpty q={debounced} />
              ) : (
                <div className="space-y-10">
                  {restaurantsVisible && restaurants.length > 0 ? (
                    <section>
                      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Restaurants
                      </h2>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {restaurants.map((r) => (
                          <RestaurantCard key={r.id} restaurant={r} />
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {itemsVisible && menuItems.length > 0 ? (
                    <section>
                      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Menu items
                      </h2>
                      <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
                        {menuItems.map((item) => (
                          <li key={item.id}>
                            <Link
                              to={`/r/${item.restaurant.slug}`}
                              className={cn(
                                'flex items-center gap-3 px-4 py-3 transition-colors',
                                'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                              )}
                            >
                              <SearchResultMenuItem item={item} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}

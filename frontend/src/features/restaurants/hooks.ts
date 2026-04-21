/**
 * Feature-local hooks for the Restaurants slice.
 *
 * `useFilters` is the single source of truth for list-page UI state —
 * everything (search input, cuisine checkboxes, sort select, veg toggle)
 * reads/writes the URL so refreshes and deep-links are lossless.
 *
 * `useFormattedPrice` centralises money formatting. Backend ships money as
 * decimal strings (`Numeric(12,2)`); we parse at the very last moment into
 * INR-localised currency strings.
 */
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';

import type { MoneyAmount } from '@/types';
import type { SortOption } from './types';

/* -------------------------------------------------------------------------- */
/*                                   Filters                                  */
/* -------------------------------------------------------------------------- */
export interface RestaurantFilters {
  cuisine: string[];
  q: string;
  veg: boolean;
  sort: SortOption;
}

const DEFAULT_SORT: SortOption = 'distance';
const VALID_SORTS: readonly SortOption[] = [
  'distance',
  'rating',
  'popular',
  'new',
] as const;

function parseSort(raw: string | null): SortOption {
  if (!raw) return DEFAULT_SORT;
  return (VALID_SORTS as readonly string[]).includes(raw)
    ? (raw as SortOption)
    : DEFAULT_SORT;
}

/**
 * URL-backed filter state. Components call `set({ cuisine: [...] })` which
 * merges into the existing search params. Passing an empty value removes
 * the key entirely so the URL stays clean.
 */
export function useFilters(): {
  filters: RestaurantFilters;
  set: (patch: Partial<RestaurantFilters>) => void;
  toggleCuisine: (slug: string) => void;
  reset: () => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo<RestaurantFilters>(() => {
    const cuisineRaw = searchParams.get('cuisine');
    return {
      cuisine: cuisineRaw ? cuisineRaw.split(',').filter(Boolean) : [],
      q: searchParams.get('q') ?? '',
      veg: searchParams.get('veg') === '1',
      sort: parseSort(searchParams.get('sort')),
    };
  }, [searchParams]);

  const set = (patch: Partial<RestaurantFilters>): void => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);

        if (patch.cuisine !== undefined) {
          if (patch.cuisine.length === 0) next.delete('cuisine');
          else next.set('cuisine', patch.cuisine.join(','));
        }
        if (patch.q !== undefined) {
          if (patch.q.trim().length === 0) next.delete('q');
          else next.set('q', patch.q);
        }
        if (patch.veg !== undefined) {
          if (patch.veg) next.set('veg', '1');
          else next.delete('veg');
        }
        if (patch.sort !== undefined) {
          if (patch.sort === DEFAULT_SORT) next.delete('sort');
          else next.set('sort', patch.sort);
        }

        return next;
      },
      { replace: true },
    );
  };

  const toggleCuisine = (slug: string): void => {
    const current = filters.cuisine;
    const next = current.includes(slug)
      ? current.filter((c) => c !== slug)
      : [...current, slug];
    set({ cuisine: next });
  };

  const reset = (): void => {
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  return { filters, set, toggleCuisine, reset };
}

/* -------------------------------------------------------------------------- */
/*                              Money formatting                              */
/* -------------------------------------------------------------------------- */
const INR_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/**
 * Format a backend money string (decimal-as-string) into an INR-localised
 * currency string, e.g. `"249.50"` -> `"₹250"`.
 *
 * Returns `"—"` for nullish inputs so callers don't have to branch.
 */
export function useFormattedPrice(value: MoneyAmount | null | undefined): string {
  return useMemo(() => formatPrice(value), [value]);
}

/** Pure formatter — safe to call outside hook scope (e.g. inside .map()). */
export function formatPrice(value: MoneyAmount | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return INR_FORMATTER.format(n);
}

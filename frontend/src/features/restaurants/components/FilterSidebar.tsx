import { SlidersHorizontal, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { useCuisinesQuery } from '../api';
import { useFilters } from '../hooks';
import type { SortOption } from '../types';

/**
 * Restaurant list filters. Sticky sidebar on desktop (lg+); Sheet drawer on
 * mobile. All state is URL-backed through `useFilters` so filter state is
 * shareable/bookmarkable and survives refreshes.
 */
interface FilterSidebarProps {
  className?: string;
}

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'distance', label: 'Distance' },
  { value: 'rating', label: 'Rating' },
  { value: 'popular', label: 'Popular' },
  { value: 'new', label: 'New on ZeroZero' },
];

export function FilterSidebar({ className }: FilterSidebarProps) {
  const { filters, set, toggleCuisine, reset } = useFilters();
  const { data: cuisines, isLoading } = useCuisinesQuery();

  const activeCount =
    filters.cuisine.length + (filters.veg ? 1 : 0) + (filters.q ? 1 : 0);

  const body = (
    <div className="space-y-6">
      {/* Sort */}
      <section className="space-y-2">
        <Label htmlFor="sort-select" className="text-sm font-semibold">
          Sort by
        </Label>
        <Select
          value={filters.sort}
          onValueChange={(v) => set({ sort: v as SortOption })}
        >
          <SelectTrigger id="sort-select" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      <Separator />

      {/* Diet */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Dietary</h3>
        <label className="flex cursor-pointer items-center gap-3">
          <Checkbox
            checked={filters.veg}
            onCheckedChange={(v) => set({ veg: v === true })}
            id="veg-toggle"
          />
          <span className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="inline-flex size-3 items-center justify-center rounded-sm border border-success"
            >
              <span className="size-1.5 rounded-full bg-success" />
            </span>
            Pure veg only
          </span>
        </label>
      </section>

      <Separator />

      {/* Cuisines */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Cuisines</h3>
          {filters.cuisine.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto px-2 py-0.5 text-xs"
              onClick={() => set({ cuisine: [] })}
            >
              Clear
            </Button>
          ) : null}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : (
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {cuisines?.map((c) => {
              const checked = filters.cuisine.includes(c.slug);
              return (
                <label
                  key={c.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm',
                    'hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleCuisine(c.slug)}
                  />
                  <span className="flex flex-1 items-center gap-2">
                    {c.icon ? <span aria-hidden>{c.icon}</span> : null}
                    {c.name}
                  </span>
                  {c.is_veg_only ? (
                    <Badge variant="success" className="text-[10px]">
                      Veg
                    </Badge>
                  ) : null}
                </label>
              );
            })}
          </div>
        )}
      </section>

      {activeCount > 0 ? (
        <>
          <Separator />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={reset}
          >
            <X className="size-4" aria-hidden />
            Reset filters
          </Button>
        </>
      ) : null}
    </div>
  );

  return (
    <>
      {/* Mobile: trigger + sheet */}
      <div className="lg:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="gap-2">
              <SlidersHorizontal className="size-4" aria-hidden />
              Filters
              {activeCount > 0 ? (
                <Badge variant="default" className="ml-1 h-5 px-1.5">
                  {activeCount}
                </Badge>
              ) : null}
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 overflow-y-auto sm:w-96">
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription>
                Narrow down restaurants near you.
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6">{body}</div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop: sticky sidebar */}
      <aside
        className={cn(
          'hidden lg:sticky lg:top-24 lg:block lg:h-[calc(100vh-8rem)] lg:overflow-y-auto',
          'rounded-lg border border-border bg-card p-5',
          className,
        )}
        aria-label="Restaurant filters"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Filters</h2>
          {activeCount > 0 ? (
            <Badge variant="secondary">{activeCount} active</Badge>
          ) : null}
        </div>
        {body}
      </aside>
    </>
  );
}

export default FilterSidebar;

import type { ReactElement } from 'react';
import { Leaf } from 'lucide-react';

import { formatPrice } from '@/features/restaurants/hooks';
import { cn } from '@/lib/utils';

import type { MenuItemSearchHit } from '../types';

/**
 * Single-row menu-item hit. Shows thumb + dish name + parent restaurant
 * name + price. Mirrors the visual weight of `SearchResultRestaurant` so
 * they stack cleanly inside one Command palette list.
 */
interface SearchResultMenuItemProps {
  item: MenuItemSearchHit;
  className?: string;
}

export function SearchResultMenuItem({
  item,
  className,
}: SearchResultMenuItemProps): ReactElement {
  return (
    <div className={cn('flex w-full items-center gap-3', className)}>
      <div className="size-10 shrink-0 overflow-hidden rounded-md bg-muted">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-muted-foreground"
          >
            {item.name.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {item.is_veg ? (
            <span
              aria-label="Vegetarian"
              className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm border border-emerald-600 text-emerald-600"
            >
              <Leaf className="size-2.5" aria-hidden />
            </span>
          ) : null}
          <span className="truncate text-sm font-medium text-foreground">
            {item.name}
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {item.restaurant.name}
        </p>
      </div>

      <span className="shrink-0 text-sm font-semibold text-foreground">
        {formatPrice(item.price)}
      </span>
    </div>
  );
}

export default SearchResultMenuItem;

import { Minus, Plus } from 'lucide-react';
import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCartStore } from '@/store/cart';

import { formatPrice } from '../hooks';
import type { MenuItemOut } from '../types';

/**
 * Single menu-item row for a restaurant's menu page.
 *
 * Layout:
 *   [ veg/non-veg | name + desc + price + tags ]   [ image + add/stepper ]
 *
 * Cart behaviour:
 *   - Clicking "Add" calls `useCartStore.add` with `restaurantId` — the
 *     store itself enforces the single-restaurant invariant by clearing
 *     prior lines when the user switches shops.
 *   - Once the item is in the cart we swap the Add button for a qty stepper.
 *   - Variant support is intentionally deferred; backend's `variants` field
 *     is plumbed through to the DTO but the UI picker lands in Phase 3.
 */
interface MenuItemCardProps {
  item: MenuItemOut;
  restaurantId: string;
  className?: string;
}

/** Classic Indian veg/non-veg square-dot icon — all theme tokens. */
function DietIcon({ isVeg }: { isVeg: boolean }) {
  const color = isVeg ? 'border-success' : 'border-destructive';
  const dot = isVeg ? 'bg-success' : 'bg-destructive';
  return (
    <span
      aria-label={isVeg ? 'Vegetarian' : 'Non-vegetarian'}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center border-2 rounded-[2px]',
        color,
      )}
    >
      <span className={cn('size-1.5 rounded-full', dot)} />
    </span>
  );
}

export function MenuItemCard({ item, restaurantId, className }: MenuItemCardProps) {
  const add = useCartStore((s) => s.add);
  const updateQty = useCartStore((s) => s.updateQty);
  const lines = useCartStore((s) => s.lines);

  // Find the matching line (sans variant options — variants deferred to Phase 3).
  const line = useMemo(
    () =>
      lines.find(
        (l) =>
          l.menuItemId === item.id &&
          l.restaurantId === restaurantId &&
          Object.keys(l.options).length === 0,
      ),
    [lines, item.id, restaurantId],
  );

  const disabled = !item.is_available;

  const handleAdd = () => {
    add({
      menuItemId: item.id,
      restaurantId,
      name: item.name,
      price: item.price,
      qty: 1,
      options: {},
      ...(item.image_url ? { imageUrl: item.image_url } : {}),
    });
  };

  return (
    <article
      className={cn(
        'flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4',
        disabled && 'opacity-60',
        className,
      )}
    >
      {/* Info column */}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <DietIcon isVeg={item.is_veg} />
          <h4 className="line-clamp-1 text-sm font-semibold text-foreground">
            {item.name}
          </h4>
        </div>

        <p className="text-sm font-medium text-foreground">
          {formatPrice(item.price)}
        </p>

        {item.description ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {item.description}
          </p>
        ) : null}

        {item.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-1">
            {item.tags.slice(0, 4).map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      {/* Image + CTA column */}
      <div className="relative flex w-24 shrink-0 flex-col items-center gap-2 sm:w-28">
        <div className="h-24 w-24 overflow-hidden rounded-md bg-muted sm:h-28 sm:w-28">
          {item.image_url ? (
            <img
              src={item.image_url}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
              No image
            </div>
          )}
        </div>

        {line ? (
          <div className="flex h-8 w-24 items-center justify-between rounded-md border border-primary bg-background text-primary shadow-sm sm:w-28">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-full w-8 text-primary hover:bg-primary/10"
              onClick={() => updateQty(line.clientId, line.qty - 1)}
              aria-label={`Decrease ${item.name} quantity`}
              disabled={disabled}
            >
              <Minus className="size-3.5" />
            </Button>
            <span className="text-sm font-semibold">{line.qty}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-full w-8 text-primary hover:bg-primary/10"
              onClick={() => updateQty(line.clientId, line.qty + 1)}
              aria-label={`Increase ${item.name} quantity`}
              disabled={disabled}
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 w-24 border-primary font-semibold text-primary hover:bg-primary/10 sm:w-28"
            onClick={handleAdd}
            disabled={disabled}
          >
            {disabled ? 'Unavailable' : 'Add'}
          </Button>
        )}

        {item.variants && item.variants.length > 0 ? (
          <span className="text-[10px] text-muted-foreground">Customisable</span>
        ) : null}
      </div>
    </article>
  );
}

export default MenuItemCard;

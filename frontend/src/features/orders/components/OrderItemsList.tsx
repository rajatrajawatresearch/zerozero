/**
 * Itemised list for an order detail view. Renders the name snapshot, qty,
 * any chosen options (key/value pairs), and the price snapshot × qty.
 *
 * Reads directly from the `OrderItemOut[]` shape — no adapter layer.
 */
import { formatPrice } from '@/features/restaurants/hooks';
import { cn } from '@/lib/utils';

import type { OrderItemOut } from '../types';

/* -------------------------------------------------------------------------- */
/*                                  Props                                     */
/* -------------------------------------------------------------------------- */
export interface OrderItemsListProps {
  items: OrderItemOut[];
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*                               Options summary                              */
/* -------------------------------------------------------------------------- */
/** Renders "Spicy · No onion" from `{spice: 'hot', onion: false}`-style maps. */
function summariseOptions(options: Record<string, unknown> | null): string {
  if (!options) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(options)) {
    if (value === false || value === null || value === undefined) continue;
    if (value === true) {
      parts.push(prettify(key));
      continue;
    }
    // Only stringify primitives — skip nested objects/arrays to avoid
    // "[object Object]" output. Options payloads are typically string/bool.
    if (typeof value === 'string' || typeof value === 'number') {
      parts.push(`${prettify(key)}: ${value}`);
    }
  }
  return parts.join(' · ');
}

function prettify(key: string): string {
  // snake_case → Title Case so keys display cleanly
  return key
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/* -------------------------------------------------------------------------- */
/*                                 Component                                  */
/* -------------------------------------------------------------------------- */
export function OrderItemsList({
  items,
  className,
}: OrderItemsListProps): React.ReactElement {
  if (items.length === 0) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        No items in this order.
      </p>
    );
  }

  return (
    <ul
      className={cn('divide-y divide-border rounded-lg border border-border bg-card', className)}
      aria-label="Items in this order"
    >
      {items.map((item) => {
        const optionsLabel = summariseOptions(item.options);
        const lineTotal = Number(item.price_snapshot) * item.qty;
        return (
          <li
            key={item.id}
            className="flex items-start justify-between gap-4 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                <span className="inline-block w-8 text-muted-foreground">
                  {item.qty}&times;
                </span>
                {item.name_snapshot}
              </p>
              {optionsLabel ? (
                <p className="mt-0.5 pl-8 text-xs text-muted-foreground">
                  {optionsLabel}
                </p>
              ) : null}
            </div>
            <span className="shrink-0 text-sm font-medium text-foreground">
              {formatPrice(lineTotal.toFixed(2))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default OrderItemsList;

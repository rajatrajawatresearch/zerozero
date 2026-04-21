import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCartStore, selectCartCount } from '@/store/cart';
import { cn } from '@/lib/utils';

/**
 * Header cart trigger. Navigates to `/cart` (Phase 3 will replace the stub)
 * and overlays a live item-count badge driven by the cart store.
 */
export function CartButton({ className }: { className?: string }): ReactElement {
  const count = useCartStore(selectCartCount);

  return (
    <Button
      asChild
      variant="ghost"
      size="icon"
      aria-label={count > 0 ? `Cart with ${count} items` : 'Cart is empty'}
      className={cn('relative', className)}
    >
      <Link to="/cart">
        <ShoppingBag className="size-4" aria-hidden />
        {count > 0 ? (
          <span
            className={cn(
              'absolute -right-0.5 -top-0.5 grid min-h-4 min-w-4 place-items-center rounded-full',
              'bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground',
              'animate-in zoom-in-50 ring-2 ring-background',
            )}
            aria-hidden
          >
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}

export default CartButton;

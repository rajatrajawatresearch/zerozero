import { ShoppingBag } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { useCart } from '../hooks';
import { CartDrawer } from './CartDrawer';

/**
 * Cart-feature-owned button + drawer wrapper.
 *
 * Phase 2 (`components/layout/CartButton.tsx`) ships a link-to-/cart variant
 * driven by the guest cart. This version reads the UNIFIED `useCart()` view
 * (server when authed, guest otherwise) and opens `CartDrawer` inline —
 * Agent 10 will swap the header reference in a follow-up task.
 */
export interface CartButtonWithDrawerProps {
  className?: string;
  /** Link to /cart instead of opening the drawer (used on the cart page itself). */
  asLink?: boolean;
}

export function CartButtonWithDrawer({
  className,
  asLink = false,
}: CartButtonWithDrawerProps): ReactElement {
  const { itemCount } = useCart();
  const [open, setOpen] = useState<boolean>(false);

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={
        itemCount > 0 ? `Cart with ${itemCount} items` : 'Cart is empty'
      }
      className={cn('relative', className)}
      onClick={() => {
        if (!asLink) setOpen(true);
      }}
    >
      <ShoppingBag className="size-4" aria-hidden />
      {itemCount > 0 ? (
        <span
          className={cn(
            'absolute -right-0.5 -top-0.5 grid min-h-4 min-w-4 place-items-center rounded-full',
            'bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground',
            'ring-2 ring-background animate-in zoom-in-50',
          )}
          aria-hidden
        >
          {itemCount > 99 ? '99+' : itemCount}
        </span>
      ) : null}
    </Button>
  );

  if (asLink) {
    return trigger;
  }

  return <CartDrawer open={open} onOpenChange={setOpen} trigger={trigger} />;
}

export default CartButtonWithDrawer;

import { Loader2, ShoppingBag } from 'lucide-react';
import { Link } from 'react-router';
import type { ReactElement, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

import { useCart } from '../hooks';
import { CartLineItem } from './CartLineItem';
import { CartSummary } from './CartSummary';
import { EmptyCart } from './EmptyCart';

/**
 * Right-edge Sheet that surfaces the live cart without leaving the page.
 * Controlled-open variant exists for the header `CartButton` to hand off
 * trigger+open/close state; uncontrolled just wraps the child trigger.
 */
export interface CartDrawerProps {
  /** Controlled open state. Omit to let the trigger child manage it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Renders inside `SheetTrigger` when uncontrolled — typically `<CartButton/>`. */
  trigger?: ReactNode;
  className?: string;
}

export function CartDrawer({
  open,
  onOpenChange,
  trigger,
  className,
}: CartDrawerProps): ReactElement {
  const cart = useCart();

  const close = (): void => {
    onOpenChange?.(false);
  };

  // Support both controlled and uncontrolled modes — Radix Sheet treats
  // `undefined` values the same as omission, so we can just spread them.
  const controlled: Record<string, unknown> =
    open !== undefined ? { open, onOpenChange } : {};

  return (
    <Sheet {...controlled}>
      {trigger ? <SheetTrigger asChild>{trigger}</SheetTrigger> : null}
      <SheetContent
        side="right"
        className={cn('flex w-full flex-col gap-0 p-0 sm:max-w-md', className)}
      >
        <SheetHeader className="px-6 py-4 border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <ShoppingBag className="size-4 text-primary" aria-hidden />
            <span>Your cart</span>
            {cart.itemCount > 0 ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                {cart.itemCount}
              </span>
            ) : null}
          </SheetTitle>
          {cart.restaurantName ? (
            <p className="text-xs text-muted-foreground">
              From {cart.restaurantName}
            </p>
          ) : null}
        </SheetHeader>

        {cart.isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2
              className="size-6 animate-spin text-muted-foreground"
              aria-label="Loading cart"
            />
          </div>
        ) : cart.items.length === 0 ? (
          <div className="flex flex-1 items-center">
            <EmptyCart onNavigate={close} />
          </div>
        ) : (
          <>
            <ul className="flex-1 overflow-y-auto px-6">
              {cart.items.map((line) => (
                <CartLineItem
                  key={line.id}
                  line={line}
                  onUpdateQty={cart.updateQty}
                  onRemove={cart.removeItem}
                  disabled={cart.isMutating}
                />
              ))}
            </ul>

            <Separator />

            <div className="space-y-4 p-6">
              <CartSummary subtotal={cart.subtotal} />

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => void cart.clear()}
                  disabled={cart.isMutating}
                >
                  Clear
                </Button>
                <Button asChild className="flex-[2]" disabled={cart.isMutating}>
                  <Link to="/checkout" onClick={close}>
                    Checkout
                  </Link>
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default CartDrawer;

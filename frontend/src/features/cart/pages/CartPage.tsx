import { Loader2, ShoppingBag } from 'lucide-react';
import { Link } from 'react-router';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

import { CartLineItem } from '../components/CartLineItem';
import { CartSummary } from '../components/CartSummary';
import { EmptyCart } from '../components/EmptyCart';
import { useCart } from '../hooks';

/**
 * Full-page cart at `/cart` — replaces the Phase 2 stub. Two-column on
 * desktop (lines | summary), single-column on mobile. Same data source as
 * the drawer so edits stay in sync.
 */
export default function CartPage(): ReactElement {
  const cart = useCart();

  if (cart.isLoading) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-4xl items-center justify-center px-4 py-10">
        <Loader2
          className="size-6 animate-spin text-muted-foreground"
          aria-label="Loading cart"
        />
      </main>
    );
  }

  if (cart.items.length === 0) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <EmptyCart />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center gap-3">
        <div
          aria-hidden
          className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary"
        >
          <ShoppingBag className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Your cart
          </h1>
          {cart.restaurantName ? (
            <p className="text-sm text-muted-foreground">
              From {cart.restaurantName}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'}
            </p>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
        <section
          aria-label="Cart items"
          className="rounded-lg border border-border bg-card px-5"
        >
          <ul>
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
          <div className="flex items-center justify-between py-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void cart.clear()}
              disabled={cart.isMutating}
            >
              Clear cart
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/">Keep shopping</Link>
            </Button>
          </div>
        </section>

        <aside
          aria-label="Order summary"
          className="h-fit space-y-4 rounded-lg border border-border bg-card p-5 lg:sticky lg:top-24"
        >
          <h2 className="text-base font-semibold text-foreground">
            Order summary
          </h2>
          <CartSummary subtotal={cart.subtotal} />
          <Button asChild className="w-full" disabled={cart.isMutating}>
            <Link to="/checkout">Proceed to checkout</Link>
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            You&apos;ll pick an address and confirm payment next.
          </p>
        </aside>
      </div>
    </main>
  );
}

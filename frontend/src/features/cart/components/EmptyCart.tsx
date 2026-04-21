import { ShoppingBag } from 'lucide-react';
import { Link } from 'react-router';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Zero-state shown whenever the cart has no lines. Keeps the user moving
 * by CTA-ing them back to the restaurant grid.
 */
export interface EmptyCartProps {
  className?: string;
  /** Set by `CartDrawer` so the Sheet closes after navigation. */
  onNavigate?: () => void;
}

export function EmptyCart({ className, onNavigate }: EmptyCartProps): ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-10 text-center',
        className,
      )}
    >
      <div
        aria-hidden
        className="grid size-16 place-items-center rounded-full bg-primary/10 text-primary"
      >
        <ShoppingBag className="size-7" />
      </div>
      {/*
        Bumped h3 → h1 so the empty-cart state passes axe's
        `page-has-heading-one` on the standalone `/cart` route. Visually
        identical (same classes); only the semantic level changed. Phase 5 A3.
      */}
      <h1 className="text-lg font-semibold text-foreground">Your cart is empty</h1>
      <p className="max-w-xs text-sm text-muted-foreground">
        Nothing here yet. Browse restaurants and add something delicious.
      </p>
      <Button asChild className="mt-2">
        <Link to="/" onClick={onNavigate}>
          Browse restaurants
        </Link>
      </Button>
    </div>
  );
}

export default EmptyCart;

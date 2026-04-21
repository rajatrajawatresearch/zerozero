import { useQueries } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, Clock, MapPin, ShoppingBag } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  selectCartCount,
  selectCartRestaurantId,
  selectCartTotal,
  useCartStore,
} from '@/store/cart';

import { CuisineChip } from '../components/CuisineChip';
import { MenuCategory } from '../components/MenuCategory';
import { RatingBadge } from '../components/RatingBadge';
import { formatPrice } from '../hooks';
import type { RestaurantDetail, RestaurantMenu } from '../types';

/**
 * Restaurant detail page — hero + menu + cart summary.
 *
 * Parallel fetching:
 *   Detail and menu are independent endpoints — we use `useQueries` so the
 *   two requests fire concurrently, not sequentially. First paint happens
 *   as soon as either resolves.
 */
export default function RestaurantDetailPage(): React.ReactElement {
  const { slug } = useParams<{ slug: string }>();

  const results = useQueries({
    queries: [
      {
        queryKey: ['restaurants', slug],
        queryFn: () =>
          api.get<RestaurantDetail>(`/restaurants/${slug}`, { skipAuth: true }),
        enabled: Boolean(slug),
      },
      {
        queryKey: ['restaurants', slug, 'menu'],
        queryFn: () =>
          api.get<RestaurantMenu>(`/restaurants/${slug}/menu`, {
            skipAuth: true,
          }),
        enabled: Boolean(slug),
      },
    ],
  });

  const [detailQ, menuQ] = results;
  const detail = detailQ?.data;
  const menu = menuQ?.data;

  const isLoading = results.some((r) => r.isLoading);
  const isError = results.some((r) => r.isError);
  const firstError = results.find((r) => r.error)?.error;

  if (isError) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-6 py-20 text-center">
        <AlertCircle className="size-8 text-destructive" aria-hidden />
        <h1 className="text-xl font-semibold">Could not load restaurant</h1>
        <p className="text-sm text-muted-foreground">
          {firstError instanceof Error ? firstError.message : 'Unknown error'}
        </p>
        <Button asChild variant="outline" className="mt-2">
          <Link to="/">
            <ArrowLeft className="size-4" aria-hidden />
            Back to restaurants
          </Link>
        </Button>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <RestaurantHero detail={detail} isLoading={isLoading && !detail} />

      {/* Body */}
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
          {/* Menu + category nav */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_1fr]">
            <CategoryNav menu={menu} />
            <section className="space-y-10">
              {menu === undefined ? (
                <MenuSkeleton />
              ) : menu.categories.length === 0 ? (
                <p className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
                  This restaurant hasn&apos;t published a menu yet.
                </p>
              ) : (
                menu.categories.map((group) => (
                  <MenuCategory
                    key={group.category.id}
                    group={group}
                    restaurantId={menu.restaurant_id}
                  />
                ))
              )}
            </section>
          </div>

          {/* Cart summary (sticky) */}
          <CartSummary restaurantId={detail?.id} />
        </div>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                    Hero                                    */
/* -------------------------------------------------------------------------- */
function RestaurantHero({
  detail,
  isLoading,
}: {
  detail: RestaurantDetail | undefined;
  isLoading: boolean;
}) {
  if (isLoading || !detail) {
    return (
      <section className="relative bg-card">
        <Skeleton className="h-48 w-full rounded-none sm:h-64" />
        <div className="mx-auto max-w-6xl space-y-3 px-4 py-5 sm:px-6">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-20 rounded-md" />
            <Skeleton className="h-5 w-24 rounded-md" />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="relative bg-card">
      <div className="relative h-48 w-full overflow-hidden bg-muted sm:h-64">
        {detail.cover_url ? (
          <img
            src={detail.cover_url}
            alt=""
            loading="eager"
            fetchPriority="high"
            className="h-full w-full object-cover"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/10 to-transparent" />
      </div>

      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-2 inline-flex">
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="-ml-2 h-auto px-2 py-1 text-muted-foreground"
              >
                <Link to="/">
                  <ArrowLeft className="size-4" aria-hidden />
                  All restaurants
                </Link>
              </Button>
            </div>

            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {detail.name}
            </h1>

            {detail.description ? (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {detail.description}
              </p>
            ) : null}

            {detail.cuisines.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1">
                {detail.cuisines.map((c) => (
                  <CuisineChip key={c.id} name={c.name} icon={c.icon} />
                ))}
              </div>
            ) : null}

            <dl className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
              <div className="inline-flex items-center gap-1.5">
                <Clock className="size-4" aria-hidden />
                <dt className="sr-only">Prep time</dt>
                <dd>{detail.avg_prep_minutes} min avg</dd>
              </div>
              {detail.distance_km !== null && detail.distance_km !== undefined ? (
                <div className="inline-flex items-center gap-1.5">
                  <MapPin className="size-4" aria-hidden />
                  <dt className="sr-only">Distance</dt>
                  <dd>{detail.distance_km.toFixed(1)} km</dd>
                </div>
              ) : null}
              <div className="inline-flex items-center gap-1.5">
                <Clock className="size-4" aria-hidden />
                <dt className="sr-only">Opens</dt>
                <dd>
                  {formatTime(detail.opens_at)} – {formatTime(detail.closes_at)}
                </dd>
              </div>
              <div>
                <dt className="sr-only">Minimum order</dt>
                <dd>Min order {formatPrice(detail.min_order)}</dd>
              </div>
              <div>
                <dt className="sr-only">Delivery fee</dt>
                <dd>Delivery {formatPrice(detail.delivery_fee_base)}</dd>
              </div>
            </dl>

            {detail.address_text ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {detail.address_text}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col items-end gap-2">
            {detail.rating_count > 0 ? (
              <RatingBadge
                value={detail.rating_avg}
                count={detail.rating_count}
                className="px-2 py-1 text-sm"
              />
            ) : null}
            {!detail.is_open ? (
              <Badge variant="destructive">Closed now</Badge>
            ) : null}
            {detail.delivers_here === false ? (
              <Badge variant="warning">Doesn&apos;t deliver here</Badge>
            ) : null}
            {detail.is_featured ? (
              <Badge variant="success">Featured</Badge>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                             Left category nav                              */
/* -------------------------------------------------------------------------- */
function CategoryNav({ menu }: { menu: RestaurantMenu | undefined }) {
  if (!menu) {
    return (
      <nav className="hidden lg:block" aria-hidden>
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Menu categories"
      className="hidden lg:sticky lg:top-24 lg:block lg:self-start"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Menu
      </p>
      <ul className="space-y-1">
        {menu.categories.map((group) => (
          <li key={group.category.id}>
            <a
              href={`#${group.category.slug}`}
              className={cn(
                'block rounded-md px-3 py-1.5 text-sm text-muted-foreground',
                'hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {group.category.name}
              <span className="ml-1 text-xs">({group.items.length})</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/*                                Cart summary                                */
/* -------------------------------------------------------------------------- */
function CartSummary({ restaurantId }: { restaurantId: string | undefined }) {
  const count = useCartStore(selectCartCount);
  const total = useCartStore(selectCartTotal);
  const cartRestaurantId = useCartStore(selectCartRestaurantId);
  const lines = useCartStore((s) => s.lines);

  const isThisRestaurant =
    cartRestaurantId && restaurantId && cartRestaurantId === restaurantId;
  const relevantLines = useMemo(
    () => (isThisRestaurant ? lines : []),
    [isThisRestaurant, lines],
  );

  return (
    <aside
      aria-label="Cart summary"
      className="h-fit rounded-lg border border-border bg-card p-5 lg:sticky lg:top-24"
    >
      <div className="mb-3 flex items-center gap-2">
        <ShoppingBag className="size-5 text-primary" aria-hidden />
        <h2 className="text-lg font-semibold">Your order</h2>
      </div>

      {count === 0 || !isThisRestaurant ? (
        <p className="text-sm text-muted-foreground">
          {count === 0
            ? 'Add items from the menu to get started.'
            : 'Your cart has items from a different restaurant. Adding new items will replace them.'}
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {relevantLines.map((l) => (
              <li
                key={l.clientId}
                className="flex items-start justify-between gap-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{l.name}</p>
                  <p className="text-xs text-muted-foreground">Qty {l.qty}</p>
                </div>
                <span className="shrink-0 font-medium">
                  {formatPrice(String(Number(l.price) * l.qty))}
                </span>
              </li>
            ))}
          </ul>

          <Separator className="my-4" />

          <div className="flex items-center justify-between text-sm font-semibold">
            <span>Subtotal</span>
            <span>{formatPrice(total.toFixed(2))}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Taxes &amp; delivery calculated at checkout.
          </p>

          <Button className="mt-4 w-full" disabled>
            Proceed to checkout
          </Button>
        </>
      )}
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/*                               Menu skeleton                                */
/* -------------------------------------------------------------------------- */
function MenuSkeleton() {
  return (
    <div className="space-y-8" aria-hidden>
      {Array.from({ length: 2 }).map((_, catIdx) => (
        <div key={catIdx} className="space-y-3">
          <Skeleton className="h-6 w-32" />
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4"
              >
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                </div>
                <Skeleton className="size-24 rounded-md" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Utils                                    */
/* -------------------------------------------------------------------------- */
function formatTime(raw: string): string {
  // Backend sends `HH:mm:ss`. Trim seconds for display.
  if (!raw) return '';
  const [hh, mm] = raw.split(':');
  if (hh === undefined || mm === undefined) return raw;
  const hours = Number(hh);
  const minutes = mm;
  const period = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${minutes} ${period}`;
}

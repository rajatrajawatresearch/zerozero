/**
 * `/orders/:id` — single-order detail view.
 *
 * Layout (desktop):
 *   hero (restaurant + short id)   → large banner strip
 *   stepper (6-step progress)      → full width
 *   left column: items list         right column: summary + actions
 *   tracking map (when status is live)
 *
 * Side-effects:
 *  - Reads `?new=1` once on mount to show a one-shot "Order placed!" toast.
 *    The flag is consumed immediately (URL rewritten without `new`) so a
 *    refresh doesn't re-trigger the toast.
 *  - `useOrderTrackQuery` polls every 10s while the status is mid-flight so
 *    the stepper + map stay fresh without a manual refresh.
 */
import { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, MapPin, Share2, Star } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { useOrderDetailQuery, useOrderTrackQuery } from '../api';
import { CancelButton } from '../components/CancelButton';
import { OrderItemsList } from '../components/OrderItemsList';
import { OrderStatusStepper } from '../components/OrderStatusStepper';
import { OrderSummaryBox } from '../components/OrderSummaryBox';
import { ReviewModal } from '../components/ReviewModal';
import { TrackingMap } from '../components/TrackingMap';
import { useRelativeTime } from '../hooks';
import type { OrderDetailOut, OrderStatus } from '../types';
import { ACTIVE_STATUSES } from '../types';

/* -------------------------------------------------------------------------- */
/*                                Helpers                                     */
/* -------------------------------------------------------------------------- */
function isLive(status: OrderStatus): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

/* -------------------------------------------------------------------------- */
/*                                   Page                                     */
/* -------------------------------------------------------------------------- */
export default function OrderDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [reviewOpen, setReviewOpen] = useState(false);

  const detailQ = useOrderDetailQuery(id);
  const order = detailQ.data;

  // Enable live polling only while the order is in-flight.
  const shouldTrack = order ? isLive(order.status) : false;
  useOrderTrackQuery(shouldTrack ? id : undefined);

  // One-shot "Order placed!" toast when navigated from checkout.
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    toast.success('Order placed!', {
      description: 'Track your order below.',
    });
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('new');
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  if (detailQ.isError) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-6 py-20 text-center">
        <AlertCircle className="size-8 text-destructive" aria-hidden />
        <h1 className="text-xl font-semibold">Could not load order</h1>
        <p className="text-sm text-muted-foreground">
          {detailQ.error instanceof Error ? detailQ.error.message : 'Unknown error'}
        </p>
        <Button asChild variant="outline" className="mt-2">
          <Link to="/orders">
            <ArrowLeft className="size-4" aria-hidden />
            Back to orders
          </Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <Link to="/orders">
            <ArrowLeft className="size-4" aria-hidden />
            All orders
          </Link>
        </Button>
      </div>

      <OrderHero order={order} isLoading={detailQ.isLoading && !order} />

      {/* Stepper */}
      <section className="mt-6 rounded-lg border border-border bg-card p-5">
        {order ? (
          <OrderStatusStepper status={order.status} />
        ) : (
          <Skeleton className="h-10 w-full" />
        )}
      </section>

      {/* Tracking map — only while live */}
      {order && shouldTrack ? (
        <LiveTrackingBlock orderId={order.id} order={order} />
      ) : null}

      {/* Items + summary */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Items
          </h2>
          {order ? (
            <OrderItemsList items={order.items} />
          ) : (
            <Skeleton className="h-40 w-full" />
          )}

          {order?.notes ? (
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Notes to restaurant
              </p>
              <p className="mt-1 text-sm text-foreground">{order.notes}</p>
            </div>
          ) : null}

          {order?.address ? (
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Delivery address
              </p>
              <p className="mt-1 inline-flex items-start gap-2 text-sm text-foreground">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>
                  <span className="font-medium">{order.address.label}</span> &middot;{' '}
                  {order.address.line1}
                  {order.address.line2 ? `, ${order.address.line2}` : ''}, {order.address.city}{' '}
                  {order.address.pincode}
                </span>
              </p>
            </div>
          ) : null}
        </section>

        <aside className="space-y-4">
          {order ? (
            <OrderSummaryBox
              subtotal={order.subtotal}
              discount={order.discount}
              delivery_fee={order.delivery_fee}
              tax={order.tax}
              total={order.total}
              promoCode={order.promo_code}
            />
          ) : (
            <Skeleton className="h-60 w-full" />
          )}

          {order ? (
            <div className="flex flex-col gap-2">
              <CancelButton orderId={order.id} status={order.status} />

              {order.status === 'delivered' ? (
                <Button type="button" onClick={() => setReviewOpen(true)}>
                  <Star className="size-4" aria-hidden />
                  Leave a review
                </Button>
              ) : null}

              {order.share_token ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const url = `${window.location.origin}/track/${order.share_token}`;
                    navigator.clipboard
                      ?.writeText(url)
                      .then(() => toast.success('Tracking link copied'))
                      .catch(() => toast.error('Could not copy link'));
                  }}
                >
                  <Share2 className="size-4" aria-hidden />
                  Share tracking link
                </Button>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>

      {order ? (
        <ReviewModal
          orderId={order.id}
          open={reviewOpen}
          onOpenChange={setReviewOpen}
        />
      ) : null}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Hero                                     */
/* -------------------------------------------------------------------------- */
function OrderHero({
  order,
  isLoading,
}: {
  order: OrderDetailOut | undefined;
  isLoading: boolean;
}): React.ReactElement {
  const placedLabel = useRelativeTime(order?.placed_at);

  if (isLoading || !order) {
    return (
      <section className="flex gap-4 rounded-lg border border-border bg-card p-5">
        <Skeleton className="size-20 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-1/4" />
        </div>
      </section>
    );
  }

  return (
    <section className="flex items-center gap-4 rounded-lg border border-border bg-card p-5">
      <div className="relative size-20 shrink-0 overflow-hidden rounded-lg bg-muted">
        {order.restaurant_image ? (
          <img
            src={order.restaurant_image}
            alt=""
            loading="eager"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <MapPin className="size-6" aria-hidden />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h1 className="line-clamp-1 text-xl font-bold tracking-tight">
          {order.restaurant_name}
        </h1>
        <p className="text-xs text-muted-foreground">
          Order #{order.short_id} &middot; Placed {placedLabel}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant="outline">
            {order.payment_method.toUpperCase()} &middot; {order.payment_status}
          </Badge>
          {order.promo_code ? (
            <Badge variant="success">Promo {order.promo_code}</Badge>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                           Live tracking block                              */
/* -------------------------------------------------------------------------- */
/**
 * Thin wrapper that subscribes to `/orders/:id/track` and forwards the
 * latest snapshot into `TrackingMap`. We pull the restaurant coords from
 * the parent order payload (address-based approximation) because the
 * tracking endpoint is lightweight and does not repeat the restaurant lat.
 */
function LiveTrackingBlock({
  orderId,
  order,
}: {
  orderId: string;
  order: OrderDetailOut;
}): React.ReactElement {
  const trackQ = useOrderTrackQuery(orderId, { refetchInterval: 10_000 });
  const partner = trackQ.data?.partner_location ?? null;
  const eta = trackQ.data?.eta_minutes ?? null;

  // Fall back to the delivery address coords for the origin pin until the
  // backend ships restaurant coords on the track payload (Phase 4). The
  // address is geocoded at placement time so this is good enough for v1.
  const restaurant =
    trackQ.data?.restaurant_lat !== undefined && trackQ.data?.restaurant_lng !== undefined
      ? {
          lat: trackQ.data.restaurant_lat,
          lng: trackQ.data.restaurant_lng,
          name: trackQ.data.restaurant_name ?? order.restaurant_name,
        }
      : order.address
        ? { lat: order.address.lat, lng: order.address.lng, name: order.restaurant_name }
        : null;

  return (
    <section className="mt-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Live tracking
      </h2>
      <TrackingMap
        restaurant={restaurant}
        partnerLocation={partner}
        etaMinutes={eta}
      />
    </section>
  );
}

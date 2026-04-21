/**
 * `/track/:shareToken` — public, unauthenticated tracking view.
 *
 * The share token (`uuid4().hex`) is generated at order placement and is
 * the only credential required to see progress — no login wall, so the
 * customer can forward the link to friends/family.
 *
 * Backend route: `GET /orders/track/{token}` (no auth). We call it via
 * `useOrderTrackQuery(token, { isPublicToken: true })` which forces
 * `skipAuth: true` on the fetch.
 *
 * Layout is intentionally lean — stepper + map only, no surrounding chrome
 * from the order itself. The parent route in Agent 10's merge decides
 * whether to wrap this in the AppShell or render standalone.
 */
import { AlertCircle } from 'lucide-react';
import { useParams } from 'react-router';

import { Skeleton } from '@/components/ui/skeleton';

import { useOrderTrackQuery } from '../api';
import { OrderStatusStepper } from '../components/OrderStatusStepper';
import { TrackingMap } from '../components/TrackingMap';

/* -------------------------------------------------------------------------- */
/*                                   Page                                     */
/* -------------------------------------------------------------------------- */
export default function PublicTrackPage(): React.ReactElement {
  const { shareToken } = useParams<{ shareToken: string }>();
  const trackQ = useOrderTrackQuery(shareToken, {
    isPublicToken: true,
    refetchInterval: 10_000,
  });

  const track = trackQ.data;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Order tracking</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live updates refresh automatically every 10 seconds.
        </p>
      </header>

      {trackQ.isError ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-10 text-center">
          <AlertCircle className="size-8 text-destructive" aria-hidden />
          <h2 className="text-base font-semibold">This tracking link doesn&apos;t work</h2>
          <p className="text-sm text-muted-foreground">
            The link may be expired or invalid.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-5">
            {track ? (
              <OrderStatusStepper status={track.status} />
            ) : (
              <Skeleton className="h-10 w-full" />
            )}
          </section>

          <TrackingMap
            restaurant={
              track?.restaurant_lat !== undefined && track?.restaurant_lng !== undefined
                ? {
                    lat: track.restaurant_lat,
                    lng: track.restaurant_lng,
                    name: track.restaurant_name ?? null,
                  }
                : null
            }
            partnerLocation={track?.partner_location ?? null}
            etaMinutes={track?.eta_minutes ?? null}
          />
        </div>
      )}
    </main>
  );
}

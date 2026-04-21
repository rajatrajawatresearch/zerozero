/**
 * `/dev/partner` — dev-only delivery partner walkthrough.
 *
 * Walks through the lifecycle a partner would experience in prod:
 *
 *   1. Role gate (redirect unless `partner | admin`)
 *   2. "Go online" pulls a one-shot browser fix and POSTs `/partner/online`
 *   3. Lists all active orders (Phase 4 doesn't auto-assign — we show every
 *      live order so the dev can pick one manually)
 *   4. Selecting an order opens `AssignmentCard` + `StatusButtons`
 *   5. Location streamer + route simulator can both be toggled for demos
 *
 * This page deliberately avoids `ProtectedRoute` — the gate is inline so
 * admins can also land here without flipping their role in the store.
 */
import { useState } from 'react';
import { Loader2, MapPin, PlayCircle, Radio, ShieldAlert } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/features/auth/hooks';
import {
  joinStatuses,
  useOrderDetailQuery,
  useOrdersQuery,
} from '@/features/orders/api';
import { ACTIVE_STATUSES, type OrderListItem } from '@/features/orders/types';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

import { useGoOnlineMutation } from '../api';
import { AssignmentCard } from '../components/AssignmentCard';
import { LocationStreamer } from '../components/LocationStreamer';
import { RouteSimulator } from '../components/RouteSimulator';
import { StatusButtons } from '../components/StatusButtons';
import { getCurrentPosition } from '../hooks';

/* -------------------------------------------------------------------------- */
/*                                   Page                                     */
/* -------------------------------------------------------------------------- */
export default function PartnerSimPage(): React.ReactElement {
  const { user, isAuthenticated, isLoading } = useAuth();

  /* ------------------------------- Role gate -------------------------------*/
  if (isLoading) {
    return (
      <main
        className="flex min-h-[50vh] items-center justify-center text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
        <span className="sr-only">Loading your session</span>
      </main>
    );
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace state={{ from: { pathname: '/dev/partner' } }} />;
  }

  const isAllowed = user.role === 'partner' || user.role === 'admin';
  if (!isAllowed) {
    return <Navigate to="/" replace />;
  }

  return <PartnerSimBody />;
}

/* -------------------------------------------------------------------------- */
/*                                   Body                                     */
/* -------------------------------------------------------------------------- */
function PartnerSimBody(): React.ReactElement {
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const goOnline = useGoOnlineMutation();

  // "Active" == everything currently in flight. Phase 4 simulator surfaces
  // the whole pool because assignment is manual in dev.
  const ordersQ = useOrdersQuery({ status: joinStatuses(ACTIVE_STATUSES) });

  const handleGoOnline = async (): Promise<void> => {
    try {
      const point = await getCurrentPosition();
      const result = await goOnline.mutateAsync({
        lat: point.lat,
        lng: point.lng,
      });
      setIsOnline(result.is_online);
      toast.success('You are now online');
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : 'Could not go online';
      toast.error(message);
    }
  };

  const selectedDetailQ = useOrderDetailQuery(selectedId ?? undefined);
  const selectedDetail = selectedDetailQ.data;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <ShieldAlert className="size-3.5" aria-hidden />
          Dev-only tool
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Partner simulator</h1>
        <p className="text-sm text-muted-foreground">
          Walk through a delivery end-to-end. Go online, accept an active order,
          advance its status, and stream location breadcrumbs from the browser
          or a fake route.
        </p>
      </header>

      {/* Online toggle */}
      <section className="mb-6">
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Radio
                  className={cn(
                    'size-4',
                    isOnline ? 'text-emerald-500' : 'text-muted-foreground',
                  )}
                  aria-hidden
                />
                <h2 className="text-sm font-semibold">
                  {isOnline ? 'You are online' : 'You are offline'}
                </h2>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Grants you a fresh location fix and flips the partner availability flag.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => {
                void handleGoOnline();
              }}
              disabled={goOnline.isPending}
              variant={isOnline ? 'outline' : 'default'}
            >
              {goOnline.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Requesting fix
                </>
              ) : isOnline ? (
                'Refresh location'
              ) : (
                'Go online'
              )}
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* Two-column: order list + active assignment */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        {/* ---------------------------- Order list -------------------------*/}
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Active orders
          </h2>
          {ordersQ.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          ) : ordersQ.isError ? (
            <Card>
              <CardContent className="p-4 text-sm text-destructive">
                Could not load orders
                {ordersQ.error instanceof Error ? `: ${ordersQ.error.message}` : ''}.
              </CardContent>
            </Card>
          ) : (ordersQ.data?.items.length ?? 0) === 0 ? (
            <Card>
              <CardContent className="p-4 text-sm text-muted-foreground">
                No active orders in the system. Place one as a customer first, then come
                back here to walk it through.
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-2" aria-label="Active orders">
              {ordersQ.data?.items.map((order) => (
                <li key={order.id}>
                  <OrderPickTile
                    order={order}
                    selected={order.id === selectedId}
                    onSelect={() => setSelectedId(order.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* --------------------------- Active panel ------------------------*/}
        <section>
          {!selectedId ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                <PlayCircle className="size-8 text-muted-foreground" aria-hidden />
                <div>
                  <h2 className="text-base font-semibold">Pick an order</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Select an order from the list to accept, advance status,
                    or simulate delivery.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : selectedDetailQ.isLoading ? (
            <Skeleton className="h-64 w-full rounded-lg" />
          ) : selectedDetailQ.isError || !selectedDetail ? (
            <Card>
              <CardContent className="flex flex-col items-start gap-2 p-4">
                <p className="text-sm text-destructive">Could not load order.</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void navigate(0)}
                >
                  Retry
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Tabs defaultValue="assignment" className="w-full">
              <TabsList>
                <TabsTrigger value="assignment">Assignment</TabsTrigger>
                <TabsTrigger value="status">Status</TabsTrigger>
                <TabsTrigger value="live">Live GPS</TabsTrigger>
                <TabsTrigger value="fake">Fake route</TabsTrigger>
              </TabsList>

              <TabsContent value="assignment" className="pt-4">
                <AssignmentCard order={selectedDetail} />
              </TabsContent>

              <TabsContent value="status" className="pt-4">
                <Card>
                  <CardContent className="flex flex-col gap-3 p-4">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                      Current
                      <Badge variant="outline">
                        {selectedDetail.status.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <StatusButtons
                      orderId={selectedDetail.id}
                      currentStatus={selectedDetail.status}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="live" className="pt-4">
                <LocationStreamer />
              </TabsContent>

              <TabsContent value="fake" className="pt-4">
                <RouteSimulator
                  from={
                    selectedDetail.address
                      ? // Placeholder: the detail payload doesn't ship the
                        // restaurant's coords, so we nudge the drop coords
                        // slightly north-east as a stand-in pickup. Phase 4
                        // adds restaurant coords to the track endpoint; this
                        // dev tool will switch to those once available.
                        {
                          lat: selectedDetail.address.lat + 0.01,
                          lng: selectedDetail.address.lng + 0.01,
                        }
                      : null
                  }
                  to={
                    selectedDetail.address
                      ? {
                          lat: selectedDetail.address.lat,
                          lng: selectedDetail.address.lng,
                        }
                      : null
                  }
                  routeLabel={`${selectedDetail.restaurant_name} → ${selectedDetail.address?.label ?? 'drop'}`}
                />
              </TabsContent>
            </Tabs>
          )}
        </section>
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Order pick tile                                */
/* -------------------------------------------------------------------------- */
function OrderPickTile({
  order,
  selected,
  onSelect,
}: {
  order: OrderListItem;
  selected: boolean;
  onSelect: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-lg border p-3 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/5'
          : 'border-border bg-card hover:bg-accent/40',
      )}
      aria-pressed={selected}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            #{order.short_id}
          </p>
          <p className="line-clamp-1 text-sm font-semibold text-foreground">
            {order.restaurant_name}
          </p>
        </div>
        <Badge variant="outline">{order.status.replace(/_/g, ' ')}</Badge>
      </div>
      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        <MapPin className="size-3" aria-hidden />
        {order.item_count} item{order.item_count === 1 ? '' : 's'}
      </p>
    </button>
  );
}

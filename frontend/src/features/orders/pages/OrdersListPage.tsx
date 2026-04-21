/**
 * `/orders` — tabbed history of the current user's orders.
 *
 * Two tabs:
 *  - **Active**: any status in `ACTIVE_STATUSES` (placed … out_for_delivery)
 *  - **Past**: delivered / cancelled / failed
 *
 * The active tab is URL-backed via `?tab=active|past` so refreshing and deep
 * links preserve the selection.
 *
 * Ordering: most-recent-first (relies on backend list ordering). The list
 * endpoint is a `PageOut` envelope; Phase 3 scope uses the first page only —
 * pagination UI can land in Phase 4 alongside infinite-scroll.
 */
import { AlertCircle, ShoppingBag } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { joinStatuses, useOrdersQuery } from '../api';
import { OrderCard } from '../components/OrderCard';
import { ACTIVE_STATUSES, type OrderListItem, type OrderStatus } from '../types';

/* -------------------------------------------------------------------------- */
/*                                 Tab parsing                                */
/* -------------------------------------------------------------------------- */
type TabKey = 'active' | 'past';
const PAST_STATUSES: readonly OrderStatus[] = ['delivered', 'cancelled', 'failed'];

function parseTab(raw: string | null): TabKey {
  return raw === 'past' ? 'past' : 'active';
}

/* -------------------------------------------------------------------------- */
/*                                   Page                                     */
/* -------------------------------------------------------------------------- */
export default function OrdersListPage(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseTab(searchParams.get('tab'));

  const statuses = tab === 'active' ? ACTIVE_STATUSES : PAST_STATUSES;
  const statusParam = joinStatuses(statuses);
  const query = useOrdersQuery(statusParam ? { status: statusParam } : {});

  const setTab = (next: TabKey): void => {
    setSearchParams(
      (prev) => {
        const nextParams = new URLSearchParams(prev);
        if (next === 'active') nextParams.delete('tab');
        else nextParams.set('tab', next);
        return nextParams;
      },
      { replace: true },
    );
  };

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track in-progress orders and revisit your history.
          </p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="past">Past</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="pt-4">
          <OrdersGrid
            isLoading={query.isLoading}
            isError={query.isError}
            items={query.data?.items ?? []}
            emptyTitle="No active orders"
            emptyMessage="When you place an order, you'll see it here with live tracking."
          />
        </TabsContent>

        <TabsContent value="past" className="pt-4">
          <OrdersGrid
            isLoading={query.isLoading}
            isError={query.isError}
            items={query.data?.items ?? []}
            emptyTitle="No past orders yet"
            emptyMessage="Completed and cancelled orders will appear here."
          />
        </TabsContent>
      </Tabs>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/*                               Grid + states                                */
/* -------------------------------------------------------------------------- */
function OrdersGrid({
  isLoading,
  isError,
  items,
  emptyTitle,
  emptyMessage,
}: {
  isLoading: boolean;
  isError: boolean;
  items: OrderListItem[];
  emptyTitle: string;
  emptyMessage: string;
}): React.ReactElement {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-10 text-center">
        <AlertCircle className="size-8 text-destructive" aria-hidden />
        <p className="text-sm text-muted-foreground">
          Could not load your orders. Please try again.
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-10 text-center">
        <ShoppingBag className="size-8 text-muted-foreground" aria-hidden />
        <div>
          <h2 className="text-base font-semibold">{emptyTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
        <Button asChild variant="outline" className="mt-2">
          <Link to="/">Browse restaurants</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {items.map((order) => (
        <OrderCard key={order.id} order={order} />
      ))}
    </div>
  );
}

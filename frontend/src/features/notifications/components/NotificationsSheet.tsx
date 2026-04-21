/**
 * Right-side slide-in sheet that lists the current user's notifications.
 *
 * Composition:
 *   - Header with "Notifications" + "Mark all read"
 *   - Tabs: All / Unread (local client-side filter using two queries)
 *   - Scrollable list of `<NotificationItem />`
 *   - Skeleton → empty → happy-path cascade
 *
 * State ownership: this is a controlled component — the parent
 * (`NotificationBell`) owns the open flag so the bell icon can flip its
 * aria-expanded state without reaching into the sheet.
 */
import { CheckCheck, Inbox, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

import { useMarkAllReadMutation, useNotificationsQuery } from '../api';
import { NotificationItem } from './NotificationItem';

/* -------------------------------------------------------------------------- */
/*                                    Props                                   */
/* -------------------------------------------------------------------------- */
export interface NotificationsSheetProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

type Filter = 'all' | 'unread';

/* -------------------------------------------------------------------------- */
/*                                 Component                                  */
/* -------------------------------------------------------------------------- */
export function NotificationsSheet({
  open,
  onOpenChange,
}: NotificationsSheetProps): React.ReactElement {
  const [filter, setFilter] = useState<Filter>('all');
  const query = useNotificationsQuery({
    ...(filter === 'unread' ? { unread: true } : {}),
    page: 1,
    pageSize: 30,
  });
  const markAll = useMarkAllReadMutation();

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const hasUnread = items.some((n) => !n.is_read);

  const onMarkAll = () => {
    markAll.mutate(undefined, {
      onSuccess: () => toast.success('All notifications marked as read'),
      onError: (err) => {
        const msg = err instanceof ApiError ? err.detail : 'Could not mark all read';
        toast.error(msg);
      },
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        aria-label="Notifications"
      >
        <SheetHeader className="flex flex-row items-center justify-between gap-2 space-y-0 border-b border-border px-4 py-4">
          <SheetTitle>Notifications</SheetTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onMarkAll}
            disabled={!hasUnread || markAll.isPending}
            className="gap-1"
          >
            {markAll.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <CheckCheck className="size-4" aria-hidden />
            )}
            Mark all read
          </Button>
        </SheetHeader>

        {/* Local tabs — two separate cached queries so flipping is instant. */}
        <div
          role="tablist"
          aria-label="Filter notifications"
          className="flex items-center gap-1 border-b border-border px-4 py-2"
        >
          <FilterTab
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            label="All"
          />
          <FilterTab
            active={filter === 'unread'}
            onClick={() => setFilter('unread')}
            label="Unread"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {query.isLoading ? (
            <ListSkeleton />
          ) : query.isError ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-destructive">
              Could not load notifications.
            </div>
          ) : items.length === 0 ? (
            <EmptyState filter={filter} />
          ) : (
            <ul role="list" className="flex flex-col gap-1">
              {items.map((n) => (
                <li key={n.id}>
                  <NotificationItem
                    notification={n}
                    onNavigate={() => onOpenChange(false)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Subparts                                  */
/* -------------------------------------------------------------------------- */
function FilterTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      {label}
    </button>
  );
}

function EmptyState({ filter }: { filter: Filter }): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
      <Inbox className="size-8" aria-hidden />
      <p className="text-sm font-medium text-foreground">
        {filter === 'unread' ? 'All caught up' : 'No notifications yet'}
      </p>
      <p className="text-xs">
        {filter === 'unread'
          ? 'New notifications will show up here.'
          : "We'll let you know when something happens on your orders."}
      </p>
    </div>
  );
}

function ListSkeleton(): React.ReactElement {
  return (
    <ul className="flex flex-col gap-2 px-1" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="flex items-start gap-3 rounded-md p-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default NotificationsSheet;

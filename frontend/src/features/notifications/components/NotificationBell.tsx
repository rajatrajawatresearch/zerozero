/**
 * Header bell icon + unread-count badge.
 *
 * Responsibilities:
 *   - Reads the unread count from `useUnreadCountQuery` (polled + WS-pushed)
 *   - Opens `<NotificationsSheet />` on click — owns the open flag so the
 *     sheet is a pure controlled component
 *   - Keeps exactly ONE active WebSocket per tab via `useNotificationsSocket`
 *
 * Only renders when the user is authenticated — the header already guards the
 * mount site, but we re-check here to make the component self-contained for
 * storybook + tests.
 */
import { Bell } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/hooks';
import { cn } from '@/lib/utils';

import { useUnreadCountQuery } from '../api';
import { useNotificationsSocket } from '../hooks';
import { NotificationsSheet } from './NotificationsSheet';

/* -------------------------------------------------------------------------- */
/*                                    Props                                   */
/* -------------------------------------------------------------------------- */
export interface NotificationBellProps {
  /** Optional override for positioning in narrow headers. */
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*                                 Component                                  */
/* -------------------------------------------------------------------------- */
export function NotificationBell({ className }: NotificationBellProps): React.ReactElement | null {
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);

  // Hook-order-friendly: declare these unconditionally — they no-op when
  // unauthenticated (socket) or disabled (query stays enabled but the server
  // would 401 if the token is missing; useAuth gates rendering below).
  const unreadQuery = useUnreadCountQuery();
  useNotificationsSocket();

  if (!isAuthenticated) return null;

  const rawCount = unreadQuery.data?.count ?? 0;
  const displayCount = rawCount > 99 ? '99+' : String(rawCount);
  const hasUnread = rawCount > 0;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label={
          hasUnread
            ? `Notifications (${rawCount} unread)`
            : 'Notifications'
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn('relative rounded-full', className)}
      >
        <Bell className="size-5" aria-hidden />
        {hasUnread ? (
          <span
            aria-hidden
            className={cn(
              'absolute -top-0.5 -right-0.5 inline-flex min-w-[1.125rem] items-center justify-center rounded-full',
              'bg-destructive px-1 text-[0.625rem] font-semibold leading-none text-destructive-foreground',
              'border border-background',
            )}
          >
            {displayCount}
          </span>
        ) : null}
      </Button>

      <NotificationsSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

export default NotificationBell;

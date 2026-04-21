/**
 * Single row inside the notifications sheet.
 *
 * Visual language:
 *  - Unread rows use a primary-tinted background (`bg-primary/5`) + a dot
 *    marker, so the user can scan the list in one pass.
 *  - Icon is selected based on `type` so order-status, promos, and generic
 *    system messages are distinguishable without reading the title.
 *  - Clicking an unread row marks it as read via the mutation and (for
 *    order-status) navigates to the matching order detail page.
 */
import { Bell, Gift, PackageCheck } from 'lucide-react';
import { useNavigate } from 'react-router';

import { useRelativeTime } from '@/features/orders/hooks';
import { cn } from '@/lib/utils';

import { useMarkReadMutation } from '../api';
import type { NotificationOut, NotificationType } from '../types';

/* -------------------------------------------------------------------------- */
/*                                    Props                                   */
/* -------------------------------------------------------------------------- */
export interface NotificationItemProps {
  notification: NotificationOut;
  /** Called after a successful interaction so the parent sheet can close. */
  onNavigate?: () => void;
}

/* -------------------------------------------------------------------------- */
/*                                Icon lookup                                 */
/* -------------------------------------------------------------------------- */
const ICON_MAP: Record<NotificationType, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  order_status: PackageCheck,
  promo: Gift,
  generic: Bell,
};

/* -------------------------------------------------------------------------- */
/*                                 Component                                  */
/* -------------------------------------------------------------------------- */
export function NotificationItem({
  notification,
  onNavigate,
}: NotificationItemProps): React.ReactElement {
  const timeLabel = useRelativeTime(notification.created_at);
  const navigate = useNavigate();
  const markRead = useMarkReadMutation();

  const Icon = ICON_MAP[notification.type] ?? Bell;
  const isUnread = !notification.is_read;

  /** Extract an order_id safely for order_status notifications. */
  const targetPath = (() => {
    if (notification.type !== 'order_status') return null;
    const raw = notification.payload?.['order_id'];
    return typeof raw === 'string' && raw.length > 0 ? `/orders/${raw}` : null;
  })();

  const handleActivate = () => {
    if (isUnread) markRead.mutate(notification.id);
    if (targetPath) {
      void navigate(targetPath);
      onNavigate?.();
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleActivate();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleActivate}
      onKeyDown={handleKey}
      aria-label={`${notification.title}${isUnread ? ' (unread)' : ''}`}
      className={cn(
        'flex items-start gap-3 rounded-md p-3 text-left outline-none transition-colors',
        'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
        isUnread && 'bg-primary/5',
      )}
    >
      <div
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
          isUnread ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
        )}
        aria-hidden
      >
        <Icon className="size-4" aria-hidden />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              'truncate text-sm',
              isUnread ? 'font-semibold text-foreground' : 'font-medium text-foreground/90',
            )}
          >
            {notification.title}
          </p>
          <time
            dateTime={notification.created_at}
            title={new Date(notification.created_at).toLocaleString()}
            className="shrink-0 text-xs text-muted-foreground"
          >
            {timeLabel}
          </time>
        </div>
        {notification.body ? (
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
            {notification.body}
          </p>
        ) : null}
      </div>

      {isUnread ? (
        <span
          aria-hidden
          className="mt-2 size-2 shrink-0 rounded-full bg-primary"
        />
      ) : null}
    </div>
  );
}

export default NotificationItem;

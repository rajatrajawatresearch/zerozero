/**
 * Feature-local hooks for the Orders slice.
 *
 * `useRelativeTime` formats a wire-format ISO string into a friendly
 * "2 hours ago" label that auto-refreshes every minute while visible.
 *
 * `useOrderProgress` derives the current stepper position from an
 * `OrderStatus` value — keeps step-index logic out of the component.
 */
import { useEffect, useState } from 'react';

import type { OrderStatus } from './types';
import { ORDER_PROGRESS_STEPS } from './types';

/* -------------------------------------------------------------------------- */
/*                              Relative time label                           */
/* -------------------------------------------------------------------------- */
/** Lightweight formatter — no date-fns import needed for this tiny surface. */
export function formatRelativeTime(isoString: string | null | undefined): string {
  if (!isoString) return '';
  const t = Date.parse(isoString);
  if (Number.isNaN(t)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/**
 * Live-updating relative time. Re-renders the consuming component every
 * 60 seconds so the label stays fresh without a page refresh.
 */
export function useRelativeTime(isoString: string | null | undefined): string {
  const [label, setLabel] = useState(() => formatRelativeTime(isoString));

  useEffect(() => {
    setLabel(formatRelativeTime(isoString));
    if (!isoString) return;
    const id = setInterval(() => {
      setLabel(formatRelativeTime(isoString));
    }, 60_000);
    return () => clearInterval(id);
  }, [isoString]);

  return label;
}

/* -------------------------------------------------------------------------- */
/*                             Progress derivation                            */
/* -------------------------------------------------------------------------- */
export interface OrderProgress {
  /** Index into `ORDER_PROGRESS_STEPS`, or -1 if status is off-trail. */
  index: number;
  /** True when the order terminated via cancellation. */
  isCancelled: boolean;
  /** True when the order is fully delivered. */
  isDelivered: boolean;
  /** True when the order is terminated in a failure state. */
  isFailed: boolean;
}

/** Pure derivation — safe to call inside render or event handlers. */
export function deriveOrderProgress(status: OrderStatus): OrderProgress {
  if (status === 'cancelled') {
    return { index: -1, isCancelled: true, isDelivered: false, isFailed: false };
  }
  if (status === 'failed') {
    return { index: -1, isCancelled: false, isDelivered: false, isFailed: true };
  }
  const index = ORDER_PROGRESS_STEPS.indexOf(status);
  return {
    index,
    isCancelled: false,
    isDelivered: status === 'delivered',
    isFailed: false,
  };
}

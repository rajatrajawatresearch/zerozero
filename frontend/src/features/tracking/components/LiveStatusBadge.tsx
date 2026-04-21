/**
 * Small badge that pulses on each live WS event.
 *
 * Drives a short (900 ms) "ping" animation every time `lastTick` bumps —
 * giving users a visual heartbeat that the tracking feed is actually
 * live. Falls back to a muted "offline" pill when the socket isn't
 * open. No hardcoded colours — rule #8 respected.
 */
import { useEffect, useState } from 'react';
import { Radio, WifiOff } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { WsState } from '@/lib/ws';

export interface LiveStatusBadgeProps {
  /** WS state from `useOrderTrackingSocket` / `usePublicTrackingSocket`. */
  liveState: WsState;
  /** Monotonic counter — bump triggers a short pulse animation. */
  lastTick: number;
  className?: string;
}

const PULSE_MS = 900;

export function LiveStatusBadge({
  liveState,
  lastTick,
  className,
}: LiveStatusBadgeProps): React.ReactElement {
  const [pulsing, setPulsing] = useState(false);

  // Flash on every incoming event, then settle.
  useEffect(() => {
    if (lastTick === 0) return;
    setPulsing(true);
    const timer = setTimeout(() => setPulsing(false), PULSE_MS);
    return () => clearTimeout(timer);
  }, [lastTick]);

  if (liveState !== 'open') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground',
          className,
        )}
        role="status"
        aria-live="polite"
      >
        <WifiOff className="size-3" aria-hidden />
        {liveState === 'reconnecting' ? 'Reconnecting…' : 'Offline'}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'relative inline-flex items-center gap-1.5 rounded-full border border-border bg-success/10 px-2.5 py-1 text-xs font-semibold text-success',
        className,
      )}
      role="status"
      aria-live="polite"
      data-pulsing={pulsing ? 'true' : 'false'}
    >
      {/* Outer ping (only while pulsing) */}
      <span
        aria-hidden
        className={cn(
          'absolute -left-0.5 top-1/2 size-2 -translate-y-1/2 rounded-full bg-success',
          pulsing ? 'animate-ping opacity-75' : 'opacity-0',
        )}
      />
      <Radio
        className={cn(
          'size-3 transition-transform',
          pulsing ? 'scale-110' : 'scale-100',
        )}
        aria-hidden
      />
      Live
    </span>
  );
}

export default LiveStatusBadge;

/**
 * Dev-only canned route player.
 *
 * Walks a straight line between a restaurant pin and the customer drop
 * address in 20 equidistant steps (one per 3 seconds). Each step POSTs a
 * single synthetic `{lat, lng, recorded_at}` to `/partner/location`.
 *
 * The customer's live-tracking UI consumes the fanned-out updates from
 * Redis so the demo replays exactly like a real delivery — useful for
 * recording video walkthroughs without actually driving around.
 */
import { useState } from 'react';
import { Pause, Play, Route } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import type { LatLng } from '@/types';

import { pushSingleLocation } from '../api';
import { useRouteSimulation } from '../hooks';
import type { StreamPoint } from '../types';

/* -------------------------------------------------------------------------- */
/*                                   Props                                    */
/* -------------------------------------------------------------------------- */
export interface RouteSimulatorProps {
  /** Restaurant pickup location. */
  from: LatLng | null;
  /** Customer drop location. */
  to: LatLng | null;
  /** Optional label describing the simulated route. */
  routeLabel?: string;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*                                 Component                                  */
/* -------------------------------------------------------------------------- */
export function RouteSimulator({
  from,
  to,
  routeLabel,
  className,
}: RouteSimulatorProps): React.ReactElement {
  const [enabled, setEnabled] = useState(false);
  const [sent, setSent] = useState(0);
  const [failed, setFailed] = useState(0);
  const canStart = Boolean(from && to);

  const handlePoint = async (point: StreamPoint): Promise<void> => {
    try {
      await pushSingleLocation({
        lat: point.lat,
        lng: point.lng,
        recorded_at: new Date(point.at).toISOString(),
      });
      setSent((prev) => prev + 1);
    } catch (err) {
      setFailed((prev) => prev + 1);
      const msg = err instanceof ApiError ? err.detail : 'Push failed';
      toast.error(msg);
    }
  };

  const state = useRouteSimulation(
    from,
    to,
    (p) => {
      void handlePoint(p);
    },
    { enabled, intervalMs: 3_000, steps: 20 },
  );

  const toggle = (): void => {
    if (!canStart && !enabled) {
      toast.error('Need both pickup and drop coords to simulate');
      return;
    }
    setEnabled((v) => !v);
  };

  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Route className="size-4 text-muted-foreground" aria-hidden />
              <h3 className="text-sm font-semibold text-foreground">Fake route walk</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {routeLabel
                ? `Simulates delivery along: ${routeLabel}`
                : 'Walks a straight line between pickup and drop in 20 steps.'}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant={enabled ? 'destructive' : 'default'}
            disabled={!canStart}
            onClick={toggle}
          >
            {enabled ? (
              <>
                <Pause className="size-4" aria-hidden />
                Stop
              </>
            ) : (
              <>
                <Play className="size-4" aria-hidden />
                Start
              </>
            )}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">Step: {Math.max(0, state.stepIndex + 1)} / 20</Badge>
          <Badge variant="outline">Sent: {sent}</Badge>
          {failed > 0 ? (
            <Badge variant="destructive">Failed: {failed}</Badge>
          ) : null}
          {state.done ? <Badge variant="success">Complete</Badge> : null}
        </div>

        {!canStart ? (
          <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
            Pickup / drop coords missing — accept an order first.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default RouteSimulator;

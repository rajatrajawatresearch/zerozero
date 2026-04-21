/**
 * Real-geolocation breadcrumb pusher.
 *
 * Wiring:
 *   `navigator.geolocation.watchPosition` (via `useGeolocationStream`)
 *     → push into an in-memory buffer (via `useBatchedFlush`)
 *     → every 3s POST the batch to `/partner/location`
 *
 * UI:
 *   - Start / stop toggle
 *   - Live counter showing points received from the browser + pushed to server
 *   - Error row when geolocation is unavailable or denied
 *
 * Safe to mount multiple times per session — each mount manages its own
 * watch handle and unsubscribes on cleanup.
 */
import { useState } from 'react';
import { Loader2, MapPin, Pause, Play } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';

import { usePushLocationMutation } from '../api';
import { useBatchedFlush, useGeolocationStream } from '../hooks';
import type { PartnerLocationPoint, StreamPoint } from '../types';

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */
function toWirePoint(point: StreamPoint): PartnerLocationPoint {
  return {
    lat: point.lat,
    lng: point.lng,
    recorded_at: new Date(point.at).toISOString(),
    ...(point.heading != null ? { heading: point.heading } : {}),
    ...(point.speed != null ? { speed: point.speed } : {}),
    ...(point.accuracy != null ? { accuracy: point.accuracy } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/*                                  Component                                 */
/* -------------------------------------------------------------------------- */
export function LocationStreamer(): React.ReactElement {
  const [enabled, setEnabled] = useState(false);
  const [pushed, setPushed] = useState(0);
  const mutation = usePushLocationMutation();

  // Flush accumulated points every 3s while streaming.
  const flushBatch = (batch: StreamPoint[]): void => {
    if (batch.length === 0) return;
    mutation.mutate(
      { points: batch.map(toWirePoint) },
      {
        onSuccess: () => {
          setPushed((prev) => prev + batch.length);
        },
        onError: (err) => {
          const msg = err instanceof ApiError ? err.detail : 'Push failed';
          toast.error(msg);
        },
      },
    );
  };

  const pushToBuffer = useBatchedFlush<StreamPoint>(flushBatch, {
    enabled,
    intervalMs: 3_000,
  });

  const streamState = useGeolocationStream(
    (point) => {
      pushToBuffer(point);
    },
    { enabled },
  );

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <MapPin className="size-4 text-muted-foreground" aria-hidden />
              <h3 className="text-sm font-semibold text-foreground">Live location</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Uses the browser GPS to push a 3-second batched breadcrumb stream.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant={enabled ? 'destructive' : 'default'}
            onClick={() => setEnabled((v) => !v)}
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
          <Badge variant="outline">Captured: {streamState.count}</Badge>
          <Badge variant="outline">Pushed: {pushed}</Badge>
          {mutation.isPending ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              Flushing
            </span>
          ) : null}
        </div>

        {streamState.error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {streamState.error.message || 'Geolocation error'}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default LocationStreamer;

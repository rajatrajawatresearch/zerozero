/**
 * Step 1 of the checkout flow — pick a saved address.
 *
 * Data comes from the Location slice's `useAddressesQuery`, which returns
 * snake_case `Address[]` straight off the wire. Adding a new address is
 * deferred to the existing `/addresses` page to avoid duplicating
 * `AddressForm` here — after the user saves, they'll land back on
 * `/checkout` via the "Back" link and their fresh address will already be
 * pre-selected (we auto-select the default address on mount).
 */
import { useEffect } from 'react';
import { Loader2, MapPin, Plus } from 'lucide-react';
import { useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useAddressesQuery } from '@/features/location';

export interface AddressStepProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function AddressStep({
  selectedId,
  onSelect,
}: AddressStepProps): React.ReactElement {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useAddressesQuery();

  // Auto-select the default address (or the first one) on first load so the
  // "Continue" button is actionable without an extra click.
  useEffect(() => {
    if (selectedId) return;
    if (!data || data.length === 0) return;
    const fallback = data.find((a) => a.is_default) ?? data[0];
    if (fallback) onSelect(fallback.id);
  }, [data, selectedId, onSelect]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        Could not load your addresses. Refresh to try again.
      </p>
    );
  }

  const addresses = data ?? [];

  if (addresses.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <MapPin className="size-8 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-base font-semibold">No saved addresses yet</p>
            <p className="text-sm text-muted-foreground">
              Add a delivery address to continue with checkout.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => void navigate('/addresses')}
            className="gap-1"
          >
            <Plus className="size-4" aria-hidden />
            Add address
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Delivery address" className="space-y-3">
        {addresses.map((a) => {
          const checked = a.id === selectedId;
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onSelect(a.id)}
              className={cn(
                'flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors',
                'hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-primary',
                checked
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-card',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'mt-1 flex size-4 flex-shrink-0 items-center justify-center rounded-full border-2',
                  checked ? 'border-primary' : 'border-muted-foreground',
                )}
              >
                {checked && (
                  <span className="size-2 rounded-full bg-primary" />
                )}
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{a.label}</span>
                  {a.is_default && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                      Default
                    </span>
                  )}
                </div>
                <address className="mt-1 text-sm not-italic leading-relaxed text-muted-foreground">
                  {a.line1}
                  {a.line2 ? <>, {a.line2}</> : null}
                  <br />
                  {a.city}, {a.state} — {a.pincode}
                </address>
              </div>
            </button>
          );
        })}
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full gap-1"
        onClick={() => void navigate('/addresses')}
      >
        <Plus className="size-4" aria-hidden />
        Add new address
      </Button>
    </div>
  );
}

/** Tiny busy overlay used while the parent re-fetches addresses. */
export function AddressStepBusy(): React.ReactElement {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span className="text-sm">Loading addresses…</span>
    </div>
  );
}

export default AddressStep;

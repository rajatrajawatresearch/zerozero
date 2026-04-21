/**
 * Grid of saved-address cards with inline delete + set-default controls.
 *
 * Mutations go through the TanStack hooks which invalidate
 * `QK.addresses.mine` — no local list state lives in this component.
 */
import { Loader2, MapPin, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';

import {
  useAddressesQuery,
  useDeleteAddressMutation,
  useSetDefaultAddressMutation,
} from '../api';

export interface AddressListProps {
  /** Called when user clicks the "Add new" button inside the empty state. */
  onAddNew?: () => void;
}

export function AddressList({
  onAddNew,
}: AddressListProps): React.ReactElement {
  const { data, isLoading, isError } = useAddressesQuery();
  const deleteMutation = useDeleteAddressMutation();
  const setDefaultMutation = useSetDefaultAddressMutation();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
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
      <Card className="items-center py-10 text-center">
        <CardContent className="flex flex-col items-center gap-3">
          <MapPin className="size-8 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-base font-semibold">No saved addresses yet</p>
            <p className="text-sm text-muted-foreground">
              Add one to check out faster next time.
            </p>
          </div>
          {onAddNew && (
            <Button type="button" onClick={onAddNew}>
              Add your first address
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      toast.success('Address removed.');
    } catch (err) {
      const detail =
        err instanceof ApiError ? err.detail : 'Could not remove address.';
      toast.error(detail);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await setDefaultMutation.mutateAsync(id);
      toast.success('Default updated.');
    } catch (err) {
      const detail =
        err instanceof ApiError ? err.detail : 'Could not update default.';
      toast.error(detail);
    }
  };

  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {addresses.map((a) => {
        const deleting =
          deleteMutation.isPending && deleteMutation.variables === a.id;
        const promoting =
          setDefaultMutation.isPending && setDefaultMutation.variables === a.id;

        return (
          <li key={a.id}>
            <Card className="h-full gap-3">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="size-4 text-primary" aria-hidden />
                  {a.label}
                  {a.is_default && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary uppercase">
                      Default
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <address className="text-sm not-italic leading-relaxed text-muted-foreground">
                  {a.line1}
                  {a.line2 ? <>, {a.line2}</> : null}
                  <br />
                  {a.city}, {a.state} — {a.pincode}
                </address>
                <div className="flex flex-wrap gap-2">
                  {!a.is_default && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={promoting}
                      onClick={() => void handleSetDefault(a.id)}
                    >
                      {promoting ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Star className="size-3.5" aria-hidden />
                      )}
                      Set default
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={deleting}
                    onClick={() => void handleDelete(a.id)}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    {deleting ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="size-3.5" aria-hidden />
                    )}
                    Remove
                  </Button>
                </div>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

export default AddressList;

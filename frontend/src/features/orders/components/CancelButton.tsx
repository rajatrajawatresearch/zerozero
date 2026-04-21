/**
 * Cancel-order affordance with a confirmation dialog.
 *
 * Disabled unless `status in {placed, confirmed}` (matches the backend
 * rule — see `docs/PHASE3_CONTRACTS.md` Orders).
 *
 * On confirm, fires `useCancelOrderMutation`. The mutation writes the fresh
 * detail payload into the TanStack cache so the calling page repaints to
 * the cancelled state without a refetch.
 */
import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';

import { useCancelOrderMutation } from '../api';
import type { OrderStatus } from '../types';
import { CANCELLABLE_STATUSES } from '../types';

/* -------------------------------------------------------------------------- */
/*                                  Props                                     */
/* -------------------------------------------------------------------------- */
export interface CancelButtonProps {
  orderId: string;
  status: OrderStatus;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*                                Component                                   */
/* -------------------------------------------------------------------------- */
export function CancelButton({
  orderId,
  status,
  className,
}: CancelButtonProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const mutation = useCancelOrderMutation();

  const isAllowed = (CANCELLABLE_STATUSES as readonly string[]).includes(status);

  const handleConfirm = (): void => {
    mutation.mutate(orderId, {
      onSuccess: () => {
        toast.success('Order cancelled');
        setOpen(false);
      },
      onError: (err) => {
        const msg = err instanceof ApiError ? err.detail : 'Could not cancel order';
        toast.error(msg);
      },
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={!isAllowed}
        aria-disabled={!isAllowed}
        className={className}
      >
        <Trash2 className="size-4" aria-hidden />
        Cancel order
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this order?</DialogTitle>
            <DialogDescription>
              The restaurant will be notified and any charged amount will be refunded.
              You cannot undo this action.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={mutation.isPending}
            >
              Keep order
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirm}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Cancelling
                </>
              ) : (
                'Yes, cancel'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default CancelButton;

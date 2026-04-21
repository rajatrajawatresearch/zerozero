/**
 * `/addresses` — authed page listing and managing saved addresses.
 *
 * - Wrapped in the auth feature's `ProtectedRoute` so signed-out users are
 *   bounced to `/login` with the post-login redirect pre-filled.
 * - "Add new address" pops the `AddressForm` inside a Dialog; successful
 *   submit auto-closes it via the `onSuccess` callback.
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ProtectedRoute } from '@/features/auth';

import { AddressForm } from '../components/AddressForm';
import { AddressList } from '../components/AddressList';

function AddressesPageInner(): React.ReactElement {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:py-12">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Saved addresses
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage where ZeroZero delivers your food.
          </p>
        </div>
        <Button type="button" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" aria-hidden />
          Add new address
        </Button>
      </header>

      <AddressList onAddNew={() => setAddOpen(true)} />

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a new address</DialogTitle>
            <DialogDescription>
              Pinpoint the spot on the map and fill in the details below.
            </DialogDescription>
          </DialogHeader>
          <AddressForm
            onSuccess={() => setAddOpen(false)}
            onCancel={() => setAddOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AddressesPage(): React.ReactElement {
  return (
    <ProtectedRoute>
      <AddressesPageInner />
    </ProtectedRoute>
  );
}

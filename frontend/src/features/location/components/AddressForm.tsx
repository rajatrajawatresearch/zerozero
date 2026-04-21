/**
 * Create / edit form for a saved `Address`.
 *
 * Design notes:
 *  - Fields are validated with zod; the map + "Use my location" button write
 *    into hidden `lat` / `lng` form fields via `form.setValue` so the final
 *    submit payload is fully typed + validated.
 *  - When the user drags the map marker we leave the address fields alone
 *    (they may want precise coords for a valid house number) — but we *do*
 *    accept a reverse-geocode result from "Use my location" to pre-fill
 *    city / state / pincode if they're blank.
 *  - `mode='create'` POSTs; `mode='edit'` PATCHes the given address.
 */
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { env } from '@/lib/env';
import { ApiError } from '@/lib/api';

import {
  useCreateAddressMutation,
  useUpdateAddressMutation,
} from '../api';
import type { Address, AddressIn, Place } from '../types';
import { MapPreview } from './MapPreview';
import { UseMyLocationButton } from './UseMyLocationButton';

/* -------------------------------------------------------------------------- */
/*                                   Schema                                   */
/* -------------------------------------------------------------------------- */
const addressSchema = z.object({
  label: z
    .string()
    .min(1, { message: 'Pick a short label like "home" or "work".' })
    .max(40),
  line1: z.string().min(3, { message: 'Street line is required.' }).max(200),
  line2: z.string().max(200).optional().or(z.literal('')),
  city: z.string().min(1, { message: 'City is required.' }).max(80),
  state: z.string().min(1, { message: 'State is required.' }).max(80),
  pincode: z
    .string()
    .min(4, { message: 'Pincode must be at least 4 digits.' })
    .max(10),
  lat: z
    .number({ required_error: 'Set a location on the map.' })
    .min(-90)
    .max(90),
  lng: z
    .number({ required_error: 'Set a location on the map.' })
    .min(-180)
    .max(180),
  is_default: z.boolean().default(false),
});

type AddressValues = z.infer<typeof addressSchema>;

/* -------------------------------------------------------------------------- */
/*                                   Props                                    */
/* -------------------------------------------------------------------------- */
export interface AddressFormProps {
  /** Pass an existing address for edit mode; omit for create. */
  initial?: Address | null;
  /** Called after a successful submit (dialog can use it to close itself). */
  onSuccess?: (a: Address) => void;
  /** Called when the user hits Cancel. */
  onCancel?: () => void;
}

/* -------------------------------------------------------------------------- */
/*                                 Component                                  */
/* -------------------------------------------------------------------------- */
export function AddressForm({
  initial,
  onSuccess,
  onCancel,
}: AddressFormProps): React.ReactElement {
  const isEdit = !!initial;

  const form = useForm<AddressValues>({
    resolver: zodResolver(addressSchema),
    mode: 'onTouched',
    defaultValues: {
      label: initial?.label ?? 'Home',
      line1: initial?.line1 ?? '',
      line2: initial?.line2 ?? '',
      city: initial?.city ?? '',
      state: initial?.state ?? '',
      pincode: initial?.pincode ?? '',
      lat: initial?.lat ?? env.DEFAULT_LAT,
      lng: initial?.lng ?? env.DEFAULT_LNG,
      is_default: initial?.is_default ?? false,
    },
  });

  const createMutation = useCreateAddressMutation();
  const updateMutation = useUpdateAddressMutation();
  const isPending = createMutation.isPending || updateMutation.isPending;

  // Sync the hidden lat/lng display when the user drags the map marker.
  const currentLat = form.watch('lat');
  const currentLng = form.watch('lng');

  // If the parent swaps `initial` (e.g. switching from create → edit), reset.
  useEffect(() => {
    if (initial) {
      form.reset({
        label: initial.label,
        line1: initial.line1,
        line2: initial.line2 ?? '',
        city: initial.city,
        state: initial.state,
        pincode: initial.pincode,
        lat: initial.lat,
        lng: initial.lng,
        is_default: initial.is_default,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.id]);

  const applyCoordsFromMap = (coords: { lat: number; lng: number }) => {
    form.setValue('lat', coords.lat, { shouldDirty: true });
    form.setValue('lng', coords.lng, { shouldDirty: true });
  };

  const applyFromGeolocation = (
    coords: { lat: number; lng: number },
    place: Place | null,
  ) => {
    applyCoordsFromMap(coords);
    if (!place) return;
    // Prefill blank string fields from the reverse-geocode; never clobber
    // user edits. Only string-typed keys are eligible so the form schema's
    // types line up with `setValue`.
    const fillIfBlank = (
      name: 'city' | 'state' | 'pincode',
      value: string | null | undefined,
    ) => {
      if (!value) return;
      const current = form.getValues(name);
      if (!current || current.trim() === '') {
        form.setValue(name, value, { shouldDirty: true });
      }
    };
    fillIfBlank('city', place.city);
    fillIfBlank('state', place.state);
    fillIfBlank('pincode', place.pincode);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    const body: AddressIn = {
      label: values.label,
      line1: values.line1,
      line2: values.line2 ? values.line2 : null,
      city: values.city,
      state: values.state,
      pincode: values.pincode,
      lat: values.lat,
      lng: values.lng,
      is_default: values.is_default,
    };

    try {
      const saved =
        initial !== undefined && initial !== null
          ? await updateMutation.mutateAsync({ id: initial.id, patch: body })
          : await createMutation.mutateAsync(body);
      toast.success(isEdit ? 'Address updated.' : 'Address saved.');
      onSuccess?.(saved);
    } catch (err) {
      const detail =
        err instanceof ApiError ? err.detail : 'Could not save the address.';
      toast.error(detail);
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="label"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Label</FormLabel>
                <FormControl>
                  <Input placeholder="Home, Work…" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="pincode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Pincode</FormLabel>
                <FormControl>
                  <Input inputMode="numeric" placeholder="110001" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="line1"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address line 1</FormLabel>
              <FormControl>
                <Input placeholder="Flat / House no, Street" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="line2"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address line 2 (optional)</FormLabel>
              <FormControl>
                <Input placeholder="Landmark, Area" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem>
                <FormLabel>City</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="state"
            render={({ field }) => (
              <FormItem>
                <FormLabel>State</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Map + geolocation */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <FormLabel className="!mt-0">Pin the exact spot</FormLabel>
            <UseMyLocationButton onLocated={applyFromGeolocation}>
              Use my location
            </UseMyLocationButton>
          </div>
          <MapPreview
            lat={currentLat}
            lng={currentLng}
            onChange={applyCoordsFromMap}
          />
          <p className="text-xs text-muted-foreground">
            Drag the marker to adjust. Lat&nbsp;{currentLat.toFixed(5)},
            Lng&nbsp;{currentLng.toFixed(5)}
          </p>
        </div>

        <FormField
          control={form.control}
          name="is_default"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center gap-2 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(v) => field.onChange(v === true)}
                />
              </FormControl>
              <FormLabel className="!mt-0 cursor-pointer">
                Set as default delivery address
              </FormLabel>
            </FormItem>
          )}
        />

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isPending}
            >
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : isEdit ? (
              'Save changes'
            ) : (
              'Save address'
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}

export default AddressForm;

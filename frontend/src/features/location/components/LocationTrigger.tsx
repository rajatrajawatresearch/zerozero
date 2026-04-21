/**
 * Header button that shows the current location label and opens the
 * `LocationPicker` Sheet.
 *
 * Reads the active label from `useLocationStore` via the dedicated selector
 * so the button re-renders when either `point.label` or
 * `selectedAddress.label` changes — without pulling the entire state slice.
 *
 * Agent 10 (FE-Layout) mounts this directly inside the app header.
 */
import { useState } from 'react';
import { ChevronDown, MapPin } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  selectActiveLabel,
  useLocationStore,
} from '@/store/location';

import { LocationPicker } from './LocationPicker';

export interface LocationTriggerProps {
  className?: string;
}

export function LocationTrigger({
  className,
}: LocationTriggerProps): React.ReactElement {
  const label = useLocationStore(selectActiveLabel);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className={cn(
          'max-w-[12rem] gap-1.5 px-2 text-left md:max-w-xs',
          className,
        )}
        aria-label={`Change location. Current: ${label}`}
      >
        <MapPin className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="truncate text-sm font-medium">{label}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Button>
      <LocationPicker open={open} onOpenChange={setOpen} />
    </>
  );
}

export default LocationTrigger;

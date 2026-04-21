import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useActiveLatLng } from '@/store/location';

import { useGlobalSearchQuery } from '../api';
import { useDebouncedValue, useGlobalSearchShortcut } from '../hooks';
import { SearchEmpty } from './SearchEmpty';
import { SearchResultMenuItem } from './SearchResultMenuItem';
import { SearchResultRestaurant } from './SearchResultRestaurant';

/**
 * Global command-palette search.
 *
 * Open/close via:
 *   - `cmd+K` / `ctrl+K`            (anywhere)
 *   - `/`                            (when no input focused)
 *   - Parent can pass controlled props too.
 *
 * Keyboard navigation (arrow keys, enter-to-select, esc-to-close) is
 * handled by cmdk under the hood via `CommandDialog`.
 */
interface GlobalSearchPaletteProps {
  /** Controlled open state; if omitted, the component owns it internally. */
  open?: boolean;
  /** Pair with `open` to drive from the outside. */
  onOpenChange?: (open: boolean) => void;
}

export function GlobalSearchPalette({
  open: controlledOpen,
  onOpenChange,
}: GlobalSearchPaletteProps = {}): ReactElement {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (onOpenChange) onOpenChange(next);
      else setInternalOpen(next);
    },
    [onOpenChange],
  );

  const [value, setValue] = useState('');
  const debounced = useDebouncedValue(value.trim(), 250);

  // Reset query when the palette closes so re-opening starts clean.
  useEffect(() => {
    if (!open) setValue('');
  }, [open]);

  // Respond to the global hotkey.
  useGlobalSearchShortcut(
    useCallback(() => {
      setOpen(true);
    }, [setOpen]),
  );

  const geo = useActiveLatLng();

  const { data, isFetching } = useGlobalSearchQuery(debounced, geo, {
    enabled: debounced.length >= 2,
  });

  const navigate = useNavigate();
  const goTo = useCallback(
    (path: string) => {
      setOpen(false);
      navigate(path);
    },
    [navigate, setOpen],
  );

  const restaurants = data?.restaurants ?? [];
  const menuItems = data?.menu_items ?? [];
  const hasResults = restaurants.length > 0 || menuItems.length > 0;
  const canSeeAll = debounced.length >= 2;

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search"
      description="Search restaurants and dishes"
    >
      <div className="relative">
        <CommandInput
          autoFocus
          value={value}
          onValueChange={setValue}
          placeholder="Search restaurants, dishes, cuisines..."
        />
        <kbd
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex"
        >
          <span className="text-xs">&#8984;</span>K
        </kbd>
      </div>
      <CommandList>
        {isFetching && canSeeAll ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Searching...
          </div>
        ) : null}

        {!canSeeAll ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            Type at least 2 characters to search.
          </div>
        ) : null}

        {canSeeAll && !isFetching && !hasResults ? (
          <CommandEmpty>
            <SearchEmpty q={debounced} />
          </CommandEmpty>
        ) : null}

        {restaurants.length > 0 ? (
          <CommandGroup heading="Restaurants">
            {restaurants.map((r) => (
              <CommandItem
                key={`r-${r.id}`}
                value={`restaurant-${r.id}-${r.name}`}
                onSelect={() => goTo(`/r/${r.slug}`)}
              >
                <SearchResultRestaurant restaurant={r} />
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {restaurants.length > 0 && menuItems.length > 0 ? (
          <CommandSeparator />
        ) : null}

        {menuItems.length > 0 ? (
          <CommandGroup heading="Menu items">
            {menuItems.map((item) => (
              <CommandItem
                key={`m-${item.id}`}
                value={`item-${item.id}-${item.name}`}
                onSelect={() => goTo(`/r/${item.restaurant.slug}`)}
              >
                <SearchResultMenuItem item={item} />
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {canSeeAll ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Actions">
              <CommandItem
                value="see-all"
                onSelect={() =>
                  goTo(`/search?q=${encodeURIComponent(debounced)}`)
                }
              >
                See all results for &ldquo;{debounced}&rdquo;
              </CommandItem>
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}

export default GlobalSearchPalette;

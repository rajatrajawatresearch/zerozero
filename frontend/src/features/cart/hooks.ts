/**
 * Feature-level cart hooks that UNIFY the dual cart model.
 *
 * Two sources of truth exist:
 *   - Guest users       → `useCartStore` (Zustand, persisted to localStorage, Phase 1)
 *   - Authenticated     → `/cart` server endpoints via TanStack Query
 *
 * `useCart()` flattens both into a single ergonomic surface so consumer
 * UI code (drawer, page, stepper) doesn't need to care which mode it's in.
 * `useMergeGuestCartOnLogin()` migrates any guest-cart lines to the server
 * after a successful login and clears the local store.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useCartStore, selectCartRestaurantId } from '@/store/cart';
import { useAuthStore, selectIsAuthenticated } from '@/store/auth';
import type { CartLine, MoneyAmount } from '@/types';

import {
  useAddToCartMutation,
  useCartQuery,
  useClearCartMutation,
  useRemoveFromCartMutation,
  useUpdateCartItemMutation,
} from './api';
import type { CartItemOut } from './types';

/* -------------------------------------------------------------------------- */
/*                                 UI line type                                */
/* -------------------------------------------------------------------------- */
/**
 * Normalised cart line consumed by components. `id` is the server row id
 * (when authenticated) OR the Zustand `clientId` (guest mode) — callers
 * just use it as a stable identifier for update/remove.
 */
export interface UiCartLine {
  id: string;
  menuItemId: string;
  restaurantId: string;
  name: string;
  price: MoneyAmount;
  qty: number;
  imageUrl: string | undefined;
  isVeg: boolean | undefined;
  options: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/*                               UseCart contract                              */
/* -------------------------------------------------------------------------- */
export interface AddItemInput {
  menuItemId: string;
  restaurantId: string;
  name: string;
  price: MoneyAmount;
  qty?: number;
  imageUrl?: string;
  isVeg?: boolean;
  options?: Record<string, unknown>;
}

export interface UseCartValue {
  items: UiCartLine[];
  subtotal: number;
  itemCount: number;
  restaurantId: string | null;
  restaurantName: string | null;
  isLoading: boolean;
  isMutating: boolean;
  mode: 'guest' | 'server';

  addItem: (input: AddItemInput) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  updateQty: (id: string, qty: number) => Promise<void>;
  clear: () => Promise<void>;
}

/* -------------------------------------------------------------------------- */
/*                                 Projections                                 */
/* -------------------------------------------------------------------------- */
function projectServerLine(row: CartItemOut): UiCartLine {
  return {
    id: row.id,
    menuItemId: row.menu_item_id,
    restaurantId: row.restaurant_id,
    name: row.item.name,
    price: row.item.price,
    qty: row.qty,
    imageUrl: row.item.image_url ?? undefined,
    isVeg: row.item.is_veg,
    options: row.options ?? {},
  };
}

function projectGuestLine(line: CartLine): UiCartLine {
  return {
    id: line.clientId,
    menuItemId: line.menuItemId,
    restaurantId: line.restaurantId,
    name: line.name,
    price: line.price,
    qty: line.qty,
    imageUrl: line.imageUrl,
    isVeg: undefined,
    options: line.options,
  };
}

function sumGuest(lines: CartLine[]): { subtotal: number; itemCount: number } {
  let subtotal = 0;
  let itemCount = 0;
  for (const l of lines) {
    const n = Number(l.price);
    subtotal += (Number.isFinite(n) ? n : 0) * l.qty;
    itemCount += l.qty;
  }
  return { subtotal, itemCount };
}

/* -------------------------------------------------------------------------- */
/*                                   useCart                                   */
/* -------------------------------------------------------------------------- */
/**
 * Unified cart view. Reads from the server when authenticated, otherwise
 * falls through to the persisted Zustand store. Mutations are dispatched to
 * whichever backend is appropriate.
 */
export function useCart(): UseCartValue {
  const isAuthenticated = useAuthStore(selectIsAuthenticated);

  /* --------------------------- server side --------------------------- */
  const cartQuery = useCartQuery();
  const addMutation = useAddToCartMutation();
  const updateMutation = useUpdateCartItemMutation();
  const removeMutation = useRemoveFromCartMutation();
  const clearMutation = useClearCartMutation();

  /* ---------------------------- guest side --------------------------- */
  const guestLines = useCartStore((s) => s.lines);
  const guestAdd = useCartStore((s) => s.add);
  const guestUpdate = useCartStore((s) => s.updateQty);
  const guestRemove = useCartStore((s) => s.remove);
  const guestClear = useCartStore((s) => s.clear);
  const guestRestaurantId = useCartStore(selectCartRestaurantId);

  /* --------------------------- projections --------------------------- */
  const items = useMemo<UiCartLine[]>(() => {
    if (isAuthenticated) {
      return cartQuery.data?.items.map(projectServerLine) ?? [];
    }
    return guestLines.map(projectGuestLine);
  }, [isAuthenticated, cartQuery.data?.items, guestLines]);

  const { subtotal, itemCount, restaurantId, restaurantName } = useMemo(() => {
    if (isAuthenticated && cartQuery.data) {
      return {
        subtotal: Number(cartQuery.data.subtotal) || 0,
        itemCount: cartQuery.data.item_count,
        restaurantId: cartQuery.data.restaurant_id,
        restaurantName: cartQuery.data.restaurant_name,
      };
    }
    const { subtotal, itemCount } = sumGuest(guestLines);
    return {
      subtotal,
      itemCount,
      restaurantId: guestRestaurantId,
      restaurantName: null,
    };
  }, [isAuthenticated, cartQuery.data, guestLines, guestRestaurantId]);

  const isMutating =
    addMutation.isPending ||
    updateMutation.isPending ||
    removeMutation.isPending ||
    clearMutation.isPending;

  /* ----------------------------- actions ----------------------------- */
  const addItem = useCallback(
    async (input: AddItemInput) => {
      const qty = input.qty ?? 1;
      if (isAuthenticated) {
        await addMutation.mutateAsync({
          menu_item_id: input.menuItemId,
          qty,
          options: input.options ?? null,
        });
        return;
      }
      guestAdd({
        menuItemId: input.menuItemId,
        restaurantId: input.restaurantId,
        name: input.name,
        price: input.price,
        qty,
        options: normaliseOptions(input.options),
        ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
      });
    },
    [isAuthenticated, addMutation, guestAdd],
  );

  const updateQty = useCallback(
    async (id: string, qty: number) => {
      if (isAuthenticated) {
        if (qty <= 0) {
          await removeMutation.mutateAsync(id);
          return;
        }
        await updateMutation.mutateAsync({ id, patch: { qty } });
        return;
      }
      guestUpdate(id, qty);
    },
    [isAuthenticated, updateMutation, removeMutation, guestUpdate],
  );

  const removeItem = useCallback(
    async (id: string) => {
      if (isAuthenticated) {
        await removeMutation.mutateAsync(id);
        return;
      }
      guestRemove(id);
    },
    [isAuthenticated, removeMutation, guestRemove],
  );

  const clear = useCallback(async () => {
    if (isAuthenticated) {
      await clearMutation.mutateAsync();
      return;
    }
    guestClear();
  }, [isAuthenticated, clearMutation, guestClear]);

  return {
    items,
    subtotal,
    itemCount,
    restaurantId,
    restaurantName,
    isLoading: isAuthenticated ? cartQuery.isLoading : false,
    isMutating,
    mode: isAuthenticated ? 'server' : 'guest',
    addItem,
    removeItem,
    updateQty,
    clear,
  };
}

/* -------------------------------------------------------------------------- */
/*                         useMergeGuestCartOnLogin                            */
/* -------------------------------------------------------------------------- */
/**
 * Once the user authenticates, flush any lines sitting in the Zustand guest
 * cart to the server via `/cart/items` and then clear the local store. Runs
 * at most once per transition from unauthenticated → authenticated, and is
 * idempotent-safe: if the POST fails we keep the guest lines so the user
 * doesn't lose them.
 *
 * Wire this effect from the auth feature (e.g. inside `AppShell` or a
 * dedicated provider) so it lives at an always-mounted scope.
 */
export function useMergeGuestCartOnLogin(): void {
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const guestLines = useCartStore.getState().lines;
  const guestClear = useCartStore((s) => s.clear);
  const addMutation = useAddToCartMutation();

  const prevAuthRef = useRef<boolean>(isAuthenticated);
  const inFlightRef = useRef<boolean>(false);

  useEffect(() => {
    const wasAuthed = prevAuthRef.current;
    prevAuthRef.current = isAuthenticated;

    // Only trigger on the rising edge (false → true).
    if (wasAuthed || !isAuthenticated) return;
    if (inFlightRef.current) return;

    // Read fresh lines at the moment of login (guestLines closure can be stale).
    const linesNow = useCartStore.getState().lines;
    if (linesNow.length === 0) return;

    inFlightRef.current = true;
    void (async () => {
      try {
        for (const line of linesNow) {
          await addMutation.mutateAsync({
            menu_item_id: line.menuItemId,
            qty: line.qty,
            options: line.options,
          });
        }
        guestClear();
      } catch {
        // Keep the guest store intact — user can retry from the drawer.
      } finally {
        inFlightRef.current = false;
      }
    })();
    // `addMutation` and `guestClear` identity is stable enough for a single
    // rising-edge trigger; including them would re-run the effect on every
    // re-render of the host which is undesirable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // Silence unused-var warnings for the snapshot read at render time.
  void guestLines;
}

/* -------------------------------------------------------------------------- */
/*                                   Utils                                    */
/* -------------------------------------------------------------------------- */
/** Narrow arbitrary option bag to the `CartLine['options']` shape. */
function normaliseOptions(
  input: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  if (!input) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return out;
}

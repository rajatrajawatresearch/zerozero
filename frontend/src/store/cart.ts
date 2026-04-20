import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { STORAGE_KEYS } from '@/lib/constants';
import type { CartLine } from '@/types';

/**
 * Client cart store.
 *
 * Phase 1 keeps the cart purely client-side and persisted. Phase 3 will
 * mirror this to the server via `/cart` endpoints; the store API stays
 * the same — only the implementation of each action changes (optimistic
 * update + server mutation).
 *
 * Rule: a cart can only contain items from a single restaurant. Adding
 * an item from a different restaurant clears existing lines first. The
 * UI must confirm this with the user before calling `add` in that case.
 */
interface CartState {
  lines: CartLine[];

  add: (line: Omit<CartLine, 'clientId'>) => void;
  remove: (clientId: string) => void;
  updateQty: (clientId: string, qty: number) => void;
  clear: () => void;
}

/** Stable key for option-based deduplication within a restaurant. */
function optionsKey(options: CartLine['options']): string {
  const keys = Object.keys(options).sort();
  return keys.map((k) => `${k}=${String(options[k])}`).join('|');
}

function generateClientId(): string {
  // crypto.randomUUID is available in all evergreen browsers Vite targets.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `c_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      lines: [],

      add: (incoming) =>
        set((state) => {
          // Reset cart if switching restaurants.
          const firstLine = state.lines[0];
          const differentRestaurant =
            firstLine && firstLine.restaurantId !== incoming.restaurantId;
          const baseLines = differentRestaurant ? [] : state.lines;

          const incomingKey = optionsKey(incoming.options);
          const existingIdx = baseLines.findIndex(
            (l) =>
              l.menuItemId === incoming.menuItemId &&
              optionsKey(l.options) === incomingKey,
          );

          if (existingIdx >= 0) {
            const next = [...baseLines];
            const existing = next[existingIdx]!;
            next[existingIdx] = { ...existing, qty: existing.qty + incoming.qty };
            return { lines: next };
          }

          return {
            lines: [
              ...baseLines,
              { ...incoming, clientId: generateClientId() },
            ],
          };
        }),

      remove: (clientId) =>
        set((state) => ({
          lines: state.lines.filter((l) => l.clientId !== clientId),
        })),

      updateQty: (clientId, qty) =>
        set((state) => {
          if (qty <= 0) {
            return {
              lines: state.lines.filter((l) => l.clientId !== clientId),
            };
          }
          return {
            lines: state.lines.map((l) =>
              l.clientId === clientId ? { ...l, qty } : l,
            ),
          };
        }),

      clear: () => set({ lines: [] }),
    }),
    {
      name: STORAGE_KEYS.CART,
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({ lines: state.lines }),
    },
  ),
);

/* ------------------------------ Selectors -------------------------------- */
/** Total item count across all lines. */
export const selectCartCount = (s: CartState): number =>
  s.lines.reduce((sum, l) => sum + l.qty, 0);

/**
 * Subtotal in number form. Money strings (Numeric(12,2)) are parsed with
 * parseFloat — acceptable for UI totals but NOT for payment calculations
 * which must go through the backend.
 */
export const selectCartTotal = (s: CartState): number =>
  s.lines.reduce((sum, l) => sum + parseFloat(l.price) * l.qty, 0);

export const selectCartRestaurantId = (s: CartState): string | null =>
  s.lines[0]?.restaurantId ?? null;

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { STORAGE_KEYS } from '@/lib/constants';
import { env } from '@/lib/env';
import type { Address, LocationPoint } from '@/types';

/**
 * Location store — the user's currently-selected delivery point.
 *
 * Precedence:
 *   1. A saved `Address` (when `selectedAddress` is set)
 *   2. A free-form `point` set via geolocation / map tap
 *   3. The env default (Delhi NCR centre from `.env.example`)
 *
 * All feature queries (`/restaurants?lat=&lng=`) should derive their
 * coordinates from `selectActiveLatLng()` so a single source of truth
 * drives the entire app.
 */

const defaultPoint: LocationPoint = {
  lat: env.DEFAULT_LAT,
  lng: env.DEFAULT_LNG,
  label: 'Default location',
};

interface LocationState {
  /** Free-form point; always populated (falls back to env default). */
  point: LocationPoint;
  /** Optional saved address — takes precedence over `point` when present. */
  selectedAddress: Address | null;

  setPoint: (point: LocationPoint) => void;
  setSelectedAddress: (address: Address | null) => void;
  reset: () => void;
}

export const useLocationStore = create<LocationState>()(
  persist(
    (set) => ({
      point: defaultPoint,
      selectedAddress: null,

      setPoint: (point) => set({ point, selectedAddress: null }),
      setSelectedAddress: (selectedAddress) => set({ selectedAddress }),
      reset: () => set({ point: defaultPoint, selectedAddress: null }),
    }),
    {
      name: STORAGE_KEYS.LOCATION,
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({
        point: state.point,
        selectedAddress: state.selectedAddress,
      }),
    },
  ),
);

/* ------------------------------ Selectors -------------------------------- */
/** Single source of truth for "what lat/lng should we query against?". */
export const selectActiveLatLng = (
  s: LocationState,
): { lat: number; lng: number } => {
  if (s.selectedAddress) {
    return { lat: s.selectedAddress.lat, lng: s.selectedAddress.lng };
  }
  return { lat: s.point.lat, lng: s.point.lng };
};

export const selectActiveLabel = (s: LocationState): string =>
  s.selectedAddress?.label ?? s.point.label;

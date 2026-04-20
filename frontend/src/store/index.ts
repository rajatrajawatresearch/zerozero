/**
 * Central barrel for all Zustand stores. Importing from `@/store` gives
 * features a single entry point and keeps individual store files free
 * to reorganise internally.
 */
export {
  useAuthStore,
  selectIsAuthenticated,
  selectUserRole,
  type AuthState,
} from './auth';

export {
  useCartStore,
  selectCartCount,
  selectCartTotal,
  selectCartRestaurantId,
} from './cart';

export {
  useLocationStore,
  selectActiveLatLng,
  selectActiveLabel,
} from './location';

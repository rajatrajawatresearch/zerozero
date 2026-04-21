/**
 * Public surface of the cart feature.
 *
 * Consumers:
 *   - Agent 10 (route merge) spreads `cartRoutes` into `features/routes.tsx`
 *   - Agent 8 (FE-Checkout) reads `useCart()` to render the review step
 *   - Auth feature wires `useMergeGuestCartOnLogin()` into its login effect
 *   - Layout will eventually swap in `CartButtonWithDrawer`
 *
 * Internals (`api.ts` constants, individual mutations) are re-exported
 * under clear names for the rare caller that needs them.
 */
export type {
  CartItemIn,
  CartItemOut,
  CartItemPatchIn,
  CartOut,
  MenuItemBrief,
} from './types';

export {
  cartKeys,
  useAddToCartMutation,
  useCartQuery,
  useClearCartMutation,
  useRemoveFromCartMutation,
  useUpdateCartItemMutation,
} from './api';

export {
  useCart,
  useMergeGuestCartOnLogin,
} from './hooks';
export type { AddItemInput, UiCartLine, UseCartValue } from './hooks';

export { CartDrawer } from './components/CartDrawer';
export { CartLineItem } from './components/CartLineItem';
export { CartSummary } from './components/CartSummary';
export { EmptyCart } from './components/EmptyCart';
export { QtyStepper } from './components/QtyStepper';
export { CartButtonWithDrawer } from './components/CartButton';

export { cartRoutes } from './routes';

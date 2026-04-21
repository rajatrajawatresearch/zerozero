/**
 * Local state machine for the /checkout flow.
 *
 * The flow has 3 strictly-ordered steps:
 *   address → payment → review
 *
 * We keep the state in a transient Zustand store (no `persist` middleware —
 * a half-filled checkout is an anti-feature) rather than URL hash because
 * the data shape — address UUID, payment enum, applied-promo object — is
 * richer than a stringified hash can comfortably round-trip, and a page
 * reload of `/checkout` should always reset back to the address step.
 *
 * The store is intentionally scoped to this feature: not re-exported from
 * the root `store/` barrel, and not consumed by any other slice.
 */
import { useCallback } from 'react';
import { create } from 'zustand';

import type { PaymentMethod } from '@/types';

import {
  CHECKOUT_STEPS,
  type AppliedPromo,
  type CheckoutStep,
} from './types';

/* -------------------------------------------------------------------------- */
/*                                   Store                                    */
/* -------------------------------------------------------------------------- */
interface CheckoutFlowState {
  step: CheckoutStep;
  addressId: string | null;
  paymentMethod: PaymentMethod | null;
  notes: string;
  appliedPromo: AppliedPromo | null;

  setStep: (step: CheckoutStep) => void;
  setAddressId: (id: string | null) => void;
  setPaymentMethod: (m: PaymentMethod | null) => void;
  setNotes: (n: string) => void;
  setAppliedPromo: (p: AppliedPromo | null) => void;
  reset: () => void;
}

const INITIAL_STATE = {
  step: 'address' as CheckoutStep,
  addressId: null,
  paymentMethod: null,
  notes: '',
  appliedPromo: null,
};

const useCheckoutFlowStore = create<CheckoutFlowState>()((set) => ({
  ...INITIAL_STATE,
  setStep: (step) => set({ step }),
  setAddressId: (addressId) => set({ addressId }),
  setPaymentMethod: (paymentMethod) => set({ paymentMethod }),
  setNotes: (notes) => set({ notes }),
  setAppliedPromo: (appliedPromo) => set({ appliedPromo }),
  reset: () => set(INITIAL_STATE),
}));

/* -------------------------------------------------------------------------- */
/*                               Public surface                               */
/* -------------------------------------------------------------------------- */
export interface UseCheckoutFlowValue {
  step: CheckoutStep;
  stepIndex: number;

  addressId: string | null;
  paymentMethod: PaymentMethod | null;
  notes: string;
  appliedPromo: AppliedPromo | null;

  /** True when the current step has a valid answer and we can proceed. */
  canAdvance: boolean;
  /** True when the user is on the final step and ready to place the order. */
  isFinalStep: boolean;

  setAddressId: (id: string | null) => void;
  setPaymentMethod: (m: PaymentMethod | null) => void;
  setNotes: (n: string) => void;
  setAppliedPromo: (p: AppliedPromo | null) => void;

  goNext: () => void;
  goBack: () => void;
  goTo: (step: CheckoutStep) => void;
  reset: () => void;
}

/**
 * Flow-wide state + transitions for `CheckoutPage`.
 *
 * We only allow forward jumps to steps whose precondition is already
 * satisfied (e.g. you can't jump to `payment` without an address). This
 * keeps the stepper clickable for completed steps without re-implementing
 * guards at every call-site.
 */
export function useCheckoutFlow(): UseCheckoutFlowValue {
  const step = useCheckoutFlowStore((s) => s.step);
  const addressId = useCheckoutFlowStore((s) => s.addressId);
  const paymentMethod = useCheckoutFlowStore((s) => s.paymentMethod);
  const notes = useCheckoutFlowStore((s) => s.notes);
  const appliedPromo = useCheckoutFlowStore((s) => s.appliedPromo);

  const setStep = useCheckoutFlowStore((s) => s.setStep);
  const setAddressId = useCheckoutFlowStore((s) => s.setAddressId);
  const setPaymentMethod = useCheckoutFlowStore((s) => s.setPaymentMethod);
  const setNotes = useCheckoutFlowStore((s) => s.setNotes);
  const setAppliedPromo = useCheckoutFlowStore((s) => s.setAppliedPromo);
  const reset = useCheckoutFlowStore((s) => s.reset);

  const stepIndex = CHECKOUT_STEPS.indexOf(step);
  const isFinalStep = stepIndex === CHECKOUT_STEPS.length - 1;

  const canAdvance =
    (step === 'address' && !!addressId) ||
    (step === 'payment' && !!paymentMethod) ||
    step === 'review';

  const goNext = useCallback(() => {
    const next = CHECKOUT_STEPS[stepIndex + 1];
    if (next) setStep(next);
  }, [stepIndex, setStep]);

  const goBack = useCallback(() => {
    const prev = CHECKOUT_STEPS[stepIndex - 1];
    if (prev) setStep(prev);
  }, [stepIndex, setStep]);

  const goTo = useCallback(
    (target: CheckoutStep) => {
      const targetIdx = CHECKOUT_STEPS.indexOf(target);
      if (targetIdx < 0) return;
      // Never jump forward past an uncompleted step.
      if (targetIdx > stepIndex) {
        if (targetIdx >= 1 && !addressId) return;
        if (targetIdx >= 2 && !paymentMethod) return;
      }
      setStep(target);
    },
    [stepIndex, addressId, paymentMethod, setStep],
  );

  return {
    step,
    stepIndex,
    addressId,
    paymentMethod,
    notes,
    appliedPromo,
    canAdvance,
    isFinalStep,
    setAddressId,
    setPaymentMethod,
    setNotes,
    setAppliedPromo,
    goNext,
    goBack,
    goTo,
    reset,
  };
}

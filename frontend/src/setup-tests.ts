import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Auto-unmount React trees after each test so DOM state doesn't leak.
afterEach(() => {
  cleanup();
});

// jsdom doesn't implement matchMedia — shadcn/theme code relies on it.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

// jsdom doesn't implement ResizeObserver — Radix primitives need it.
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (window as unknown as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver =
    ResizeObserverMock;
}

// jsdom stubs for Radix-portal scroll locking.
if (typeof window !== 'undefined' && !('scrollTo' in window)) {
  (window as unknown as { scrollTo: ReturnType<typeof vi.fn> }).scrollTo = vi.fn();
}

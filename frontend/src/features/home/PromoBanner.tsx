import type { ReactElement } from 'react';
import { Copy, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Promo {
  code: string;
  title: string;
  subtitle: string;
  accent: 'primary' | 'accent' | 'warning';
}

const PROMOS: Promo[] = [
  {
    code: 'FIRST50',
    title: '50% off your first order',
    subtitle: 'New customers only. Max discount INR 125.',
    accent: 'primary',
  },
  {
    code: 'WEEKEND20',
    title: '20% off every weekend',
    subtitle: 'Valid Saturdays and Sundays across all restaurants.',
    accent: 'accent',
  },
  {
    code: 'ZEROFEE',
    title: 'Zero delivery fees',
    subtitle: 'Orders above INR 299. Wallet payments only.',
    accent: 'warning',
  },
];

const ACCENTS: Record<Promo['accent'], string> = {
  primary: 'from-primary/20 to-primary/5 border-primary/30 text-primary',
  accent: 'from-accent/30 to-accent/5 border-accent/40 text-accent-foreground',
  warning: 'from-warning/30 to-warning/5 border-warning/40 text-warning',
};

/**
 * Swipable horizontal promo carousel. Uses native CSS scroll-snap so no
 * extra dependency is needed — fast, accessible, keyboard-friendly.
 * Phase 3 will replace the hardcoded list with a `/promos` API call.
 */
export function PromoBanner(): ReactElement {
  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success('Code copied', { description: code });
    } catch {
      toast.error('Copy failed', { description: 'Your browser blocked clipboard access.' });
    }
  };

  return (
    <section
      aria-labelledby="promo-heading"
      className="mx-auto w-full max-w-7xl px-6 py-6"
    >
      <div className="mb-3 flex items-end justify-between">
        <h2 id="promo-heading" className="text-lg font-bold tracking-tight text-foreground">
          Promo codes
        </h2>
        <p className="text-xs text-muted-foreground">Swipe for more</p>
      </div>
      <ul
        className={cn(
          'flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
      >
        {PROMOS.map((promo) => (
          <li
            key={promo.code}
            className={cn(
              'relative flex min-w-[82%] snap-start flex-col gap-2 overflow-hidden rounded-lg border p-5',
              'bg-gradient-to-br shadow-sm sm:min-w-[24rem]',
              ACCENTS[promo.accent],
            )}
          >
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
              <Tag className="size-3.5" />
              Promo
            </div>
            <h3 className="text-xl font-bold leading-tight text-foreground">{promo.title}</h3>
            <p className="text-sm text-muted-foreground">{promo.subtitle}</p>
            <div className="mt-auto flex items-center justify-between pt-3">
              <code className="rounded-md border border-dashed border-current/50 bg-background/60 px-2 py-1 font-mono text-sm tracking-wider text-foreground">
                {promo.code}
              </code>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1.5"
                onClick={() => void copy(promo.code)}
                aria-label={`Copy promo code ${promo.code}`}
              >
                <Copy className="size-3.5" />
                Copy
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default PromoBanner;

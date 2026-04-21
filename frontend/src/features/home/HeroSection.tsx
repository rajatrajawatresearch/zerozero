import { useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Flame } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const TAGLINES = [
  'Cravings, sorted.',
  'Your neighbourhood, on a plate.',
  'Tasty is a tap away.',
  'From kitchen to doorstep.',
];

const CUISINES: { emoji: string; label: string; slug: string }[] = [
  { emoji: '', label: 'Pizza', slug: 'pizza' },
  { emoji: '', label: 'Burgers', slug: 'burgers' },
  { emoji: '', label: 'Biryani', slug: 'biryani' },
  { emoji: '', label: 'Sushi', slug: 'sushi' },
  { emoji: '', label: 'Desserts', slug: 'desserts' },
  { emoji: '', label: 'Salads', slug: 'salads' },
  { emoji: '', label: 'Tacos', slug: 'tacos' },
  { emoji: '', label: 'Noodles', slug: 'noodles' },
  { emoji: '', label: 'Coffee', slug: 'coffee' },
  { emoji: '', label: 'Breakfast', slug: 'breakfast' },
];

/**
 * Bold home hero. Rotates through taglines every 3.5s and renders a
 * horizontal-scroll cuisine chip rail for one-tap category entry.
 */
export function HeroSection(): ReactElement {
  const [tagIndex, setTagIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTagIndex((i) => (i + 1) % TAGLINES.length);
    }, 3500);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section
      className={cn(
        'relative overflow-hidden border-b border-border/40',
        'bg-gradient-to-br from-primary/10 via-background to-accent/10',
      )}
      aria-labelledby="hero-heading"
    >
      {/* Decorative glow orbs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-20 -top-20 size-72 rounded-full bg-primary/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-10 size-80 rounded-full bg-accent/20 blur-3xl"
      />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-10 sm:py-16">
        <div className="max-w-3xl space-y-4">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1',
              'text-xs font-semibold uppercase tracking-wider text-primary',
            )}
          >
            <Flame className="size-3.5" />
            Now delivering near you
          </span>
          <h1
            id="hero-heading"
            className="text-4xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-5xl md:text-6xl"
          >
            Hungry? <span className="text-primary">ZeroZero</span> has you covered.
          </h1>
          <p
            key={tagIndex}
            className="animate-in fade-in slide-in-from-bottom-2 text-lg font-medium text-muted-foreground sm:text-xl"
          >
            {TAGLINES[tagIndex]}
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button asChild size="lg" className="gap-2 px-6 shadow-sm">
              <Link to="/restaurants">
                Explore
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="px-6">
              <Link to="/addresses">Saved addresses</Link>
            </Button>
          </div>
        </div>

        <div className="-mx-6 mt-4 overflow-x-auto px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ul className="flex w-max gap-2">
            {CUISINES.map((c) => (
              <li key={c.slug}>
                <Link
                  to={`/restaurants?cuisine=${c.slug}`}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-4 py-2',
                    'text-sm font-medium text-foreground shadow-sm backdrop-blur',
                    'transition-colors hover:border-primary/40 hover:bg-primary/5',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  <span aria-hidden>{c.emoji}</span>
                  {c.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export default HeroSection;

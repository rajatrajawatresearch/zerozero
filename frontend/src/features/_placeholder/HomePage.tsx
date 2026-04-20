import { useTheme, PRESETS, oklchToString } from '@/features/theme';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { env } from '@/lib/env';

/**
 * Phase-1 landing page — the only purpose is to verify the theme + UI
 * primitives + providers all wire up correctly when `pnpm dev` runs.
 *
 * Phase 2 track 2B will replace this with the real restaurant list.
 */
export default function HomePage(): React.ReactElement {
  const { mode, setMode, applyPreset, setRadius, radius } = useTheme();

  const modes = ['light', 'dark', 'system'] as const;
  const radii = ['sm', 'md', 'lg'] as const;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-12 space-y-3">
          <h1 className="text-5xl font-bold tracking-tight text-primary">
            {env.APP_NAME}
          </h1>
          <p className="text-lg text-muted-foreground">
            Zomato-style food delivery. Fully themed, fully real-time.
          </p>
        </header>

        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Theme presets
          </h2>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <Button
                key={preset.id}
                variant="outline"
                size="sm"
                onClick={() => applyPreset(preset.id)}
              >
                <span
                  aria-hidden
                  className="mr-2 inline-block h-3 w-3 rounded-full"
                  style={{ background: oklchToString(preset.primary) }}
                />
                {preset.name}
              </Button>
            ))}
          </div>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Mode
          </h2>
          <div className="flex gap-2">
            {modes.map((m) => (
              <Button
                key={m}
                variant={mode === m ? 'default' : 'outline'}
                size="sm"
                onClick={() => setMode(m)}
              >
                {m}
              </Button>
            ))}
          </div>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Radius
          </h2>
          <div className="flex gap-2">
            {radii.map((r) => (
              <Button
                key={r}
                variant={radius === r ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRadius(r)}
              >
                {r}
              </Button>
            ))}
          </div>
        </section>

        <Separator className="my-10" />

        <Card>
          <CardHeader>
            <CardTitle>Sanity check</CardTitle>
            <CardDescription>
              If this card, the input, and the button all follow the palette
              above, the theme pipeline is healthy.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="demo-input">Your name</Label>
              <Input id="demo-input" placeholder="Type something" />
            </div>
          </CardContent>
          <CardFooter>
            <Button>Primary action</Button>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}

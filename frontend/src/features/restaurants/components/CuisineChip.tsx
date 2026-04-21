import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Small inline chip for a cuisine tag. Used on RestaurantCard and detail
 * hero. Purely presentational — selection state on the FilterSidebar uses
 * Checkbox instead of this chip.
 */
interface CuisineChipProps {
  name: string;
  icon?: string | null;
  className?: string;
}

export function CuisineChip({ name, icon, className }: CuisineChipProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'border-border/70 bg-muted/50 text-muted-foreground px-2 py-0.5 text-[11px] font-medium',
        className,
      )}
    >
      {icon ? <span aria-hidden>{icon}</span> : null}
      {name}
    </Badge>
  );
}

export default CuisineChip;

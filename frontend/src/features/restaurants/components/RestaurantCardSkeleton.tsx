import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Layout-matched placeholder for `RestaurantCard`. Keep visual dimensions
 * (aspect ratio, spacing) identical to the real card so swapping in data
 * doesn't cause layout shift (CLS).
 */
export function RestaurantCardSkeleton() {
  return (
    <Card className="overflow-hidden p-0" aria-hidden>
      <Skeleton className="aspect-video w-full rounded-none" />
      <CardContent className="space-y-3 px-4 pb-4 pt-3">
        <div className="flex items-start justify-between gap-2">
          <Skeleton className="h-5 w-3/5" />
          <Skeleton className="h-5 w-12 rounded-md" />
        </div>
        <div className="flex gap-1">
          <Skeleton className="h-4 w-16 rounded-md" />
          <Skeleton className="h-4 w-20 rounded-md" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
      </CardContent>
    </Card>
  );
}

export default RestaurantCardSkeleton;

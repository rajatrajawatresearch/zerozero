import { cn } from '@/lib/utils';

import type { MenuCategoryOut } from '../types';
import { MenuItemCard } from './MenuItemCard';

/**
 * Vertical section rendering one category of a restaurant's menu.
 *
 * We use a sticky category header rather than an accordion so users can
 * keep scanning while always knowing which cuisine they're looking at.
 * For left-rail navigation (jump to category) the parent page wires in
 * section IDs via `id={category.slug}`.
 */
interface MenuCategoryProps {
  group: MenuCategoryOut;
  restaurantId: string;
  className?: string;
}

export function MenuCategory({ group, restaurantId, className }: MenuCategoryProps) {
  const { category, items } = group;

  return (
    <section
      id={category.slug}
      aria-labelledby={`heading-${category.slug}`}
      className={cn('scroll-mt-24', className)}
    >
      <header
        className={cn(
          'sticky top-16 z-10 -mx-4 mb-4 flex items-baseline justify-between gap-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur',
          'sm:-mx-0 sm:px-0',
        )}
      >
        <h3
          id={`heading-${category.slug}`}
          className="text-lg font-semibold text-foreground"
        >
          {category.icon ? (
            <span aria-hidden className="mr-2">
              {category.icon}
            </span>
          ) : null}
          {category.name}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            ({items.length})
          </span>
        </h3>
      </header>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {items.map((item) => (
          <MenuItemCard key={item.id} item={item} restaurantId={restaurantId} />
        ))}
      </div>
    </section>
  );
}

export default MenuCategory;

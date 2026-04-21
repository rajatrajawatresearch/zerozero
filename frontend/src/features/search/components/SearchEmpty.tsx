import type { ReactElement } from 'react';
import { SearchX } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Empty-state shown when the current query returns zero restaurants *and*
 * zero menu items. Reused by both the Command palette (inside
 * `CommandEmpty`) and the full `/search` page.
 */
interface SearchEmptyProps {
  q: string;
  className?: string;
}

export function SearchEmpty({ q, className }: SearchEmptyProps): ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground',
        className,
      )}
    >
      <SearchX className="size-6 opacity-60" aria-hidden />
      <p>
        No results for <span className="font-medium text-foreground">{q}</span>
      </p>
      <p className="text-xs">Try a different dish, cuisine, or restaurant name.</p>
    </div>
  );
}

export default SearchEmpty;

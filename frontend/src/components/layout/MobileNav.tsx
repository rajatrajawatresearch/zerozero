import type { ReactElement } from 'react';
import { NavLink } from 'react-router';
import { Home, Search, ShoppingBag, User as UserIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/features/auth/hooks';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: (props: { className?: string }) => ReactElement;
  end?: boolean;
}

const ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: ({ className }) => <Home className={className} />, end: true },
  { to: '/?search=1', label: 'Search', icon: ({ className }) => <Search className={className} /> },
  { to: '/orders', label: 'Orders', icon: ({ className }) => <ShoppingBag className={className} /> },
];

/**
 * Bottom tab bar rendered on viewports below `sm`. Mirrors the Zomato-style
 * mobile experience: five-ish icons with active state, safe-area padded.
 */
export function MobileNav(): ReactElement {
  const { isAuthenticated, user } = useAuth();

  return (
    <nav
      aria-label="Mobile"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border/60',
        'bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70',
        'pb-[env(safe-area-inset-bottom,0px)] sm:hidden',
      )}
    >
      {ITEMS.map((item) => (
        <NavLink
          key={item.label}
          to={item.to}
          end={item.end ?? false}
          className={({ isActive }) =>
            cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium',
              'outline-none transition-colors focus-visible:bg-accent',
              isActive ? 'text-primary' : 'text-muted-foreground',
            )
          }
        >
          <item.icon className="size-5" />
          {item.label}
        </NavLink>
      ))}
      <NavLink
        to={isAuthenticated ? '/profile' : '/login'}
        className={({ isActive }) =>
          cn(
            'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium',
            'outline-none transition-colors focus-visible:bg-accent',
            isActive ? 'text-primary' : 'text-muted-foreground',
          )
        }
      >
        {isAuthenticated && user?.avatarUrl ? (
          <Avatar className="size-5">
            <AvatarImage src={user.avatarUrl} alt="" />
            <AvatarFallback className="text-[8px]">ME</AvatarFallback>
          </Avatar>
        ) : (
          <UserIcon className="size-5" />
        )}
        {isAuthenticated ? 'Profile' : 'Log in'}
      </NavLink>
    </nav>
  );
}

export default MobileNav;

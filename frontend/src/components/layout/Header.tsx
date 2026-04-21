import { useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router';
import { LogOut, Menu, Search, Settings, ShoppingBag, User as UserIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { CartButton } from '@/components/layout/CartButton';
import { Logo } from '@/components/layout/Logo';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { ThemeCustomizerSheet } from '@/components/theme/ThemeCustomizerSheet';
import { useAuth } from '@/features/auth/hooks';
import { LocationTrigger } from '@/features/location/components/LocationTrigger';
import { NotificationBell } from '@/features/notifications';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*                                 User menu                                  */
/* -------------------------------------------------------------------------- */

function userInitials(fullName?: string | null): string {
  if (!fullName) return 'U';
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || 'U';
}

function UserMenu(): ReactElement {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label="Account menu"
        >
          <Avatar className="size-8">
            {user?.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
            <AvatarFallback className="bg-primary/10 text-primary">
              {userInitials(user?.fullName)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">{user?.fullName ?? 'Account'}</span>
          {user?.email ? (
            <span className="text-xs font-normal text-muted-foreground">{user.email}</span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/profile')}>
          <UserIcon className="size-4" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/orders')}>
          <ShoppingBag className="size-4" />
          Orders
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/settings')}>
          <Settings className="size-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            void logout();
          }}
        >
          <LogOut className="size-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* -------------------------------------------------------------------------- */
/*                             Mobile nav sheet                                */
/* -------------------------------------------------------------------------- */

function MobileNavSheet(): ReactElement {
  const [open, setOpen] = useState(false);
  const { isAuthenticated, user, logout } = useAuth();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Open navigation" className="md:hidden">
          <Menu className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[19rem]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Logo variant="sm" />
          </SheetTitle>
        </SheetHeader>
        <nav className="mt-6 flex flex-col gap-1 text-sm" aria-label="Primary">
          <SheetClose asChild>
            <Link className="rounded-md px-2 py-2 hover:bg-accent" to="/">
              Home
            </Link>
          </SheetClose>
          <SheetClose asChild>
            <Link className="rounded-md px-2 py-2 hover:bg-accent" to="/restaurants">
              Restaurants
            </Link>
          </SheetClose>
          <SheetClose asChild>
            <Link className="rounded-md px-2 py-2 hover:bg-accent" to="/orders">
              Orders
            </Link>
          </SheetClose>
          <SheetClose asChild>
            <Link className="rounded-md px-2 py-2 hover:bg-accent" to="/addresses">
              Saved addresses
            </Link>
          </SheetClose>
        </nav>
        <div className="mt-auto space-y-2 pt-6">
          {isAuthenticated ? (
            <>
              <div className="rounded-md bg-muted/50 p-3 text-sm">
                <p className="font-medium">{user?.fullName}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  void logout();
                  setOpen(false);
                }}
              >
                <LogOut className="size-4" />
                Log out
              </Button>
            </>
          ) : (
            <SheetClose asChild>
              <Button asChild className="w-full">
                <Link to="/login">Log in</Link>
              </Button>
            </SheetClose>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Header                                    */
/* -------------------------------------------------------------------------- */

/**
 * Primary app chrome: sticky, translucent, backdrop-blur. Logo + location on
 * the left, desktop search in the center, theme + cart + user on the right.
 * Mobile collapses the center and swaps in a hamburger sheet.
 */
export function Header(): ReactElement {
  const { isAuthenticated } = useAuth();

  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur',
        'supports-[backdrop-filter]:bg-background/60',
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-3 sm:px-6">
        <MobileNavSheet />

        <Link
          to="/"
          aria-label="ZeroZero home"
          className="shrink-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Logo variant="sm" />
        </Link>

        <div className="hidden items-center sm:flex">
          <span aria-hidden className="mx-2 h-6 w-px bg-border" />
          <LocationTrigger />
        </div>

        <div className="mx-4 hidden flex-1 md:flex">
          <div className="relative w-full max-w-lg">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              placeholder="Search restaurants, dishes, cuisines..."
              className="h-10 w-full pl-9"
              aria-label="Search"
            />
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <ThemeCustomizerSheet />
          <CartButton />
          {isAuthenticated ? (
            <>
              <NotificationBell />
              <UserMenu />
            </>
          ) : (
            <Button asChild size="sm" className="ml-1 h-9 px-4">
              <Link to="/login">Log in</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-1 border-t border-border/40 px-3 py-1 sm:hidden">
        <LocationTrigger className="flex-1" />
        <Button
          asChild
          variant="ghost"
          size="sm"
          aria-label="Search"
          className="shrink-0"
        >
          <Link to="/?search=1">
            <Search className="size-4" />
          </Link>
        </Button>
      </div>
    </header>
  );
}

export default Header;

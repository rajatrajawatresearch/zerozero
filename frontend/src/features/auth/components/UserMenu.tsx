/**
 * Avatar + dropdown surfacing the core account actions. Used by the
 * global header (Agent 10) — see `components/layout/Header.tsx`.
 *
 * Layout:
 *   avatar (initials fallback) → menu:
 *     [user label, muted email]
 *     Profile
 *     My Orders
 *     Addresses
 *     ——
 *     Log out
 */
import { useNavigate } from 'react-router';
import { LogOut, MapPin, ReceiptText, User as UserIcon } from 'lucide-react';
import { toast } from 'sonner';

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

import { useLogoutMutation } from '../api';
import { useAuth } from '../hooks';

function initialsFrom(name: string | undefined, email: string | undefined): string {
  const source = name?.trim() || email || '';
  if (!source) return '?';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return source.slice(0, 1).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function UserMenu(): React.ReactElement | null {
  const navigate = useNavigate();
  const { user } = useAuth();
  const logoutMutation = useLogoutMutation();

  if (!user) return null;

  const handleLogout = async (): Promise<void> => {
    try {
      await logoutMutation.mutateAsync();
      toast.success('Signed out');
      void navigate('/', { replace: true });
    } catch {
      // Mutation already tears down local state in onSettled, so just notify.
      toast.success('Signed out');
    }
  };

  const initials = initialsFrom(user.fullName, user.email);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="size-10 rounded-full p-0 focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Open account menu"
        >
          <Avatar className="size-10 border border-border">
            {user.avatarUrl ? (
              <AvatarImage src={user.avatarUrl} alt={user.fullName} />
            ) : null}
            <AvatarFallback className="bg-primary/10 text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold leading-tight">{user.fullName}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/profile')}>
          <UserIcon className="size-4" aria-hidden />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/orders')}>
          <ReceiptText className="size-4" aria-hidden />
          My Orders
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/addresses')}>
          <MapPin className="size-4" aria-hidden />
          Addresses
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={(e) => {
            // Don't auto-close before the async handler gets a chance to run.
            e.preventDefault();
            void handleLogout();
          }}
          disabled={logoutMutation.isPending}
        >
          <LogOut className="size-4" aria-hidden />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default UserMenu;

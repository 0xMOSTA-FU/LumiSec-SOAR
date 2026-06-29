'use client';

import React from 'react';
import { LogOut, Settings, User } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/components/auth/AuthProvider';
import type { Page } from '@/app/soar/types';

interface UserMenuProps {
  onOpenSettings?: () => void;
}

function initials(email: string | null, name: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return 'SO';
}

export function UserMenu({ onOpenSettings }: UserMenuProps) {
  const { user, logout } = useAuth();
  if (!user) return null;

  const displayName = user.fullName || user.username || user.email;
  const abbr = initials(user.email, user.fullName);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="Account menu"
        >
          <Avatar className="h-8 w-8 cursor-pointer ring-2 ring-transparent hover:ring-primary/30 transition-all">
            <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
              {abbr}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-0.5">
            <p className="text-sm font-medium leading-none">{displayName}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            {user.devAuth && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 pt-1">Dev auth (no login required)</p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="text-xs text-muted-foreground">
          <User className="h-3.5 w-3.5 mr-2" />
          {user.roles.join(', ') || 'viewer'}
        </DropdownMenuItem>
        {onOpenSettings && (
          <DropdownMenuItem onClick={onOpenSettings}>
            <Settings className="h-3.5 w-3.5 mr-2" />
            Settings
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => logout()}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="h-3.5 w-3.5 mr-2" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type { Page };

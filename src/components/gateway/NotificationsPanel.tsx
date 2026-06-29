'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { getApiErrorMessage } from '@/lib/lumisec-api/browser/api-client';
import { formatIncidentDate } from '@/lib/lumisec-api/browser/incidentUi';
import {
  notificationExcerpt,
  notificationResourceUrl,
  notificationSoarTarget,
  notificationTypeIcon,
} from '@/lib/lumisec-api/browser/notificationUi';
import type { SoarNavigate } from '@/lib/soar/mode';
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  type SoarNotification,
} from '@/lib/lumisec-api/browser/soarNotifications';

const POLL_INTERVAL_MS = 60_000;

export function NotificationsPanel({ onNavigate }: { onNavigate?: SoarNavigate }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<SoarNotification[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const count = await fetchUnreadNotificationCount();
      setUnreadCount(count);
    } catch {
      // Keep previous badge on poll failure
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const result = await fetchNotifications(1, 30);
      setNotifications(result.items);
    } catch (err) {
      setListError(getApiErrorMessage(err));
      setNotifications([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    refreshUnreadCount();
    const interval = setInterval(refreshUnreadCount, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refreshUnreadCount]);

  useEffect(() => {
    if (open) {
      loadNotifications();
    }
  }, [open, loadNotifications]);

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((item) => ({ ...item, read: true })));
      setUnreadCount(0);
    } catch {
      // Still attempt to sync count from server
      await refreshUnreadCount();
    } finally {
      setMarkingAll(false);
    }
  };

  const handleNotificationClick = (notification: SoarNotification) => {
    if (!notification.read) {
      setNotifications((prev) =>
        prev.map((item) =>
          item.id === notification.id ? { ...item, read: true } : item,
        ),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      markNotificationRead(notification.id).catch(() => {
        refreshUnreadCount();
      });
    }

    const target = notificationSoarTarget(
      notification.resource_type,
      notification.resource_id,
    );
    setOpen(false);
    if (target && onNavigate) {
      onNavigate(target);
      return;
    }
    const url = notificationResourceUrl(
      notification.resource_type,
      notification.resource_id,
    );
    if (url) {
      router.push(url);
    }
  };

  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full h-4 min-w-4 flex items-center justify-center px-1">
              {badgeLabel}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">Notifications</h3>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            disabled={markingAll || unreadCount === 0}
            onClick={handleMarkAllRead}
          >
            {markingAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <CheckCheck className="h-3.5 w-3.5 mr-1" />
            )}
            Mark all read
          </Button>
        </div>

        <ScrollArea className="max-h-80">
          {loadingList ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          ) : listError ? (
            <p className="p-4 text-sm text-destructive">{listError}</p>
          ) : notifications.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">No notifications</p>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => {
                const Icon = notificationTypeIcon(notification.type);
                return (
                  <button
                    key={notification.id}
                    type="button"
                    className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors"
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div className="flex gap-3">
                      <div className="mt-0.5 shrink-0 text-muted-foreground">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm leading-snug ${
                            notification.read ? 'font-normal' : 'font-semibold'
                          }`}
                        >
                          {notification.title}
                        </p>
                        {notification.body && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {notificationExcerpt(notification.body)}
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {formatIncidentDate(notification.created_at)}
                        </p>
                      </div>
                      {!notification.read && (
                        <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

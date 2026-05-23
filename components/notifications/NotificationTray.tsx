'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  getNotificationEvents,
  markAllNotificationEventsRead,
  markNotificationEventRead,
} from '@/app/(app)/notifications/actions'
import { createClient } from '@/lib/supabase/client'
import type { NotificationEvent } from '@/lib/types'

type NotificationFilter = 'all' | NotificationEvent['type']

const FILTER_LABELS: Record<NotificationFilter, string> = {
  all: 'All',
  dm_message: 'DMs',
  mention: 'Mentions',
  group_message: 'Groups',
  thread_reply: 'Threads',
}

function formatEventTime(value: string): string {
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return ''

  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export default function NotificationTray() {
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState<NotificationEvent[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<NotificationFilter>('all')
  const [isPending, startTransition] = useTransition()

  function applyEvents(nextEvents: NotificationEvent[], nextUnreadCount: number) {
    setEvents(nextEvents)
    setUnreadCount(nextUnreadCount)
  }

  useEffect(() => {
    let ignore = false

    getNotificationEvents().then(result => {
      if (ignore) return
      if ('error' in result) {
        setError(result.error)
      } else {
        applyEvents(result.events, result.unreadCount)
      }
    })

    return () => { ignore = true }
  }, [])

  useEffect(() => {
    const supabase = createClient()
    let ignore = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function subscribe() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || ignore) return

      channel = supabase
        .channel(`notification-events-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'notification_events',
            filter: `user_id=eq.${user.id}`,
          },
          async () => {
            const result = await getNotificationEvents()
            if (ignore) return
            if ('error' in result) {
              setError(result.error)
            } else {
              applyEvents(result.events, result.unreadCount)
            }
          }
        )
        .subscribe()
    }

    subscribe()

    return () => {
      ignore = true
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [])

  const visibleUnreadCount = useMemo(() => Math.min(unreadCount, 99), [unreadCount])
  const filteredEvents = useMemo(() => (
    filter === 'all' ? events : events.filter(event => event.type === filter)
  ), [events, filter])
  const unreadByType = useMemo(() => (
    events.reduce<Record<NotificationEvent['type'], number>>((counts, event) => {
      if (!event.read_at) counts[event.type] += 1
      return counts
    }, { dm_message: 0, mention: 0, group_message: 0, thread_reply: 0 })
  ), [events])

  function markEventRead(event: NotificationEvent) {
    if (event.read_at) return

    startTransition(async () => {
      const result = await markNotificationEventRead(event.id)
      if ('error' in result) {
        setError(result.error)
        return
      }

      const readAt = new Date().toISOString()
      setEvents(current => current.map(item => item.id === event.id ? { ...item, read_at: readAt } : item))
      setUnreadCount(count => Math.max(0, count - 1))
    })
  }

  function markAllRead() {
    startTransition(async () => {
      const result = await markAllNotificationEventsRead()
      if ('error' in result) {
        setError(result.error)
        return
      }

      const readAt = new Date().toISOString()
      setEvents(current => current.map(event => ({ ...event, read_at: event.read_at ?? readAt })))
      setUnreadCount(0)
    })
  }

  return (
    <div className="relative border-b border-white/10 px-3 py-2 md:px-4" style={{ background: 'var(--bg-primary)' }}>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
          onClick={() => setOpen(value => !value)}
          className="relative rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-white/5 transition-colors"
          data-testid="notification-tray-toggle"
        >
          Notifications
          {unreadCount > 0 && (
            <span
              className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-semibold text-white"
              data-testid="notification-tray-count"
            >
              {unreadCount > 99 ? '99+' : visibleUnreadCount}
            </span>
          )}
        </button>
      </div>

      {open && (
        <div
          className="absolute right-3 top-12 z-40 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-lg border border-white/10 shadow-xl"
          style={{ background: 'var(--bg-secondary)' }}
          data-testid="notification-tray-menu"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Notifications</h2>
            <button
              type="button"
              onClick={markAllRead}
              disabled={isPending || unreadCount === 0}
              className="text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              Mark all read
            </button>
          </div>

          {error && (
            <p className="border-b border-white/10 px-3 py-2 text-xs text-[var(--danger)]" role="alert">
              {error}
            </p>
          )}

          {events.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-[var(--text-muted)]">
              No notifications yet.
            </p>
          ) : (
            <>
            <div className="flex gap-1 overflow-x-auto border-b border-white/10 px-3 py-2">
              {(['all', 'dm_message', 'mention', 'group_message', 'thread_reply'] as NotificationFilter[]).map(item => {
                const count = item === 'all' ? unreadCount : unreadByType[item]
                return (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={filter === item}
                    onClick={() => setFilter(item)}
                    className={`shrink-0 rounded px-2.5 py-1 text-xs font-semibold ${
                      filter === item
                        ? 'bg-[var(--accent-soft)] text-[var(--text-primary)]'
                        : 'bg-white/5 text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {FILTER_LABELS[item]}{count > 0 ? ` ${count}` : ''}
                  </button>
                )
              })}
            </div>
            {filteredEvents.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-[var(--text-muted)]">
                No {FILTER_LABELS[filter].toLowerCase()} notifications.
              </p>
            ) : (
            <ul className="max-h-96 overflow-y-auto py-1">
              {filteredEvents.map(event => (
                <li key={event.id}>
                  <Link
                    href={event.url ?? '/channels'}
                    onClick={() => {
                      markEventRead(event)
                      setOpen(false)
                    }}
                    className="flex gap-3 px-3 py-2 text-left hover:bg-white/5"
                    data-testid={`notification-event-${event.id}`}
                  >
                    <span
                      className={`mt-1 size-2 rounded-full ${event.read_at ? 'bg-transparent' : 'bg-[var(--accent)]'}`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-medium text-[var(--text-primary)]">
                          <span className="mr-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--text-muted)]">
                            {FILTER_LABELS[event.type]}
                          </span>
                          {event.title}
                        </span>
                        <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{formatEventTime(event.created_at)}</span>
                      </span>
                      {event.body && (
                        <span className="mt-0.5 line-clamp-2 block text-xs text-[var(--text-muted)]">{event.body}</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

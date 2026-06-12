'use client'

import { useState, useTransition } from 'react'
import Modal from '@/components/ui/Modal'
import { cancelEvent, createEvent, rsvpEvent } from '@/app/(app)/events/actions'
import { useScheduledEvents, type ScheduledEventWithRsvps } from '@/lib/hooks/useScheduledEvents'
import type { Channel } from '@/lib/types'

interface EventsPanelProps {
  groupId: string
  currentUserId: string
  /** Voice channels offered as event locations. */
  voiceChannels: Channel[]
  canCreate: boolean
  onMobileClose?: () => void
}

function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Sidebar Events entry: a chip showing upcoming-event count that opens the
 * events list with RSVPs and a create form.
 */
export default function EventsPanel({ groupId, currentUserId, voiceChannels, canCreate, onMobileClose }: EventsPanelProps) {
  const { events, refetch } = useScheduledEvents(groupId, currentUserId)
  const [open, setOpen] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function run(action: () => Promise<{ error: string } | { ok: true } | { ok: true; eventId: string }>) {
    setError('')
    startTransition(async () => {
      const result = await action()
      if (result && 'error' in result) {
        setError(result.error)
        return
      }
      setShowCreate(false)
      await refetch()
    })
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    formData.set('group_id', groupId)
    run(() => createEvent(formData))
  }

  function renderEvent(event: ScheduledEventWithRsvps) {
    const channelName = voiceChannels.find(channel => channel.id === event.channel_id)?.name
    return (
      <li
        key={event.id}
        data-testid={`event-${event.id}`}
        className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-primary)] p-3"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-[var(--text-primary)]">{event.name}</p>
            <p className="text-xs text-[var(--accent)]">{formatEventTime(event.start_at)}</p>
            {(channelName || event.location) && (
              <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                {channelName ? `🔊 ${channelName}` : event.location}
              </p>
            )}
            {event.description && (
              <p className="mt-1 line-clamp-2 text-xs text-[var(--text-muted)]">{event.description}</p>
            )}
          </div>
          {(event.created_by === currentUserId || canCreate) && (
            <button
              type="button"
              aria-label={`Cancel ${event.name}`}
              disabled={isPending}
              onClick={() => {
                if (confirm(`Cancel "${event.name}"?`)) run(() => cancelEvent(event.id))
              }}
              className="flex-shrink-0 rounded px-1.5 py-0.5 text-xs text-[var(--text-muted)] hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]"
            >
              Cancel
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          {(['going', 'interested'] as const).map(status => {
            const active = event.ownRsvp === status
            const count = status === 'going' ? event.goingCount : event.interestedCount
            return (
              <button
                key={status}
                type="button"
                data-testid={`rsvp-${status}-${event.id}`}
                disabled={isPending}
                onClick={() => run(() => rsvpEvent(event.id, active ? null : status))}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-white/5 text-[var(--text-muted)] hover:bg-white/10'
                }`}
              >
                {status === 'going' ? '✅ Going' : '⭐ Interested'} {count > 0 ? `· ${count}` : ''}
              </button>
            )
          })}
        </div>
      </li>
    )
  }

  return (
    <>
      <button
        type="button"
        data-testid="events-chip"
        onClick={() => {
          setError('')
          setOpen(true)
          onMobileClose?.()
        }}
        className="channel-row"
        style={{
          width: '100%',
          margin: '2px 0',
          padding: '6px 10px',
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'transparent',
          border: 'none',
          color: 'var(--text-muted)',
          fontSize: 15,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span style={{ flex: 1, minWidth: 0 }}>Events</span>
        {events.length > 0 && (
          <span
            data-testid="events-count"
            style={{
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              padding: '0 6px',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {events.length}
          </span>
        )}
      </button>

      <Modal
        open={open}
        onClose={() => {
          if (isPending) return
          setOpen(false)
          setShowCreate(false)
          setError('')
        }}
        title="Scheduled Events"
      >
        <div className="flex flex-col gap-3">
          {error && (
            <p className="rounded border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
              {error}
            </p>
          )}

          {canCreate && !showCreate && (
            <button
              type="button"
              data-testid="create-event-btn"
              onClick={() => setShowCreate(true)}
              className="rounded bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]"
            >
              Create Event
            </button>
          )}

          {showCreate && (
            <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-lg border border-[var(--border-soft)] p-3">
              <input
                name="name"
                type="text"
                required
                maxLength={100}
                placeholder="Event name"
                className="rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
              <textarea
                name="description"
                rows={2}
                maxLength={1000}
                placeholder="What is this event about?"
                className="resize-none rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="event-start" className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  Starts
                </label>
                <input
                  id="event-start"
                  name="start_at"
                  type="datetime-local"
                  required
                  className="rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              {voiceChannels.length > 0 ? (
                <select
                  name="channel_id"
                  defaultValue=""
                  className="rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <option value="">Somewhere else…</option>
                  {voiceChannels.map(channel => (
                    <option key={channel.id} value={channel.id}>🔊 {channel.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  name="location"
                  type="text"
                  placeholder="Location (optional)"
                  className="rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  disabled={isPending}
                  className="rounded px-3 py-1.5 text-sm font-semibold text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-primary)]"
                >
                  Back
                </button>
                <button
                  type="submit"
                  data-testid="submit-event"
                  disabled={isPending}
                  className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
                >
                  {isPending ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          )}

          {events.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No upcoming events.</p>
          ) : (
            <ul className="space-y-2">{events.map(renderEvent)}</ul>
          )}
        </div>
      </Modal>
    </>
  )
}

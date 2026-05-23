'use client'

import Avatar from '@/components/ui/Avatar'
import { useThreadUnread } from '@/lib/hooks/useThreadUnread'
import type { Profile } from '@/lib/types'

interface ThreadChipProps {
  rootId: string
  replyCount: number
  lastReplyAt?: string | null
  authors?: Array<Pick<Profile, 'username' | 'avatar_url' | 'display_name' | 'username_color'>>
  hasUnread?: boolean
  currentUserId?: string
  onOpen: (rootId: string) => void
}

function formatRelativeTime(iso?: string | null) {
  if (!iso) return 'just now'
  const timestamp = new Date(iso).getTime()
  if (!Number.isFinite(timestamp)) return 'just now'

  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function ThreadChip({
  rootId,
  replyCount,
  lastReplyAt,
  authors = [],
  hasUnread,
  currentUserId,
  onOpen,
}: ThreadChipProps) {
  const computedUnread = useThreadUnread(rootId, lastReplyAt, replyCount, currentUserId)
  if (replyCount <= 0) return null

  const visibleAuthors = authors.slice(0, 3)
  const replyLabel = `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`
  const timeLabel = formatRelativeTime(lastReplyAt)
  const unread = hasUnread ?? computedUnread

  return (
    <button
      type="button"
      data-testid={`thread-chip-${rootId}`}
      onClick={() => onOpen(rootId)}
      className="mt-2 inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--border-soft)] bg-[var(--bg-secondary)] px-2.5 py-1 text-xs font-semibold text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--text-primary)]"
      aria-label={`Open thread with ${replyLabel}`}
    >
      {unread && (
        <span
          data-testid={`thread-chip-unread-${rootId}`}
          className="h-2 w-2 rounded-full bg-[var(--accent)]"
          aria-hidden="true"
        />
      )}
      {visibleAuthors.length > 0 && (
        <span className="flex -space-x-1" aria-hidden="true">
          {visibleAuthors.map((author, index) => (
            <span key={`${author.username}-${index}`} className="rounded-full ring-2 ring-[var(--bg-secondary)]">
              <Avatar
                user={{
                  avatar_url: author.avatar_url,
                  username: author.username,
                  display_name: author.display_name,
                  username_color: author.username_color,
                }}
                size={18}
              />
            </span>
          ))}
        </span>
      )}
      <span className="truncate">
        {replyLabel} · last reply {timeLabel}
      </span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  )
}

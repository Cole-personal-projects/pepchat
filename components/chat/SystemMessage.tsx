'use client'

import Link from 'next/link'
import type { MessageWithProfile } from '@/lib/types'

interface SystemMessageProps {
  msg: MessageWithProfile
  onOpenPinnedPanel: () => void
}

/** Starboard repost: a compact highlight card linking back to the original. */
function StarboardMessage({ msg }: { msg: MessageWithProfile }) {
  const data = msg.system_data ?? {}
  const authorName = (data.author_name as string) ?? 'Someone'
  const preview = (data.preview as string) ?? ''
  const starCount = (data.star_count as number) ?? 0
  const channelName = (data.original_channel_name as string) ?? 'a channel'
  const href = data.original_channel_id
    ? `/channels/${data.original_channel_id}#${data.original_message_id ?? ''}`
    : null

  return (
    <div data-testid="system-message-starboard" style={{ padding: '6px 16px' }}>
      <div
        style={{
          borderLeft: '3px solid #f0b232',
          borderRadius: 8,
          background: 'rgba(240, 178, 50, 0.07)',
          padding: '10px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-faint)' }}>
          <span aria-hidden="true">⭐</span>
          <span>
            <strong data-testid="starboard-count" style={{ color: '#f0b232' }}>{starCount}</strong>
            {' · '}
            <strong data-testid="starboard-author" style={{ color: 'var(--text-muted)' }}>{authorName}</strong>
            {' in '}#{channelName}
          </span>
        </div>
        <p data-testid="starboard-preview" style={{ margin: 0, fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.45, overflowWrap: 'anywhere' }}>
          {preview}
        </p>
        {href && (
          <Link
            data-testid="starboard-jump"
            href={href}
            style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none', width: 'fit-content' }}
          >
            Jump to message →
          </Link>
        )}
      </div>
    </div>
  )
}

export default function SystemMessage({ msg, onOpenPinnedPanel }: SystemMessageProps) {
  if (msg.system_type === 'starboard') return <StarboardMessage msg={msg} />
  if (msg.system_type !== 'pin') return null

  const pinnedBy = msg.system_data?.pinned_by ?? 'Someone'

  return (
    <div
      data-testid="system-message-pin"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 16px',
        fontSize: 13,
        color: 'var(--text-faint)',
      }}
    >
      <svg
        data-testid="system-pin-icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0 }}
      >
        <line x1="12" y1="17" x2="12" y2="22" />
        <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
      </svg>
      <span>
        <strong data-testid="system-pin-actor" style={{ color: 'var(--text-muted)' }}>
          {pinnedBy}
        </strong>
        {' '}pinned a message to this channel.{' '}
        <button
          data-testid="system-pin-see-all"
          onClick={onOpenPinnedPanel}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--accent)',
            cursor: 'pointer',
            padding: 0,
            fontSize: 13,
          }}
        >
          See all pinned messages.
        </button>
      </span>
    </div>
  )
}

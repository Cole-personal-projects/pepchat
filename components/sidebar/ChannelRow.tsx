'use client'

import Link from 'next/link'
import { useRef } from 'react'
import { useLongPress } from '@/lib/hooks/useLongPress'
import type { Channel } from '@/lib/types'

interface ChannelRowProps {
  channel: Channel
  isActive: boolean
  isUnread: boolean
  unreadCount: number
  canManage: boolean
  isPending: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMobileClose?: () => void
  onMarkChannelRead?: (channelId: string) => void | Promise<void>
  onMarkChannelUnread?: (channelId: string) => void | Promise<void>
  onEditSettings: (channel: Channel) => void
  onMove: (channelId: string, direction: 'up' | 'down') => void
  onDelete: (channelId: string) => void
  /** Mobile: long-pressing the row opens the channel action sheet. */
  onLongPress?: (channel: Channel) => void
}

/** Kind-aware channel prefix: # for text, speaker for voice, bubbles for forum. */
function ChannelKindIcon({ kind }: { kind: Channel['kind'] }) {
  if (kind === 'voice') {
    return (
      <svg
        data-testid="channel-kind-voice"
        width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{ opacity: 0.5, flexShrink: 0 }}
      >
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </svg>
    )
  }
  if (kind === 'forum') {
    return (
      <svg
        data-testid="channel-kind-forum"
        width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{ opacity: 0.5, flexShrink: 0 }}
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <path d="M8 9h8M8 13h5" />
      </svg>
    )
  }
  return <span style={{ opacity: 0.5 }}>#</span>
}

/**
 * Single channel row with unread indicators and hover management actions.
 * Markup mirrors the original inline rows in ChannelsSidebar so existing
 * tests and styling carry over unchanged.
 */
export default function ChannelRow({
  channel,
  isActive,
  isUnread,
  unreadCount,
  canManage,
  isPending,
  canMoveUp,
  canMoveDown,
  onMobileClose,
  onMarkChannelRead,
  onMarkChannelUnread,
  onEditSettings,
  onMove,
  onDelete,
  onLongPress,
}: ChannelRowProps) {
  // Suppress the link navigation that follows a completed long-press.
  const longPressFiredRef = useRef(false)
  const longPress = useLongPress(() => {
    longPressFiredRef.current = true
    onLongPress?.(channel)
  })

  const isVoiceLike = channel.kind === 'voice'
  const displayPrefix = isVoiceLike || channel.kind === 'forum' ? '' : '#'
  const channelLabel = [
    `${displayPrefix}${channel.name}`,
    isActive ? 'current channel' : null,
    isUnread
      ? unreadCount > 0
        ? `${unreadCount} unread ${unreadCount === 1 ? 'message' : 'messages'}`
        : 'unread'
      : null,
  ].filter(Boolean).join(', ')

  return (
    <div className="group/ch" style={{ display: 'flex', alignItems: 'center', margin: '1px 0' }}>
      <Link
        href={`/channels/${channel.id}`}
        aria-label={channelLabel}
        onClick={(e) => {
          if (longPressFiredRef.current) {
            longPressFiredRef.current = false
            e.preventDefault()
            return
          }
          onMobileClose?.()
        }}
        {...(onLongPress
          ? {
              onPointerDown: longPress.onPointerDown,
              onPointerUp: longPress.onPointerUp,
              onPointerMove: longPress.onPointerMove,
              onPointerLeave: longPress.onPointerLeave,
              onContextMenu: (e: React.MouseEvent) => {
                // Long-press fires the native context menu on some browsers;
                // it must not race the action sheet.
                if (longPressFiredRef.current) e.preventDefault()
              },
            }
          : {})}
        className={`channel-row${isUnread ? ' font-medium' : ''}`}
        style={{
          flex: 1,
          minWidth: 0,
          padding: '6px 10px',
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          background: isActive ? 'var(--channel-active-bg)' : 'transparent',
          textDecoration: 'none',
          color: isActive || isUnread ? 'var(--text-primary)' : 'var(--text-muted)',
          transition: 'background 120ms ease',
          touchAction: 'manipulation',
        }}
      >
        {/* Dot indicator */}
        {isUnread ? (
          <span
            data-testid={`unread-dot-${channel.id}`}
            style={{
              width: 6, height: 6,
              borderRadius: '50%',
              background: 'var(--text-primary)',
              flexShrink: 0,
            }}
          />
        ) : (
          <span style={{ width: 6, height: 6, flexShrink: 0 }} />
        )}

        {/* Channel name */}
        <span style={{
          fontSize: 14,
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}>
          <ChannelKindIcon kind={channel.kind} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {channel.name}
          </span>
        </span>

        {isUnread && unreadCount > 0 && (
          <span
            data-testid={`unread-count-${channel.id}`}
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
              flexShrink: 0,
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Link>

      {/* Inline controls are desktop hover affordances; mobile reaches the
          same actions through the long-press channel action sheet. */}
      {(onMarkChannelRead || onMarkChannelUnread || canManage) && (
        <div className="hidden md:group-hover/ch:flex items-center gap-0.5 pr-1 flex-shrink-0">
          {isUnread && onMarkChannelRead && (
            <button
              data-testid={`mark-read-${channel.id}`}
              aria-label={`Mark ${displayPrefix}${channel.name} read`}
              onClick={() => onMarkChannelRead(channel.id)}
              className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors"
              title="Mark channel read"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </button>
          )}
          {!isActive && !isUnread && onMarkChannelUnread && (
            <button
              data-testid={`mark-unread-${channel.id}`}
              aria-label={`Mark ${displayPrefix}${channel.name} unread`}
              onClick={() => onMarkChannelUnread(channel.id)}
              className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors"
              title="Mark channel unread"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="7" />
              </svg>
            </button>
          )}
          {canManage && (
            <>
              <button
                onClick={() => onEditSettings(channel)}
                disabled={isPending}
                aria-label={`Edit ${displayPrefix}${channel.name} settings`}
                className="p-1 md:p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors"
                title="Channel settings"
              >
                <svg className="w-3.5 h-3.5 md:w-3 md:h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.757.427 1.757 2.925 0 3.352a1.724 1.724 0 00-1.066 2.572c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.757-2.924 1.757-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.757-.427-1.757-2.925 0-3.352a1.724 1.724 0 001.066-2.572c-.94-1.543.826-3.31 2.37-2.37.996.607 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <button
                disabled={!canMoveUp || isPending}
                aria-label={`Move ${displayPrefix}${channel.name} up`}
                onClick={() => onMove(channel.id, 'up')}
                className="p-1 md:p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 disabled:opacity-30 disabled:cursor-default transition-colors"
                title="Move up"
              >
                <svg className="w-3.5 h-3.5 md:w-3 md:h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
              </button>
              <button
                disabled={!canMoveDown || isPending}
                aria-label={`Move ${displayPrefix}${channel.name} down`}
                onClick={() => onMove(channel.id, 'down')}
                className="p-1 md:p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 disabled:opacity-30 disabled:cursor-default transition-colors"
                title="Move down"
              >
                <svg className="w-3.5 h-3.5 md:w-3 md:h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <button
                onClick={() => onDelete(channel.id)}
                disabled={isPending}
                aria-label={`Delete ${displayPrefix}${channel.name}`}
                className="p-1 md:p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
                title="Delete channel"
              >
                <svg className="w-3.5 h-3.5 md:w-3 md:h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

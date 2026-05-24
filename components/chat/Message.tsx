'use client'

import dynamic from 'next/dynamic'
import Avatar from '@/components/ui/Avatar'
import ReactionPills from '@/components/chat/ReactionPills'
import MessageAttachments from '@/components/chat/MessageAttachments'
import { MessageContent } from '@/components/chat/MessageContent'
import MessageActionBar from '@/components/chat/MessageActionBar'
import ThreadChip from '@/components/chat/ThreadChip'
import { useMessageActions } from '@/components/chat/MessageActionsContext'
import { useLongPress } from '@/lib/hooks/useLongPress'
import type { MessageWithProfile } from '@/lib/types'

const ProfileCard = dynamic(() => import('@/components/profile/ProfileCard'), { ssr: false })

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatPromotedDate(iso?: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export interface MessageProps {
  msg: MessageWithProfile
  isCompact: boolean
  isOwn: boolean
  currentUserId: string
  canDeleteAny?: boolean
  canPin?: boolean
  editingId: string | null
  editContent: string
  pickerOpenFor: string | null
  isSaved?: boolean
  allowReactions?: boolean
  allowReplies?: boolean
  showThreadChip?: boolean
  isPending?: boolean
  atReactionLimit?: boolean
}

export default function Message({
  msg,
  isCompact,
  isOwn,
  currentUserId,
  canDeleteAny = false,
  canPin = false,
  editingId,
  editContent,
  pickerOpenFor,
  isSaved = false,
  allowReactions = true,
  allowReplies = true,
  showThreadChip = true,
  isPending = false,
  atReactionLimit = false,
}: MessageProps) {
  const actions = useMessageActions()
  const isEditing = editingId === msg.id
  const displayName = msg.profiles?.display_name ?? msg.profiles?.username ?? 'Unknown'
  const usernameColor = (msg.profiles as any)?.username_color ?? 'var(--text-primary)'
  const mirrorRootId = msg.mirrored_from_thread?.thread_root_id ?? null
  const wasPromoted = Boolean(msg.promoted_to_channel_id)
  const promotedChannel = msg.promoted_channel ?? null
  const promotedChannelId = promotedChannel?.id ?? null
  const promotedChannelName = promotedChannel?.name ?? 'new-channel'
  const mirrorPromotedChannel = msg.mirrored_from_thread?.promoted_channel ?? null
  const mirrorPromotedChannelId = mirrorPromotedChannel?.id ?? null
  const mirrorPromotedChannelName = mirrorPromotedChannel?.name ?? 'new-channel'

  const longPress = useLongPress(() => actions.openActions(msg.id))

  if (wasPromoted) {
    return (
      <div
        data-testid="message-promoted-tombstone"
        className="message-row flex items-start gap-3 rounded px-2 py-2"
        style={{ position: 'relative' }}
      >
        <div style={{ width: 36, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
          <span aria-hidden="true" className="mt-1 text-[var(--accent)]">↗</span>
        </div>
        <div className="min-w-0 flex-1 rounded border border-[var(--border-soft)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-muted)]">
          <span>This thread was promoted to </span>
          {promotedChannelId ? (
            <a
              data-testid="message-promoted-channel-link"
              href={`/channels/${promotedChannelId}`}
              className="font-semibold text-[var(--accent)] hover:underline"
            >
              #{promotedChannelName}
            </a>
          ) : (
            <span>a channel</span>
          )}
          {msg.promoted_at && <span> on {formatPromotedDate(msg.promoted_at)}</span>}
          {displayName && <span> by {displayName}</span>}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`message-row group/msg flex items-start gap-3 rounded px-2 hover:bg-[var(--bg-hover)] transition-colors${isOwn ? ' own-message' : ''}`}
      style={{
        paddingTop: isCompact ? 2 : 16,
        paddingBottom: 2,
        position: 'relative',
      }}
      onContextMenu={e => {
        e.preventDefault()
        actions.openContextMenu(msg.id, e)
      }}
      {...(!isEditing ? {
        onPointerDown: longPress.onPointerDown,
        onPointerUp: longPress.onPointerUp,
        onPointerMove: longPress.onPointerMove,
        onPointerLeave: longPress.onPointerLeave,
      } : {})}
    >
      {/* Avatar column — 36px */}
      <div style={{ width: 36, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
        {isCompact ? (
          <span
            className="opacity-0 group-hover/msg:opacity-100 transition-opacity"
            style={{
              fontSize: 10,
              color: 'var(--text-faint)',
              lineHeight: '20px',
              whiteSpace: 'nowrap',
            }}
          >
            {formatTime(msg.created_at)}
          </span>
        ) : (
          <button
            className="rounded-full focus:outline-none"
            onClick={e => actions.openProfile(msg.user_id, e.currentTarget)}
          >
            <Avatar
              user={{
                avatar_url: msg.profiles?.avatar_url,
                username: msg.profiles?.username ?? '?',
                display_name: msg.profiles?.display_name,
                username_color: (msg.profiles as any)?.username_color,
              }}
              size={36}
            />
          </button>
        )}
      </div>

      {/* Content column */}
      <div className="flex-1 min-w-0">
        {/* Message header (ungrouped only) */}
        {!isCompact && (
          <div
            data-testid="message-header"
            style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}
          >
            <button
              data-testid="message-author-name"
              className="font-semibold hover:underline focus:outline-none"
              style={{ fontSize: 15, color: usernameColor, cursor: 'pointer' }}
              title={msg.profiles?.display_name ? `@${msg.profiles.username}` : undefined}
              onClick={e => actions.openProfile(msg.user_id, e.currentTarget)}
            >
              {displayName}
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'inherit' }}>
              {formatTime(msg.created_at)}
            </span>
          </div>
        )}

        {/* Pinned indicator */}
        {msg.pinned_at && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="17" x2="12" y2="22" />
              <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
            </svg>
            <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 500 }}>Pinned</span>
          </div>
        )}

        {/* Reply quote */}
        {msg.replied_to && (
          <button
            type="button"
            data-testid="message-reply-quote"
            onClick={() => actions.jumpToMessage(msg.replied_to!.id)}
            title="Jump to replied message"
            aria-label="Jump to replied message"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              width: '100%',
              marginBottom: 4,
              padding: '0 0 0 8px',
              borderLeft: '2px solid var(--border-strong)',
              borderTop: 0,
              borderRight: 0,
              borderBottom: 0,
              background: 'transparent',
              fontSize: 12,
              color: 'var(--text-muted)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span style={{ color: 'var(--accent)', fontWeight: 600, flexShrink: 0 }}>
              @{msg.replied_to.profiles?.username}
            </span>
            <span style={{ opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {msg.replied_to.content.length > 80
                ? msg.replied_to.content.slice(0, 80) + '…'
                : msg.replied_to.content}
            </span>
          </button>
        )}

        {/* Edit mode */}
        {isEditing ? (
          <>
            {/* Backdrop — tap outside to cancel */}
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 10 }}
              onPointerDown={() => actions.cancelEdit()}
            />
            <div style={{ position: 'relative', zIndex: 11 }}>
              <textarea
                data-testid="message-edit-textarea"
                className="w-full rounded border text-sm text-[var(--text-primary)] px-3 py-2 resize-none focus:outline-none focus:border-[var(--accent)]"
                style={{
                  background: 'var(--bg-tertiary)',
                  borderColor: 'var(--border-strong)',
                  borderRadius: 'var(--radius-md)',
                }}
                rows={3}
                value={editContent}
                onChange={e => actions.changeEditContent(e.target.value)}
                onKeyDown={e => {
                  e.stopPropagation()
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); actions.submitEdit(msg.id, editContent) }
                  if (e.key === 'Escape') actions.cancelEdit()
                }}
                autoFocus
                disabled={isPending}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 6, justifyContent: 'flex-end' }}>
                <button
                  onPointerDown={e => { e.stopPropagation(); actions.cancelEdit() }}
                  style={{ padding: '6px 14px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onPointerDown={e => { e.stopPropagation(); actions.submitEdit(msg.id, editContent) }}
                  disabled={isPending}
                  style={{ padding: '6px 14px', background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  Save
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4, textAlign: 'right' }}>
                escape to cancel · enter to save
              </p>
            </div>
          </>
        ) : (
          <>
            {msg.content && (
              <div className="break-words" style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-primary)' }}>
                <MessageContent content={msg.content} />
                {msg.edited_at && (
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6 }}>(edited)</span>
                )}
              </div>
            )}
            {msg.attachments && msg.attachments.length > 0 && (
              <MessageAttachments attachments={msg.attachments} />
            )}
            {msg.mirrored_from_thread_id && (
              mirrorPromotedChannelId ? (
                <a
                  href={`/channels/${mirrorPromotedChannelId}`}
                  data-testid="message-from-promoted-thread-link"
                  className="mt-1 inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/10"
                >
                  From promoted thread → #{mirrorPromotedChannelName}
                </a>
              ) : (
                <button
                  type="button"
                  data-testid="message-from-thread-link"
                  onClick={() => {
                    if (mirrorRootId) actions.openThread(mirrorRootId)
                  }}
                  disabled={!mirrorRootId}
                  className="mt-1 inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/10 disabled:cursor-default disabled:opacity-60"
                  title={mirrorRootId ? 'Open thread' : 'Thread unavailable'}
                >
                  ↳ From thread
                </button>
              )
            )}
          </>
        )}

        {/* Reaction pills */}
        {msg.reactions && msg.reactions.length > 0 && !isEditing && (
          <ReactionPills
            reactions={msg.reactions}
            currentUserId={currentUserId}
            onToggle={emoji => actions.react(msg.id, emoji)}
          />
        )}

        {showThreadChip && !isEditing && !msg.thread_root_id && (msg.thread_reply_count ?? 0) > 0 && (
          <ThreadChip
            rootId={msg.id}
            replyCount={msg.thread_reply_count ?? 0}
            lastReplyAt={msg.thread_last_reply_at}
            currentUserId={currentUserId}
            onOpen={actions.openThread}
          />
        )}

        {allowReplies && !isEditing && !msg.thread_root_id && (
          <button
            type="button"
            data-testid="mobile-action-reply-thread"
            onClick={() => actions.openThread(msg.id)}
            className="mt-1 inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/10 md:hidden"
            title="Reply in thread"
            aria-label="Reply in thread"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
            </svg>
            Thread
          </button>
        )}
      </div>

      {/* Hover action bar (desktop only) */}
      {!isEditing && (
        <MessageActionBar
          msg={msg}
          isOwn={isOwn}
          canDeleteAny={canDeleteAny}
          canPin={canPin}
          allowReactions={allowReactions}
          allowReplies={allowReplies}
          atReactionLimit={atReactionLimit}
          currentUserId={currentUserId}
          pickerOpenFor={pickerOpenFor}
          isSaved={isSaved}
        />
      )}
    </div>
  )
}

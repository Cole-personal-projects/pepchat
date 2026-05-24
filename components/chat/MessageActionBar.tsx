'use client'

import ReactionPicker from '@/components/chat/ReactionPicker'
import { useMessageActions } from '@/components/chat/MessageActionsContext'
import type { MessageWithProfile } from '@/lib/types'

export interface MessageActionBarProps {
  msg: MessageWithProfile
  isOwn: boolean
  canDeleteAny: boolean
  canPin: boolean
  allowReactions: boolean
  allowReplies: boolean
  atReactionLimit: boolean
  currentUserId?: string
  pickerOpenFor: string | null
  isSaved?: boolean
}

export default function MessageActionBar({
  msg,
  isOwn,
  canDeleteAny,
  canPin,
  allowReactions,
  allowReplies,
  atReactionLimit,
  currentUserId = '',
  pickerOpenFor,
  isSaved = false,
}: MessageActionBarProps) {
  const actions = useMessageActions()
  const canDelete = isOwn || canDeleteAny
  const mirrorRootId = msg.mirrored_from_thread?.thread_root_id ?? null
  const isMirror = Boolean(msg.mirrored_from_thread_id)

  return (
    <div
      className="hidden md:group-hover/msg:flex items-center gap-0.5 flex-shrink-0"
      style={{
        position: 'absolute',
        top: -18,
        right: 8,
        zIndex: 10,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-soft)',
        borderRadius: 'var(--radius-md)',
        padding: '2px 4px',
        boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
      }}
    >
      {allowReactions && (
        <div style={{ position: 'relative' }}>
          <button
            data-testid="action-react"
            onClick={() => actions.togglePicker(msg.id)}
            title={atReactionLimit ? 'Max 20 emoji per message' : 'Add reaction'}
            disabled={atReactionLimit && !(msg.reactions ?? []).some(r => r.user_id === currentUserId)}
            className="icon-btn disabled:opacity-30 disabled:cursor-default"
            style={{ padding: 6 }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
            </svg>
          </button>
          {pickerOpenFor === msg.id && (
            <ReactionPicker
              onSelect={emoji => actions.react(msg.id, emoji)}
              onClose={actions.closePicker}
            />
          )}
        </div>
      )}

      {allowReplies && (
        <button
          data-testid="action-reply"
          onClick={() => actions.reply(msg.id)}
          title="Reply"
          className="icon-btn"
          style={{ padding: 6 }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M9 17l-5-5 5-5M4 12h11a5 5 0 0 1 0 10h-2" />
          </svg>
        </button>
      )}

      {allowReplies && !msg.thread_root_id && (
        <button
          data-testid="action-reply-thread"
          onClick={() => actions.openThread(msg.id)}
          title="Reply in Thread"
          className="icon-btn"
          style={{ padding: 6 }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
          </svg>
        </button>
      )}

      {isOwn && (
        <button
          data-testid="action-edit"
          onClick={e => {
            e.stopPropagation()
            if (isMirror) {
              if (mirrorRootId) actions.openThread(mirrorRootId)
              return
            }
            actions.startEdit(msg.id)
          }}
          title={isMirror ? 'Edit in thread' : 'Edit'}
          className="icon-btn"
          style={{ padding: 6 }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
      )}

      {canPin && (
        <button
          data-testid="action-pin"
          onClick={() => actions.pin(msg.id)}
          title="Pin message"
          className="icon-btn"
          style={{ padding: 6 }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="17" x2="12" y2="22" />
            <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
          </svg>
        </button>
      )}

      <button
        data-testid="action-save"
        onClick={() => actions.toggleSaved(msg.id)}
        title={isSaved ? 'Remove saved message' : 'Save message'}
        className="icon-btn"
        style={{ padding: 6, color: isSaved ? 'var(--accent)' : undefined }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
        </svg>
      </button>

      {canDelete && (
        <button
          data-testid="action-delete"
          onClick={() => { if (confirm('Delete this message?')) actions.delete(msg.id) }}
          title="Delete"
          className="icon-btn hover:text-[var(--danger)] hover:bg-[var(--danger)]/10"
          style={{ padding: 6 }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { fetchThreadReplies } from '@/app/(app)/messages/thread-actions'
import Message from '@/components/chat/Message'
import MessageInput from '@/components/chat/MessageInput'
import type { MessageWithProfile, Profile } from '@/lib/types'

interface ThreadPanelProps {
  open: boolean
  rootMessage: MessageWithProfile | null
  channelName: string
  profile: Profile
  currentUserId: string
  groupId?: string
  canPin?: boolean
  onClose: () => void
}

export default function ThreadPanel({
  open,
  rootMessage,
  channelName,
  profile,
  currentUserId,
  groupId,
  canPin = false,
  onClose,
}: ThreadPanelProps) {
  const [replies, setReplies] = useState<MessageWithProfile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const rootId = rootMessage?.id ?? null

  useEffect(() => {
    if (!open || !rootId) {
      setReplies([])
      setError('')
      setLoading(false)
      return
    }

    let ignore = false
    setLoading(true)
    setError('')
    fetchThreadReplies({ rootId }).then(result => {
      if (ignore) return
      if (result.error) {
        setReplies([])
        setError(result.error)
      } else if (result.messages) {
        setReplies(result.messages)
      } else {
        setReplies([])
        setError('Failed to load thread replies.')
      }
    }).catch(() => {
      if (!ignore) setError('Failed to load thread replies.')
    }).finally(() => {
      if (!ignore) setLoading(false)
    })

    return () => {
      ignore = true
    }
  }, [open, rootId])

  if (!open || !rootMessage) return null

  const baseMessageProps = {
    currentUserId,
    canDeleteAny: false,
    canPin,
    editingId: null,
    editContent: '',
    pickerOpenFor: null,
    allowReactions: true,
    allowReplies: false,
    isPending: false,
    atReactionLimit: false,
    showThreadChip: false,
  }

  return (
    <>
      <div
        data-testid="thread-panel-backdrop"
        className="fixed inset-0 z-40 bg-black/50 lg:hidden modal-backdrop-enter"
        onClick={onClose}
      />
      <aside
        data-testid="thread-panel"
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-black/20 lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:w-80 lg:rounded-none lg:border-l lg:border-t-0 drawer-panel-enter"
        style={{ background: 'var(--bg-secondary)' }}
        aria-label="Thread panel"
      >
        <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-black/20 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }} aria-hidden="true">
                <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
              </svg>
              <span data-testid="thread-panel-title" className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Thread
              </span>
            </div>
            <p data-testid="thread-panel-channel" className="mt-1 truncate text-xs text-[var(--text-faint)]">
              in #{channelName}
            </p>
          </div>
          <button
            data-testid="thread-panel-close"
            type="button"
            onClick={onClose}
            aria-label="Close thread"
            className="rounded p-0.5 text-[var(--text-muted)] transition-colors hover:bg-white/10 hover:text-[var(--text-primary)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          <div data-testid="thread-root" className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-chat)] py-1">
            <Message
              {...baseMessageProps}
              msg={rootMessage}
              isCompact={false}
              isOwn={rootMessage.user_id === currentUserId}
            />
          </div>

          <div className="my-4 flex items-center gap-3 px-2">
            <div className="h-px flex-1 bg-[var(--border-soft)]" />
            <span data-testid="thread-reply-count" className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
              {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
            </span>
            <div className="h-px flex-1 bg-[var(--border-soft)]" />
          </div>

          {loading && (
            <p data-testid="thread-loading" className="px-3 py-6 text-center text-xs text-[var(--text-faint)]">
              Loading thread…
            </p>
          )}
          {error && (
            <p data-testid="thread-error" className="mx-2 rounded border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]">
              {error}
            </p>
          )}
          {!loading && !error && replies.length === 0 && (
            <p data-testid="thread-empty" className="px-3 py-6 text-center text-xs text-[var(--text-faint)]">
              No replies yet. Start the thread below.
            </p>
          )}
          <div className="space-y-1">
            {replies.map((reply, index) => (
              <div key={reply.id} data-message-id={reply.id} data-testid={`thread-reply-${reply.id}`}>
                <Message
                  {...baseMessageProps}
                  msg={reply}
                  isCompact={index > 0 && reply.user_id === replies[index - 1].user_id}
                  isOwn={reply.user_id === currentUserId}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex-shrink-0 border-t border-black/20 pt-3">
          <MessageInput
            mode="thread"
            threadRootId={rootMessage.id}
            channelId={rootMessage.channel_id}
            groupId={groupId}
            channelName={channelName}
            profile={profile}
            allowVideoUpload={true}
            draftStorageKey={`sidebar:draft:thread:${rootMessage.id}`}
            onSent={message => setReplies(current => [...current, message])}
          />
        </div>
      </aside>
    </>
  )
}
